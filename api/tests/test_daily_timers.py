from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from api.daily_timers import DailyTimerService, TimerConflictError


TEST_ACTIVITIES = (
    {
        "key": "english-reading",
        "label": "Read English books",
        "description": "Read an English book.",
        "durationSeconds": 10,
    },
    {
        "key": "russian-reading",
        "label": "Read Russian books",
        "description": "Read a Russian book.",
        "durationSeconds": 10,
    },
)


class MutableClock:
    def __init__(self, current: datetime) -> None:
        self.current = current

    def __call__(self) -> datetime:
        return self.current


class DailyTimerServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_file = (
            Path(self.temporary_directory.name) / "daily_timers.sqlite3"
        )
        self.clock = MutableClock(
            datetime(2026, 7, 26, 8, 0, tzinfo=timezone.utc)
        )
        self.service = DailyTimerService(
            database_file=self.database_file,
            timezone_name="UTC",
            now_provider=self.clock,
            activities=TEST_ACTIVITIES,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_started_timer_is_server_timed_and_blocks_another_activity(self) -> None:
        response = self.service.start("english-reading")
        english, russian = response.activities

        self.assertEqual(english.status, "running")
        self.assertEqual(english.session.durationSeconds, 10)
        self.assertEqual(english.session.startedAt, "2026-07-26T08:00:00Z")
        self.assertEqual(english.session.endsAt, "2026-07-26T08:00:10Z")
        self.assertEqual(russian.status, "available")

        with self.assertRaises(TimerConflictError):
            self.service.start("russian-reading")

    def test_elapsed_timer_completes_and_persists_across_service_restart(self) -> None:
        self.service.start("english-reading")
        self.clock.current += timedelta(seconds=10)

        first = self.service.get()
        restarted_service = DailyTimerService(
            database_file=self.database_file,
            timezone_name="UTC",
            now_provider=self.clock,
            activities=TEST_ACTIVITIES,
        )
        persisted = restarted_service.get()

        self.assertEqual(first.activities[0].status, "completed")
        self.assertEqual(
            first.activities[0].session.completedAt,
            "2026-07-26T08:00:10Z",
        )
        self.assertEqual(persisted.activities[0].status, "completed")
        self.assertEqual(persisted.stats.completedSessions, 1)

    def test_completed_activity_cannot_restart_until_next_local_day(self) -> None:
        self.service.start("english-reading")
        self.clock.current += timedelta(seconds=10)
        self.service.get()

        with self.assertRaises(TimerConflictError):
            self.service.start("english-reading")

        self.clock.current += timedelta(days=1)
        response = self.service.start("english-reading")

        self.assertEqual(response.date, "2026-07-27")
        self.assertEqual(response.activities[0].status, "running")

    def test_stats_store_completed_minutes(self) -> None:
        service = DailyTimerService(
            database_file=self.database_file,
            timezone_name="UTC",
            now_provider=self.clock,
        )
        service.start("english-reading")
        self.clock.current += timedelta(minutes=25)

        response = service.get()

        self.assertEqual(response.stats.completedSessions, 1)
        self.assertEqual(response.stats.completedMinutes, 25)
        self.assertEqual(response.stats.completedToday, 1)


if __name__ == "__main__":
    unittest.main()
