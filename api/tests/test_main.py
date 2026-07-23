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

    def test_writing_task_two_discards_table_data(self) -> None:
        generated = {
            "title": "Working from home",
            "prompt": (
                "Some people believe working from home benefits both employees and "
                "employers. To what extent do you agree or disagree?"
            ),
            "questionType": "Opinion",
            "tableTitle": "This should be removed",
            "tableColumns": ["A", "B", "C"],
            "tableRows": [["1", "2", "3"]] * 3,
        }
        with patch.object(main, "_openrouter_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/writing/topic",
                json={"mode": "task2", "recentTopics": []},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tableRows"], [])

    def test_writing_task_one_requires_rectangular_table(self) -> None:
        generated = {
            "title": "Transport use",
            "prompt": (
                "The table shows transport use. Summarise the main features and "
                "make comparisons where relevant."
            ),
            "questionType": "Academic table report",
            "tableTitle": "Journeys by mode (%)",
            "tableColumns": ["Mode", "2000", "2025"],
            "tableRows": [
                ["Car", "50", "40"],
                ["Bus", "20"],
                ["Rail", "30", "40"],
            ],
        }
        with patch.object(main, "_openrouter_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/writing/topic",
                json={"mode": "task1", "recentTopics": []},
            )
        self.assertEqual(response.status_code, 502)

    def test_writing_evaluation_uses_server_word_count(self) -> None:
        generated = {
            "overallBand": 7.5,
            "summary": "A clear and well-developed response.",
            "criteria": {
                "taskAchievementOrResponse": {
                    "band": 8,
                    "feedback": "The position is clear.",
                },
                "coherenceAndCohesion": {
                    "band": 7,
                    "feedback": "Paragraphing is logical.",
                },
                "lexicalResource": {
                    "band": 7.5,
                    "feedback": "Vocabulary is flexible.",
                },
                "grammaticalRangeAndAccuracy": {
                    "band": 7,
                    "feedback": "Complex structures are mostly accurate.",
                },
            },
            "strengths": ["Clear position"],
            "grammarCorrections": [],
            "suggestions": ["Develop the second example further."],
            "structureFeedback": "The introduction and body paragraphs are clear.",
            "targetStatus": "on track",
            "targetFocus": "Improve precision in supporting examples.",
            "wordCount": 999,
        }
        topic = {
            "id": "test-topic",
            "mode": "task2",
            "title": "Public transport",
            "prompt": "Should cities make public transport free? Discuss.",
            "questionType": "Opinion",
            "tableTitle": "",
            "tableColumns": [],
            "tableRows": [],
        }
        with patch.object(main, "_openrouter_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/writing/evaluate",
                json={
                    "topic": topic,
                    "essay": "Public transport should be free for everyone.",
                    "elapsedSeconds": 300,
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["wordCount"], 7)

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
