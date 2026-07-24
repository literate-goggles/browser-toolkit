from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock

import httpx

from api.daily_digest import (
    CarItem,
    DailyDigest,
    DailyDigestService,
    SourceStatus,
    _extract_wiki_sections,
    _plain_quotes,
)


def generated_content(*, car_name: str = "Citroen DS") -> dict:
    return {
        "onThisDay": [
            {
                "language": "en",
                "category": "event",
                "year": "1969",
                "title": "A historic mission returned",
                "detail": "The event changed how people understood exploration and engineering.",
                "sourceUrl": "https://en.wikipedia.org/wiki/July_24",
            },
            {
                "language": "ru",
                "category": "event",
                "year": "1911",
                "title": "Историческое событие",
                "detail": "Событие заметно повлияло на развитие культуры и общественной жизни.",
                "sourceUrl": "https://ru.wikipedia.org/wiki/24_июля",
            },
            {
                "language": "en",
                "category": "birthday",
                "year": "1897",
                "title": "A notable inventor was born",
                "detail": "The inventor's work influenced a generation of practical technology.",
                "sourceUrl": "https://en.wikipedia.org/wiki/July_24",
            },
            {
                "language": "ru",
                "category": "holiday",
                "year": "",
                "title": "Памятный день",
                "detail": "Этот день сохраняет важную общественную и культурную традицию.",
                "sourceUrl": "https://ru.wikipedia.org/wiki/24_июля",
            },
        ],
        "research": [
            {
                "id": "paper-001",
                "title": "A useful language model paper",
                "source": "Hugging Face Papers",
                "published": "2026-07-24",
                "field": "NLP",
                "problem": "Existing language systems need too much labelled training data.",
                "mainIdea": "The method reuses model signals to improve learning efficiency.",
                "result": "The reported evaluation improves accuracy on several benchmarks.",
                "whyItMatters": "The approach could make language model adaptation more practical.",
                "url": "https://huggingface.co/papers/2607.00001",
            },
            {
                "id": "paper-002",
                "title": "A useful image generation paper",
                "source": "alphaXiv",
                "published": "2026-07-23",
                "field": "Image generation",
                "problem": "Long generated videos often lose visual and physical consistency.",
                "mainIdea": "A shared state representation keeps generation stages coordinated.",
                "result": "The method reports stronger consistency than the compared baselines.",
                "whyItMatters": "Stable long-form generation is important for useful video models.",
                "url": "https://www.alphaxiv.org/abs/2607.00002",
            },
        ],
        "cars": [
            {
                "name": car_name,
                "years": "1955-1975",
                "country": "France",
                "category": "Executive car",
                "notes": [
                    "Hydropneumatic suspension delivered unusual ride comfort.",
                    "Its aerodynamic body made it visually and technically distinctive.",
                ],
                "whyItMatters": "It showed that a mass-produced car could introduce radical engineering.",
            }
        ],
        "poem": {
            "author": "Александр Пушкин",
            "title": "Если жизнь тебя обманет",
            "text": "Если жизнь тебя обманет,\nНе печалься, не сердись!",
            "memoryNote": "Remember the emotional turn from difficulty toward patience and hope.",
        },
    }


def cached_digest() -> dict:
    content = generated_content()
    return {
        "date": "2026-07-23",
        "displayDate": "Thursday, July 23, 2026",
        "generatedAt": "2026-07-23T00:00:10Z",
        "timezone": "UTC",
        "sources": [
            {
                "label": "English Wikipedia",
                "url": "https://en.wikipedia.org/wiki/July_23",
                "ok": True,
            }
        ],
        **content,
    }


class DailyDigestServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_file = Path(self.temporary_directory.name) / "daily.json"
        self.generator = AsyncMock(return_value=generated_content())
        self.service = DailyDigestService(
            data_file=self.data_file,
            timezone_name="UTC",
            json_generator=self.generator,
        )
        self.service._local_today = lambda: date(2026, 7, 24)
        self.service._fetch_sources = AsyncMock(
            return_value=(
                {
                    "English Wikipedia": "Events and births",
                    "Russian Wikipedia": "События и родившиеся",
                    "Hugging Face Papers": "Daily paper abstracts",
                },
                [
                    SourceStatus(
                        label="English Wikipedia",
                        url="https://en.wikipedia.org/wiki/July_24",
                        ok=True,
                    ),
                    SourceStatus(
                        label="Russian Wikipedia",
                        url="https://ru.wikipedia.org/wiki/24_июля",
                        ok=True,
                    ),
                    SourceStatus(
                        label="Hugging Face Papers",
                        url="https://huggingface.co/papers",
                        ok=True,
                    ),
                ],
            )
        )

        async def enrich_cars(cars):
            return [
                CarItem(
                    **car.model_dump(),
                    imageUrl=(
                        "https://upload.wikimedia.org/wikipedia/commons/"
                        f"{car.name.replace(' ', '_')}.jpg"
                    ),
                    imageSourceUrl=(
                        "https://en.wikipedia.org/wiki/"
                        f"{car.name.replace(' ', '_')}"
                    ),
                    imageAlt=f"{car.name} car",
                )
                for car in cars
            ]

        self.service._enrich_cars = AsyncMock(side_effect=enrich_cars)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    async def test_generates_once_then_serves_persisted_daily_cache(self) -> None:
        first = await self.service.get()
        second = await self.service.get()

        self.assertEqual(first.digest.date, "2026-07-24")
        self.assertFalse(first.stale)
        self.assertEqual(second.digest.research[0].id, "paper-001")
        self.assertEqual(self.generator.await_count, 1)
        persisted = json.loads(self.data_file.read_text(encoding="utf-8"))
        self.assertEqual(persisted["current"]["date"], "2026-07-24")
        self.assertIn("paper-001", persisted["history"]["research"])
        self.assertIn("citroen ds", persisted["history"]["cars"])
        self.assertTrue(persisted["current"]["cars"][0]["imageUrl"])

    async def test_retries_when_model_repeats_persistent_history(self) -> None:
        self.data_file.write_text(
            json.dumps(
                {
                    "current": None,
                    "history": {
                        "research": [],
                        "cars": ["citroen ds"],
                        "poems": [],
                    },
                }
            ),
            encoding="utf-8",
        )
        self.generator.side_effect = [
            generated_content(car_name="Citroen DS"),
            generated_content(car_name="Lancia Stratos"),
        ]

        response = await self.service.get()

        self.assertEqual(response.digest.cars[0].name, "Lancia Stratos")
        self.assertEqual(self.generator.await_count, 2)

    async def test_returns_previous_digest_when_refresh_fails(self) -> None:
        state = {
            "current": cached_digest(),
            "history": {"research": [], "cars": [], "poems": []},
        }
        self.data_file.write_text(json.dumps(state), encoding="utf-8")
        self.service._refresh = AsyncMock(side_effect=RuntimeError("source failure"))

        response = await self.service.get()

        self.assertTrue(response.stale)
        self.assertEqual(response.digest.date, "2026-07-23")
        self.assertIn("latest saved digest", response.warning)

    def test_extracts_requested_wikipedia_sections(self) -> None:
        wikitext = (
            "Lead\n== Events ==\n* Event\n== Births ==\n* Person\n"
            "== Deaths ==\n* Other\n"
        )
        extracted = _extract_wiki_sections(wikitext, {"events", "births"})
        self.assertIn("## Events", extracted)
        self.assertIn("## Births", extracted)
        self.assertNotIn("Deaths", extracted)

    def test_normalizes_curly_quotes_and_apostrophes(self) -> None:
        normalized = _plain_quotes({"text": "\u201cToday\u2019s\u201d"})
        self.assertEqual(normalized["text"], '"Today\'s"')

    async def test_fetches_a_free_wikipedia_car_image(self) -> None:
        client = AsyncMock()
        client.get.return_value = httpx.Response(
            200,
            request=httpx.Request(
                "GET", "https://en.wikipedia.org/w/api.php"
            ),
            json={
                "query": {
                    "pages": [
                        {
                            "title": "Citroën DS",
                            "description": "French executive automobile",
                            "fullurl": "https://en.wikipedia.org/wiki/Citro%C3%ABn_DS",
                            "thumbnail": {
                                "source": (
                                    "https://upload.wikimedia.org/wikipedia/"
                                    "commons/thumb/example.jpg"
                                )
                            },
                        }
                    ]
                }
            },
        )

        image_url, source_url = await DailyDigestService._fetch_car_image(
            self.service, client, "Citroen DS"
        )

        self.assertEqual(
            image_url,
            "https://upload.wikimedia.org/wikipedia/commons/thumb/example.jpg",
        )
        self.assertEqual(
            source_url, "https://en.wikipedia.org/wiki/Citro%C3%ABn_DS"
        )
        request_params = client.get.await_args.kwargs["params"]
        self.assertEqual(request_params["pilicense"], "free")


if __name__ == "__main__":
    unittest.main()
