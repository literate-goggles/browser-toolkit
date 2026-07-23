from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

import main  # noqa: E402


class DailyApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_data_file = main.BANS_DATA_FILE
        main.BANS_DATA_FILE = Path(self.temporary_directory.name) / "bans.json"
        main._provider_requests.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        main.BANS_DATA_FILE = self.original_data_file
        self.temporary_directory.cleanup()

    def test_vocab_ban_lifecycle_remains_compatible(self) -> None:
        self.assertEqual(self.client.get("/api/vocab/bans").json(), {"bans": {}})

        response = self.client.post(
            "/api/vocab/bans/c1-cefr", json={"word": "  Example  "}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "banned": ["example"]})
        self.assertEqual(
            self.client.get("/api/vocab/bans").json(),
            {"bans": {"c1-cefr": ["example"]}},
        )

        response = self.client.delete("/api/vocab/bans/c1-cefr/example")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "banned": []})

    def test_invalid_vocab_source_is_rejected(self) -> None:
        response = self.client.post("/api/vocab/bans/not%20safe", json={"word": "x"})
        self.assertEqual(response.status_code, 400)

    def test_short_topic_discards_accidental_cue_points(self) -> None:
        generated = {
            "title": "Weekends",
            "prompt": "What do you usually enjoy doing at the weekend, and why?",
            "bulletPoints": ["This should be removed"],
        }
        with patch.object(main, "_openrouter_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/topic", json={"mode": "short", "recentTopics": []}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["bulletPoints"], [])

    def test_long_topic_requires_four_cue_points(self) -> None:
        generated = {
            "title": "A useful object",
            "prompt": "Describe a useful object you own.",
            "bulletPoints": ["what it is"],
        }
        with patch.object(main, "_openrouter_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/topic", json={"mode": "long", "recentTopics": []}
            )
        self.assertEqual(response.status_code, 502)

    def test_delivery_stats_use_transcript_and_word_timings(self) -> None:
        stats = main._calculate_delivery_stats(
            {
                "text": "I enjoy reading because it helps me relax.",
                "words": [
                    {"type": "word", "start": 0.2, "end": 0.5},
                    {"type": "word", "start": 1.5, "end": 1.8},
                    {"type": "word", "start": 4.1, "end": 4.3},
                ],
            },
            5.0,
        )
        self.assertEqual(stats["wordCount"], 8)
        self.assertEqual(stats["wordsPerMinute"], 96)
        self.assertEqual(stats["pauseCount"], 2)
        self.assertEqual(stats["longPauseCount"], 1)

    def test_transcription_rejects_non_audio_body_before_provider_call(self) -> None:
        with patch.object(main, "ELEVENLABS_API_KEY", "test-key"):
            response = self.client.post(
                "/api/ielts/transcribe",
                content=b"not audio" * 100,
                headers={"Content-Type": "text/plain"},
            )
        self.assertEqual(response.status_code, 415)

    def test_provider_rate_limit_returns_retry_after(self) -> None:
        request = type(
            "RequestStub",
            (),
            {"headers": {"x-real-ip": "192.0.2.1"}, "client": None},
        )()
        main._enforce_provider_rate_limit(request, "test", limit=1)
        with self.assertRaises(main.HTTPException) as raised:
            main._enforce_provider_rate_limit(request, "test", limit=1)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("Retry-After", raised.exception.headers)


if __name__ == "__main__":
    unittest.main()
