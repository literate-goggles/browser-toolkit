"""Server-enforced daily focus timers backed by SQLite."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field


TIMER_DURATION_SECONDS = 25 * 60
TimerStatus = Literal["available", "running", "completed"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TimerSession(StrictModel):
    id: str
    activityKey: str
    localDate: str
    startedAt: str
    endsAt: str
    completedAt: str | None
    durationSeconds: int = Field(gt=0)


class DailyTimerActivity(StrictModel):
    key: str
    label: str
    description: str
    durationSeconds: int = Field(gt=0)
    status: TimerStatus
    session: TimerSession | None


class DailyTimerStats(StrictModel):
    completedSessions: int = Field(ge=0)
    completedMinutes: int = Field(ge=0)
    completedToday: int = Field(ge=0)


class DailyTimersResponse(StrictModel):
    date: str
    timezone: str
    serverNow: str
    activities: list[DailyTimerActivity]
    stats: DailyTimerStats


class TimerConflictError(RuntimeError):
    """The requested activity cannot start because of existing timer state."""


class UnknownTimerActivityError(ValueError):
    """The requested activity key is not configured."""


DEFAULT_ACTIVITIES: tuple[dict[str, str | int], ...] = (
    {
        "key": "english-reading",
        "label": "Read English books",
        "description": (
            "Twenty-five uninterrupted minutes with an English-language book."
        ),
        "durationSeconds": TIMER_DURATION_SECONDS,
    },
    {
        "key": "russian-reading",
        "label": "Read Russian books",
        "description": (
            "Twenty-five uninterrupted minutes with a Russian-language book."
        ),
        "durationSeconds": TIMER_DURATION_SECONDS,
    },
)


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class DailyTimerService:
    def __init__(
        self,
        *,
        database_file: Path,
        timezone_name: str,
        now_provider: Callable[[], datetime] | None = None,
        activities: tuple[dict[str, str | int], ...] = DEFAULT_ACTIVITIES,
    ) -> None:
        self.database_file = database_file
        self.timezone_name = timezone_name or "UTC"
        try:
            self.timezone = ZoneInfo(self.timezone_name)
        except ZoneInfoNotFoundError:
            print(
                f"[daily-timers] unknown timezone {self.timezone_name!r}; using UTC",
                flush=True,
            )
            self.timezone_name = "UTC"
            self.timezone = ZoneInfo("UTC")
        self._now_provider = now_provider or (lambda: datetime.now(timezone.utc))
        self.activities = {
            str(activity["key"]): {
                "key": str(activity["key"]),
                "label": str(activity["label"]),
                "description": str(activity["description"]),
                "durationSeconds": int(activity["durationSeconds"]),
            }
            for activity in activities
        }
        if not self.activities:
            raise ValueError("at least one daily timer activity is required")
        if any(
            int(activity["durationSeconds"]) <= 0
            for activity in self.activities.values()
        ):
            raise ValueError("daily timer durations must be positive")
        self._lock = threading.Lock()
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_file, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize_database(self) -> None:
        self.database_file.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS routine_sessions (
                    id TEXT PRIMARY KEY,
                    activity_key TEXT NOT NULL,
                    local_date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ends_at TEXT NOT NULL,
                    completed_at TEXT,
                    duration_seconds INTEGER NOT NULL
                        CHECK (duration_seconds > 0),
                    UNIQUE (activity_key, local_date)
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS
                    routine_sessions_completed_at_index
                ON routine_sessions (completed_at)
                """
            )
            connection.execute("PRAGMA user_version = 1")

    def _now(self) -> datetime:
        value = self._now_provider()
        if value.tzinfo is None:
            raise ValueError("daily timer clock must return a timezone-aware datetime")
        return value.astimezone(timezone.utc)

    @staticmethod
    def _complete_elapsed(
        connection: sqlite3.Connection,
        now: datetime,
    ) -> None:
        now_iso = _utc_iso(now)
        connection.execute(
            """
            UPDATE routine_sessions
            SET completed_at = ends_at
            WHERE completed_at IS NULL AND ends_at <= ?
            """,
            (now_iso,),
        )

    @staticmethod
    def _session(row: sqlite3.Row) -> TimerSession:
        return TimerSession(
            id=str(row["id"]),
            activityKey=str(row["activity_key"]),
            localDate=str(row["local_date"]),
            startedAt=str(row["started_at"]),
            endsAt=str(row["ends_at"]),
            completedAt=(
                str(row["completed_at"]) if row["completed_at"] is not None else None
            ),
            durationSeconds=int(row["duration_seconds"]),
        )

    def _response(
        self,
        connection: sqlite3.Connection,
        now: datetime,
    ) -> DailyTimersResponse:
        local_date = now.astimezone(self.timezone).date().isoformat()
        now_iso = _utc_iso(now)
        activities: list[DailyTimerActivity] = []
        for activity in self.activities.values():
            row = connection.execute(
                """
                SELECT *
                FROM routine_sessions
                WHERE activity_key = ? AND local_date = ?
                LIMIT 1
                """,
                (activity["key"], local_date),
            ).fetchone()
            if row is None:
                row = connection.execute(
                    """
                    SELECT *
                    FROM routine_sessions
                    WHERE activity_key = ?
                      AND completed_at IS NULL
                      AND ends_at > ?
                    ORDER BY started_at DESC
                    LIMIT 1
                    """,
                    (activity["key"], now_iso),
                ).fetchone()
            session = self._session(row) if row is not None else None
            if session is None:
                timer_status: TimerStatus = "available"
            elif session.completedAt is not None:
                timer_status = "completed"
            else:
                timer_status = "running"
            activities.append(
                DailyTimerActivity(
                    **activity,
                    status=timer_status,
                    session=session,
                )
            )

        completed = connection.execute(
            """
            SELECT
                COUNT(*) AS session_count,
                COALESCE(SUM(duration_seconds), 0) AS total_seconds
            FROM routine_sessions
            WHERE completed_at IS NOT NULL
            """
        ).fetchone()
        completed_today = connection.execute(
            """
            SELECT COUNT(*) AS session_count
            FROM routine_sessions
            WHERE completed_at IS NOT NULL AND local_date = ?
            """,
            (local_date,),
        ).fetchone()
        return DailyTimersResponse(
            date=local_date,
            timezone=self.timezone_name,
            serverNow=now_iso,
            activities=activities,
            stats=DailyTimerStats(
                completedSessions=int(completed["session_count"]),
                completedMinutes=int(completed["total_seconds"]) // 60,
                completedToday=int(completed_today["session_count"]),
            ),
        )

    def get(self) -> DailyTimersResponse:
        now = self._now()
        with self._lock, self._connect() as connection:
            self._complete_elapsed(connection, now)
            return self._response(connection, now)

    def start(self, activity_key: str) -> DailyTimersResponse:
        activity = self.activities.get(activity_key)
        if activity is None:
            raise UnknownTimerActivityError(
                f"Unknown daily timer activity: {activity_key}"
            )

        now = self._now()
        now_iso = _utc_iso(now)
        local_date = now.astimezone(self.timezone).date().isoformat()
        ends_at = now + timedelta(seconds=int(activity["durationSeconds"]))
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._complete_elapsed(connection, now)
            existing = connection.execute(
                """
                SELECT *
                FROM routine_sessions
                WHERE activity_key = ? AND local_date = ?
                LIMIT 1
                """,
                (activity_key, local_date),
            ).fetchone()
            if existing is not None:
                if existing["completed_at"] is not None:
                    raise TimerConflictError(
                        f"{activity['label']} is already completed for today."
                    )
                return self._response(connection, now)

            active = connection.execute(
                """
                SELECT activity_key
                FROM routine_sessions
                WHERE completed_at IS NULL AND ends_at > ?
                ORDER BY started_at DESC
                LIMIT 1
                """,
                (now_iso,),
            ).fetchone()
            if active is not None:
                active_activity = self.activities.get(str(active["activity_key"]))
                active_label = (
                    str(active_activity["label"])
                    if active_activity is not None
                    else "Another focus timer"
                )
                raise TimerConflictError(
                    f"{active_label} is already running. Finish it before starting "
                    "another timer."
                )

            connection.execute(
                """
                INSERT INTO routine_sessions (
                    id,
                    activity_key,
                    local_date,
                    started_at,
                    ends_at,
                    completed_at,
                    duration_seconds
                )
                VALUES (?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    str(uuid.uuid4()),
                    activity_key,
                    local_date,
                    now_iso,
                    _utc_iso(ends_at),
                    int(activity["durationSeconds"]),
                ),
            )
            return self._response(connection, now)
