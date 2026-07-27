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


def writing_topic_result(**overrides):
    result = {
        "title": "Public transport",
        "prompt": (
            "The visual shows changes in public transport use. Summarise the main "
            "features and make comparisons where relevant."
        ),
        "questionType": "Academic Writing Task 1",
        "visualType": "none",
        "visualTitle": "",
        "tableColumns": [],
        "tableRows": [],
        "chartCategories": [],
        "chartSeries": [],
        "processSteps": [],
        "mapBefore": [],
        "mapAfter": [],
        "bulletPoints": [],
    }
    result.update(overrides)
    return result


class DailyApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.original_data_file = main.BANS_DATA_FILE
        self.original_timer_service = main.daily_timer_service
        self.original_writing_progress_service = main.writing_progress_service
        main.BANS_DATA_FILE = Path(self.temporary_directory.name) / "bans.json"
        main.daily_timer_service = main.DailyTimerService(
            database_file=(
                Path(self.temporary_directory.name) / "daily_timers.sqlite3"
            ),
            timezone_name="UTC",
        )
        main.writing_progress_service = main.WritingProgressService(
            database_file=(
                Path(self.temporary_directory.name) / "ielts_writing.sqlite3"
            ),
        )
        main._provider_requests.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        main.BANS_DATA_FILE = self.original_data_file
        main.daily_timer_service = self.original_timer_service
        main.writing_progress_service = self.original_writing_progress_service
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

    def test_daily_timer_start_is_server_enforced(self) -> None:
        initial = self.client.get("/api/daily/timers")
        started = self.client.post("/api/daily/timers/english-reading/start")
        conflict = self.client.post("/api/daily/timers/russian-reading/start")

        self.assertEqual(initial.status_code, 200)
        self.assertEqual(
            [activity["status"] for activity in initial.json()["activities"]],
            ["available", "available"],
        )
        self.assertEqual(started.status_code, 200)
        self.assertEqual(
            started.json()["activities"][0]["status"],
            "running",
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertIn("already running", conflict.json()["detail"])

    def test_short_topic_discards_accidental_cue_points(self) -> None:
        generated = {
            "title": "Weekends",
            "prompt": "What do you usually enjoy doing at the weekend, and why?",
            "bulletPoints": ["This should be removed"],
        }
        with patch.object(main, "_openai_json", AsyncMock(return_value=generated)):
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
        with patch.object(main, "_openai_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/topic", json={"mode": "long", "recentTopics": []}
            )
        self.assertEqual(response.status_code, 502)

    def test_writing_essay_discards_visual_data(self) -> None:
        generated = writing_topic_result(
            title="Working from home",
            prompt=(
                "Some people believe working from home benefits both employees and "
                "employers. To what extent do you agree or disagree?"
            ),
            questionType="Opinion",
            visualType="table",
            visualTitle="This should be removed",
            tableColumns=["A", "B", "C"],
            tableRows=[["1", "2", "3"]] * 3,
        )
        with patch.object(main, "_openai_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/writing/topic",
                json={"mode": "essay_opinion", "recentTopics": []},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tableRows"], [])

    def test_writing_task_one_requires_rectangular_table(self) -> None:
        generated = writing_topic_result(
            title="Transport use",
            prompt=(
                "The table shows transport use. Summarise the main features and "
                "make comparisons where relevant."
            ),
            questionType="Academic table report",
            visualType="table",
            visualTitle="Journeys by mode (%)",
            tableColumns=["Mode", "2000", "2025"],
            tableRows=[
                ["Car", "50", "40"],
                ["Bus", "20"],
                ["Rail", "30", "40"],
            ],
        )
        with patch.object(main, "_openai_json", AsyncMock(return_value=generated)):
            response = self.client.post(
                "/api/ielts/writing/topic",
                json={"mode": "academic_table", "recentTopics": []},
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
            "rewrittenEssay": (
                "Public transport should be free for everyone because it would "
                "improve access and reduce congestion."
            ),
        }
        topic = {
            "id": "test-topic",
            "mode": "essay_opinion",
            "title": "Public transport",
            "prompt": "Should cities make public transport free? Discuss.",
            "questionType": "Opinion",
            "visualType": "none",
            "visualTitle": "",
            "tableColumns": [],
            "tableRows": [],
            "chartCategories": [],
            "chartSeries": [],
            "processSteps": [],
            "mapBefore": [],
            "mapAfter": [],
            "bulletPoints": [],
        }
        with patch.object(main, "_openai_json", AsyncMock(return_value=generated)):
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
        self.assertTrue(response.json()["attemptId"].startswith("writing-"))
        self.assertEqual(len(main.writing_progress_service.summaries()), 1)

    def test_delivery_stats_use_transcript_and_recording_duration(self) -> None:
        stats = main._calculate_delivery_stats(
            "I enjoy reading because it helps me relax.",
            5.0,
        )
        self.assertEqual(stats["wordCount"], 8)
        self.assertEqual(stats["wordsPerMinute"], 96)
        self.assertEqual(stats["recordedSeconds"], 5.0)

    def test_transcription_rejects_non_audio_body_before_provider_call(self) -> None:
        with patch.object(main, "OPENAI_API_KEY", "test-key"):
            response = self.client.post(
                "/api/ielts/transcribe",
                content=b"not audio" * 100,
                headers={"Content-Type": "text/plain"},
            )
        self.assertEqual(response.status_code, 415)

    def test_transcription_combines_text_and_audio_delivery(self) -> None:
        audio_assessment = main.AudioDeliveryAssessment.model_validate(
            {
                "pronunciation": {"band": 7.5, "feedback": "Clear articulation."},
                "naturalness": {"band": 7, "feedback": "Mostly natural pacing."},
                "rhythmAndStress": {
                    "band": 7,
                    "feedback": "Key words usually receive stress.",
                },
                "intelligibility": {
                    "band": 8,
                    "feedback": "Easy to understand.",
                },
                "summary": "Clear, natural, and intelligible overall.",
            }
        )
        with (
            patch.object(main, "OPENAI_API_KEY", "test-key"),
            patch.object(
                main,
                "_openai_transcribe",
                AsyncMock(return_value="I enjoy learning languages."),
            ),
            patch.object(
                main,
                "_openai_audio_assessment",
                AsyncMock(return_value=audio_assessment),
            ),
        ):
            response = self.client.post(
                "/api/ielts/transcribe",
                content=b"RIFF" + b"\0" * 512,
                headers={
                    "Content-Type": "audio/wav",
                    "X-Recording-Duration-Ms": "5000",
                },
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["transcript"], "I enjoy learning languages.")
        self.assertEqual(payload["audioAssessment"]["pronunciation"]["band"], 7.5)
        self.assertEqual(payload["stats"]["wordCount"], 4)

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
