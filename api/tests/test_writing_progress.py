from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from api.writing_progress import WritingProgressService


def topic() -> dict:
    return {
        "id": "topic-123",
        "mode": "essay_opinion",
        "title": "Public transport",
        "prompt": "Should public transport be free?",
    }


def evaluation(*, overall_band: float = 7.0) -> dict:
    return {
        "overallBand": overall_band,
        "summary": "A clear response.",
        "criteria": {
            "taskAchievementOrResponse": {
                "band": 7.0,
                "feedback": "Clear position.",
            },
            "coherenceAndCohesion": {
                "band": 7.0,
                "feedback": "Logical progression.",
            },
            "lexicalResource": {
                "band": 7.5,
                "feedback": "Flexible vocabulary.",
            },
            "grammaticalRangeAndAccuracy": {
                "band": 6.5,
                "feedback": "Some errors remain.",
            },
        },
        "strengths": ["Clear position"],
        "grammarCorrections": [],
        "suggestions": ["Develop the example."],
        "structureFeedback": "The structure is clear.",
        "targetStatus": "close",
        "targetFocus": "Improve grammatical control.",
        "wordCount": 8,
        "rewrittenEssay": (
            "Public transport should be free because this would improve access "
            "while reducing congestion."
        ),
    }


class WritingProgressServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_file = (
            Path(self.temporary_directory.name) / "ielts_writing.sqlite3"
        )
        self.saved_at = datetime(2026, 7, 27, 12, 30, tzinfo=timezone.utc)
        self.service = WritingProgressService(
            database_file=self.database_file,
            now_provider=lambda: self.saved_at,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_saves_complete_attempt_for_future_progress_tracking(self) -> None:
        saved = self.service.save(
            topic=topic(),
            essay="Public transport should be free for everyone.",
            elapsed_seconds=300,
            evaluation=evaluation(),
        )

        summaries = self.service.summaries()
        with sqlite3.connect(self.database_file) as connection:
            stored = connection.execute(
                """
                SELECT essay, rewritten_essay, evaluation_json
                FROM writing_attempts
                WHERE id = ?
                """,
                (saved.id,),
            ).fetchone()

        self.assertEqual(saved.savedAt, "2026-07-27T12:30:00Z")
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0].overallBand, 7.0)
        self.assertEqual(
            stored[0],
            "Public transport should be free for everyone.",
        )
        self.assertIn("reducing congestion", stored[1])
        self.assertIn('"grammarCorrections":[]', stored[2])

    def test_retry_updates_one_deterministic_attempt_instead_of_duplicating(self) -> None:
        first = self.service.save(
            topic=topic(),
            essay="Public transport should be free for everyone.",
            elapsed_seconds=300,
            evaluation=evaluation(overall_band=7.0),
        )
        second = self.service.save(
            topic=topic(),
            essay="Public transport should be free for everyone.",
            elapsed_seconds=300,
            evaluation=evaluation(overall_band=7.5),
        )

        reopened = WritingProgressService(database_file=self.database_file)
        summaries = reopened.summaries()

        self.assertEqual(first.id, second.id)
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0].overallBand, 7.5)


if __name__ == "__main__":
    unittest.main()
