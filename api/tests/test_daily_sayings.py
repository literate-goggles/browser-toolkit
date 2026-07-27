from __future__ import annotations

import json
import unittest
from datetime import date
from unittest.mock import AsyncMock

from api.daily_sayings import (
    DailySayingService,
    SayingCandidate,
    extract_candidates,
)


def candidate_pool(language: str, count: int = 120) -> list[SayingCandidate]:
    if language == "ru":
        texts = [
            f"Русская пословица номер {index} делу и терпению учит."
            for index in range(count)
        ]
        source_label = "Викицитатник: Русские пословицы"
        source_url = "https://ru.wikiquote.org/wiki/example"
    else:
        texts = [
            f"English proverb number {index} teaches work and patience."
            for index in range(count)
        ]
        source_label = "Wikiquote: English proverbs"
        source_url = "https://en.wikiquote.org/wiki/example"
    return [
        SayingCandidate(
            id=f"{language}-candidate-{index}",
            language=language,
            text=text,
            sourceLabel=source_label,
            sourceUrl=source_url,
        )
        for index, text in enumerate(texts)
    ]


class DailySayingExtractionTests(unittest.TestCase):
    def test_extracts_only_top_level_russian_proverbs_and_cleans_markup(self) -> None:
        wikitext = """
== Б ==
* Без [[труд]]а не вытащишь и рыбку из пруда.<ref>Источник</ref>
** Пояснение, которое не является пословицей.
* [[Азбука|Азбука]] - к мудрости ступенька.
* — Диалог, который следует пропустить.
"""

        candidates = extract_candidates(wikitext, "ru")

        self.assertEqual(
            [candidate.text for candidate in candidates],
            [
                "Без труда не вытащишь и рыбку из пруда.",
                "Азбука - к мудрости ступенька.",
            ],
        )

    def test_extracts_english_proverbs_without_meaning_bullets(self) -> None:
        wikitext = """
== A ==
* Actions speak louder than [[word]]s.
** Meaning: What people do matters.
* Don't count your chickens before they hatch.
"""

        candidates = extract_candidates(wikitext, "en")

        self.assertEqual(
            [candidate.text for candidate in candidates],
            [
                "Actions speak louder than words.",
                "Don't count your chickens before they hatch.",
            ],
        )


class DailySayingServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.generator = AsyncMock()
        self.service = DailySayingService(json_generator=self.generator)
        self.pools = {
            "ru": candidate_pool("ru"),
            "en": candidate_pool("en"),
        }

    def test_samples_three_per_language_without_repeating_history(self) -> None:
        first = self.service.sample(
            target=date(2026, 7, 27),
            pools=self.pools,
            history=[],
        )
        history = self.service.remember([], first, limit=500)
        second = self.service.sample(
            target=date(2026, 7, 28),
            pools=self.pools,
            history=history,
        )

        self.assertEqual(
            [candidate.language for candidate in first],
            ["ru", "ru", "ru", "en", "en", "en"],
        )
        self.assertTrue(
            {candidate.id for candidate in first}.isdisjoint(
                {candidate.id for candidate in second}
            )
        )

    async def test_prepare_fetches_large_pools_and_enriches_selected_six(self) -> None:
        self.service._fetch_pools = AsyncMock(return_value=self.pools)

        async def enrich_response(*, messages, **kwargs):
            selected_payload = json.loads(
                messages[1]["content"]
                .split("Enrich these sampled proverbs:\n", 1)[1]
                .split("\n\n", 1)[0]
            )
            return {
                "sayings": [
                    {
                        "id": candidate["id"],
                        "translation": (
                            "Natural English translation."
                            if candidate["language"] == "ru"
                            else "Естественный перевод на русский."
                        ),
                        "meaning": (
                            "Пословица объясняет ценность терпения и труда."
                            if candidate["language"] == "ru"
                            else "The proverb explains the value of patient work."
                        ),
                        "origin": (
                            "Традиционная русская пословица для практического совета."
                            if candidate["language"] == "ru"
                            else "A traditional English proverb used as practical advice."
                        ),
                    }
                    for candidate in selected_payload
                ]
            }

        self.generator.side_effect = enrich_response

        result = await self.service.prepare(
            target=date(2026, 7, 27),
            history=[],
        )

        self.assertEqual(len(result), 6)
        self.assertEqual(
            [saying.language for saying in result],
            ["ru", "ru", "ru", "en", "en", "en"],
        )
        self.assertTrue(all(saying.translation for saying in result))
        self.generator.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
