from __future__ import annotations

import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from api.concept_memory import (
    DEFAULT_REVIEW_INTERVAL_DAYS,
    ConceptMemoryService,
    ConceptNotDueError,
)


class MutableClock:
    def __init__(self, value: datetime) -> None:
        self.value = value

    def __call__(self) -> datetime:
        return self.value


class ConceptMemoryServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_file = (
            Path(self.temporary_directory.name) / "concept_memory.sqlite3"
        )
        self.clock = MutableClock(
            datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
        )
        self.service = ConceptMemoryService(
            database_file=self.database_file,
            timezone_name="UTC",
            now_provider=self.clock,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_concept(self):
        response = self.service.create(
            concept="Why does retrieval practice work?",
            explanation="Retrieving strengthens later access to the memory.",
        )
        return response.upcomingConcepts[0]

    def test_new_concept_is_first_due_tomorrow(self) -> None:
        concept = self.create_concept()

        self.assertEqual(concept.nextReviewDate, "2026-08-10")
        self.assertEqual(concept.reviewNumber, 1)
        self.assertEqual(concept.intervalDays, 1)
        self.assertEqual(
            self.service.get().scheduleDays,
            list(DEFAULT_REVIEW_INTERVAL_DAYS),
        )

    def test_success_advances_to_the_next_expanding_interval(self) -> None:
        concept = self.create_concept()
        self.clock.value = datetime(2026, 8, 10, 8, 0, tzinfo=timezone.utc)

        result = self.service.review(concept.id, remembered=True)
        advanced = result.memory.upcomingConcepts[0]

        self.assertFalse(result.completed)
        self.assertEqual(advanced.reviewNumber, 2)
        self.assertEqual(advanced.intervalDays, 3)
        self.assertEqual(advanced.nextReviewDate, "2026-08-13")
        self.assertEqual(advanced.successfulRecalls, 1)

    def test_failure_retries_the_same_stage_tomorrow(self) -> None:
        concept = self.create_concept()
        self.clock.value = datetime(2026, 8, 10, 8, 0, tzinfo=timezone.utc)

        result = self.service.review(concept.id, remembered=False)
        retry = result.memory.upcomingConcepts[0]

        self.assertEqual(retry.reviewNumber, 1)
        self.assertEqual(retry.nextReviewDate, "2026-08-11")
        self.assertEqual(retry.failedRecalls, 1)
        self.assertEqual(result.memory.stats.reviewsToday, 1)

    def test_early_review_is_rejected(self) -> None:
        concept = self.create_concept()

        with self.assertRaises(ConceptNotDueError):
            self.service.review(concept.id, remembered=True)

    def test_last_success_archives_the_concept_as_fully_remembered(self) -> None:
        concept = self.create_concept()
        current_date = datetime(2026, 8, 10, 8, 0, tzinfo=timezone.utc)

        for interval_index in range(len(DEFAULT_REVIEW_INTERVAL_DAYS)):
            self.clock.value = current_date
            result = self.service.review(concept.id, remembered=True)
            if interval_index + 1 < len(DEFAULT_REVIEW_INTERVAL_DAYS):
                next_concept = result.memory.upcomingConcepts[0]
                current_date = datetime.fromisoformat(
                    f"{next_concept.nextReviewDate}T08:00:00+00:00"
                )

        self.assertTrue(result.completed)
        self.assertEqual(result.memory.stats.activeConcepts, 0)
        self.assertEqual(result.memory.stats.fullyRemembered, 1)
        with sqlite3.connect(self.database_file) as connection:
            status = connection.execute(
                "SELECT status FROM memory_concepts WHERE id = ?",
                (concept.id,),
            ).fetchone()[0]
        self.assertEqual(status, "completed")

    def test_delete_removes_an_active_concept_and_review_history(self) -> None:
        concept = self.create_concept()
        response = self.service.delete(concept.id)

        self.assertEqual(response.stats.activeConcepts, 0)
        with sqlite3.connect(self.database_file) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM memory_concepts"
            ).fetchone()[0]
        self.assertEqual(count, 0)
