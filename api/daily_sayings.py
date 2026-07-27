"""Large-pool bilingual proverb sampling and OpenAI enrichment."""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import re
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field


JsonGenerator = Callable[..., Awaitable[dict[str, Any]]]
SAYINGS_PER_LANGUAGE = 3
SAYINGS_VERSION = 2
SAYINGS_HISTORY_LIMIT = 10_000
POOL_MINIMUM = 100
USER_AGENT = "LiterateGogglesDaily/1.0 (https://daily.chebakov.me)"
SOURCES = {
    "ru": {
        "api": "https://ru.wikiquote.org/w/api.php",
        "page": "Русские пословицы",
        "label": "Викицитатник: Русские пословицы",
        "url": (
            "https://ru.wikiquote.org/wiki/"
            "%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B5_"
            "%D0%BF%D0%BE%D1%81%D0%BB%D0%BE%D0%B2%D0%B8%D1%86%D1%8B"
        ),
    },
    "en": {
        "api": "https://en.wikiquote.org/w/api.php",
        "page": "English proverbs (alphabetically by proverb)",
        "label": "Wikiquote: English proverbs",
        "url": (
            "https://en.wikiquote.org/wiki/"
            "English_proverbs_%28alphabetically_by_proverb%29"
        ),
    },
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DailySaying(StrictModel):
    id: str = Field(min_length=3, max_length=120)
    language: Literal["ru", "en"]
    text: str = Field(min_length=3, max_length=240)
    translation: str = Field(default="", max_length=400)
    meaning: str = Field(min_length=12, max_length=500)
    origin: str = Field(min_length=12, max_length=500)
    sourceLabel: str = Field(min_length=3, max_length=100)
    sourceUrl: str = Field(min_length=8, max_length=500)


class SayingCandidate(StrictModel):
    id: str
    language: Literal["ru", "en"]
    text: str
    sourceLabel: str
    sourceUrl: str


class GeneratedSayingDetail(StrictModel):
    id: str = Field(min_length=3, max_length=120)
    translation: str = Field(min_length=2, max_length=400)
    meaning: str = Field(min_length=12, max_length=500)
    origin: str = Field(min_length=12, max_length=500)


class GeneratedSayingDetails(StrictModel):
    sayings: list[GeneratedSayingDetail] = Field(min_length=6, max_length=6)


def _plain_quotes(value: Any) -> Any:
    replacements = str.maketrans(
        {
            "\u2018": "'",
            "\u2019": "'",
            "\u02bc": "'",
            "\u00ab": '"',
            "\u00bb": '"',
            "\u201c": '"',
            "\u201d": '"',
            "\u201e": '"',
        }
    )
    if isinstance(value, str):
        return value.translate(replacements)
    if isinstance(value, list):
        return [_plain_quotes(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain_quotes(item) for key, item in value.items()}
    return value


def _strip_wiki_markup(raw: str) -> str:
    value = re.sub(r"<!--.*?-->", "", raw)
    value = re.sub(r"<ref\b[^>]*>.*?</ref>", "", value, flags=re.IGNORECASE)
    value = re.sub(r"<ref\b[^>]*/\s*>", "", value, flags=re.IGNORECASE)
    value = re.sub(
        r"\[\[([^\]]+)\]\]",
        lambda match: match.group(1).split("|")[-1],
        value,
    )
    value = re.sub(
        r"\[(?:https?://\S+)(?:\s+([^\]]+))?\]",
        lambda match: match.group(1) or "",
        value,
    )
    previous = ""
    while previous != value:
        previous = value
        value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = re.sub(r"</?[a-zA-Z][^>]*>", "", value)
    value = re.sub(r"'{2,}", "", value)
    value = html.unescape(value).replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return str(_plain_quotes(value))


def _language_ratio(value: str, language: Literal["ru", "en"]) -> float:
    letters = [character for character in value if character.isalpha()]
    if not letters:
        return 0.0
    if language == "ru":
        matching = sum(
            ("\u0400" <= character <= "\u052f") for character in letters
        )
    else:
        matching = sum(character.isascii() for character in letters)
    return matching / len(letters)


def _candidate_id(language: str, text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().casefold()
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]
    return f"{language}-wikiquote-{digest}"


def extract_candidates(
    wikitext: str,
    language: Literal["ru", "en"],
) -> list[SayingCandidate]:
    source = SOURCES[language]
    candidates: list[SayingCandidate] = []
    seen_text: set[str] = set()
    in_alphabetic_section = False
    for line in wikitext.splitlines():
        heading = re.match(r"^==\s*([^=]+?)\s*==\s*$", line)
        if heading:
            in_alphabetic_section = bool(
                re.fullmatch(r"[A-ZА-ЯЁ]", heading.group(1).strip())
            )
            continue
        if not in_alphabetic_section:
            continue
        match = re.match(r"^\*\s+(?!\*)(.+)$", line)
        if not match:
            continue
        text = _strip_wiki_markup(match.group(1))
        normalized = text.casefold().strip(" .!?")
        if (
            len(text) < 8
            or len(text) > 220
            or len(text.split()) < 2
            or text.startswith(("-", "–", "—"))
            or "[[" in text
            or "{{" in text
            or "http://" in text
            or "https://" in text
            or _language_ratio(text, language) < 0.72
            or normalized in seen_text
        ):
            continue
        seen_text.add(normalized)
        candidates.append(
            SayingCandidate(
                id=_candidate_id(language, text),
                language=language,
                text=text,
                sourceLabel=str(source["label"]),
                sourceUrl=str(source["url"]),
            )
        )
    return candidates


class DailySayingService:
    def __init__(self, *, json_generator: JsonGenerator) -> None:
        self.json_generator = json_generator

    @staticmethod
    def _tie_breaker(target: date, saying_id: str) -> str:
        return hashlib.sha256(
            f"{target.isoformat()}:{saying_id}".encode("utf-8")
        ).hexdigest()

    def sample(
        self,
        *,
        target: date,
        pools: dict[str, list[SayingCandidate]],
        history: list[str],
    ) -> list[SayingCandidate]:
        history_positions = {
            saying_id: index for index, saying_id in enumerate(history)
        }
        selected: list[SayingCandidate] = []
        for language in ("ru", "en"):
            candidates = pools.get(language) or []
            if len(candidates) < POOL_MINIMUM:
                raise RuntimeError(
                    f"{language} proverb source returned only "
                    f"{len(candidates)} usable entries"
                )
            ordered = sorted(
                candidates,
                key=lambda saying: (
                    saying.id in history_positions,
                    history_positions.get(saying.id, -1),
                    self._tie_breaker(target, saying.id),
                ),
            )
            selected.extend(ordered[:SAYINGS_PER_LANGUAGE])
        return selected

    @staticmethod
    def remember(
        history: list[str],
        selected: list[DailySaying],
        *,
        limit: int,
    ) -> list[str]:
        selected_ids = [saying.id for saying in selected]
        selected_set = set(selected_ids)
        retained = [
            saying_id
            for saying_id in history
            if saying_id not in selected_set
        ]
        return (retained + selected_ids)[-limit:]

    async def _fetch_pool(
        self,
        client: httpx.AsyncClient,
        language: Literal["ru", "en"],
    ) -> list[SayingCandidate]:
        source = SOURCES[language]
        response = await client.get(
            str(source["api"]),
            params={
                "action": "parse",
                "page": source["page"],
                "prop": "wikitext",
                "format": "json",
                "formatversion": "2",
                "redirects": "1",
            },
        )
        response.raise_for_status()
        wikitext = str(response.json()["parse"]["wikitext"])
        return extract_candidates(wikitext, language)

    async def _fetch_pools(self) -> dict[str, list[SayingCandidate]]:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(35.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        ) as client:
            russian, english = await asyncio.gather(
                self._fetch_pool(client, "ru"),
                self._fetch_pool(client, "en"),
            )
        return {"ru": russian, "en": english}

    async def _enrich(
        self,
        selected: list[SayingCandidate],
    ) -> list[DailySaying]:
        selected_payload = [
            {
                "id": saying.id,
                "language": saying.language,
                "text": saying.text,
            }
            for saying in selected
        ]
        result = await self.json_generator(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a careful bilingual lexicographer. Explain six "
                        "proverbs for practical language study. Use plain ASCII "
                        "quotes and apostrophes. Never change an id. Do not invent "
                        "a specific author, date, book, or historical origin. If "
                        "the exact origin is uncertain, identify it simply as a "
                        "traditional proverb and explain when it is used."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Enrich these sampled proverbs:\n"
                        f"{json.dumps(selected_payload, ensure_ascii=False)}\n\n"
                        "For every Russian proverb, provide a natural English "
                        "translation, explain its meaning in Russian, and write "
                        "the origin/use note in Russian. For every English "
                        "proverb, provide a natural Russian translation, explain "
                        "its meaning in English, and write the origin/use note "
                        "in English. Keep every field concise and self-contained."
                    ),
                },
            ],
            schema_name="daily_bilingual_sayings",
            schema=GeneratedSayingDetails.model_json_schema(),
            max_tokens=3_500,
        )
        generated = GeneratedSayingDetails.model_validate(_plain_quotes(result))
        expected_ids = [saying.id for saying in selected]
        generated_ids = [detail.id for detail in generated.sayings]
        if len(set(generated_ids)) != 6 or set(generated_ids) != set(expected_ids):
            raise RuntimeError("OpenAI changed or omitted sampled proverb ids")
        details_by_id = {detail.id: detail for detail in generated.sayings}
        return [
            DailySaying(
                **candidate.model_dump(),
                **details_by_id[candidate.id].model_dump(exclude={"id"}),
            )
            for candidate in selected
        ]

    async def prepare(
        self,
        *,
        target: date,
        history: list[str],
    ) -> list[DailySaying]:
        pools = await self._fetch_pools()
        selected = self.sample(
            target=target,
            pools=pools,
            history=history,
        )
        return await self._enrich(selected)
