"""Spaced active-recall concepts backed by SQLite."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field


# Retrieval practice works best across separate sessions, but no single interval
# sequence is optimal for every retention horizon. This expanding schedule is a
# simple, legible default; failed recalls repeat the current step tomorrow.
DEFAULT_REVIEW_INTERVAL_DAYS: tuple[int, ...] = (1, 3, 7, 14, 30, 60, 120)
ConceptStatus = Literal["due", "upcoming"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MemoryConcept(StrictModel):
    id: str
    concept: str
    explanation: str
    createdAt: str
    lastReviewedAt: str | None
    nextReviewDate: str
    status: ConceptStatus
    reviewNumber: int = Field(ge=1)
    totalReviews: int = Field(ge=1)
    intervalDays: int = Field(ge=1)
    successfulRecalls: int = Field(ge=0)
    failedRecalls: int = Field(ge=0)
    overdueDays: int = Field(ge=0)


class ConceptMemoryStats(StrictModel):
    dueToday: int = Field(ge=0)
    activeConcepts: int = Field(ge=0)
    fullyRemembered: int = Field(ge=0)
    reviewsToday: int = Field(ge=0)


class ConceptMemoryResponse(StrictModel):
    date: str
    timezone: str
    scheduleDays: list[int]
    dueConcepts: list[MemoryConcept]
    upcomingConcepts: list[MemoryConcept]
    stats: ConceptMemoryStats


class ConceptReviewResult(StrictModel):
    completed: bool
    message: str
    memory: ConceptMemoryResponse


class ConceptNotFoundError(KeyError):
    """The requested active concept does not exist."""


class ConceptNotDueError(RuntimeError):
    """The requested concept is not due for recall yet."""


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class ConceptMemoryService:
    def __init__(
        self,
        *,
        database_file: Path,
        timezone_name: str,
        now_provider: Callable[[], datetime] | None = None,
        review_intervals: tuple[int, ...] = DEFAULT_REVIEW_INTERVAL_DAYS,
    ) -> None:
        self.database_file = database_file
        self.timezone_name = timezone_name or "UTC"
        try:
            self.timezone = ZoneInfo(self.timezone_name)
        except ZoneInfoNotFoundError:
            print(
                f"[concept-memory] unknown timezone {self.timezone_name!r}; "
                "using UTC",
                flush=True,
            )
            self.timezone_name = "UTC"
            self.timezone = ZoneInfo("UTC")
        self._now_provider = now_provider or (lambda: datetime.now(timezone.utc))
        self.review_intervals = tuple(int(days) for days in review_intervals)
        if not self.review_intervals or any(
            days <= 0 for days in self.review_intervals
        ):
            raise ValueError("concept review intervals must be positive")
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
                CREATE TABLE IF NOT EXISTS memory_concepts (
                    id TEXT PRIMARY KEY,
                    concept TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_reviewed_at TEXT,
                    next_review_date TEXT,
                    review_stage INTEGER NOT NULL DEFAULT 0
                        CHECK (review_stage >= 0),
                    successful_recalls INTEGER NOT NULL DEFAULT 0
                        CHECK (successful_recalls >= 0),
                    failed_recalls INTEGER NOT NULL DEFAULT 0
                        CHECK (failed_recalls >= 0),
                    status TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed')),
                    completed_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS memory_concepts_queue_index
                ON memory_concepts (status, next_review_date, created_at)
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS memory_concept_reviews (
                    id TEXT PRIMARY KEY,
                    concept_id TEXT NOT NULL,
                    reviewed_at TEXT NOT NULL,
                    local_date TEXT NOT NULL,
                    due_date TEXT NOT NULL,
                    remembered INTEGER NOT NULL CHECK (remembered IN (0, 1)),
                    previous_stage INTEGER NOT NULL,
                    next_stage INTEGER,
                    next_review_date TEXT,
                    completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
                    FOREIGN KEY (concept_id) REFERENCES memory_concepts (id)
                        ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS memory_concept_reviews_date_index
                ON memory_concept_reviews (local_date, reviewed_at)
                """
            )
            connection.execute("PRAGMA user_version = 1")

    def _now(self) -> datetime:
        value = self._now_provider()
        if value.tzinfo is None:
            raise ValueError(
                "concept memory clock must return a timezone-aware datetime"
            )
        return value.astimezone(timezone.utc)

    def _local_date(self, now: datetime) -> date:
        return now.astimezone(self.timezone).date()

    def _concept(self, row: sqlite3.Row, today: date) -> MemoryConcept:
        next_review_date = date.fromisoformat(str(row["next_review_date"]))
        stage = int(row["review_stage"])
        return MemoryConcept(
            id=str(row["id"]),
            concept=str(row["concept"]),
            explanation=str(row["explanation"]),
            createdAt=str(row["created_at"]),
            lastReviewedAt=(
                str(row["last_reviewed_at"])
                if row["last_reviewed_at"] is not None
                else None
            ),
            nextReviewDate=next_review_date.isoformat(),
            status="due" if next_review_date <= today else "upcoming",
            reviewNumber=stage + 1,
            totalReviews=len(self.review_intervals),
            intervalDays=self.review_intervals[stage],
            successfulRecalls=int(row["successful_recalls"]),
            failedRecalls=int(row["failed_recalls"]),
            overdueDays=max(0, (today - next_review_date).days),
        )

    def _response(
        self,
        connection: sqlite3.Connection,
        now: datetime,
    ) -> ConceptMemoryResponse:
        today = self._local_date(now)
        rows = connection.execute(
            """
            SELECT *
            FROM memory_concepts
            WHERE status = 'active'
            ORDER BY next_review_date ASC, created_at ASC
            """
        ).fetchall()
        concepts = [self._concept(row, today) for row in rows]
        due = [concept for concept in concepts if concept.status == "due"]
        upcoming = [
            concept for concept in concepts if concept.status == "upcoming"
        ]
        completed = connection.execute(
            """
            SELECT COUNT(*) AS concept_count
            FROM memory_concepts
            WHERE status = 'completed'
            """
        ).fetchone()
        reviews_today = connection.execute(
            """
            SELECT COUNT(*) AS review_count
            FROM memory_concept_reviews
            WHERE local_date = ?
            """,
            (today.isoformat(),),
        ).fetchone()
        return ConceptMemoryResponse(
            date=today.isoformat(),
            timezone=self.timezone_name,
            scheduleDays=list(self.review_intervals),
            dueConcepts=due,
            upcomingConcepts=upcoming,
            stats=ConceptMemoryStats(
                dueToday=len(due),
                activeConcepts=len(concepts),
                fullyRemembered=int(completed["concept_count"]),
                reviewsToday=int(reviews_today["review_count"]),
            ),
        )

    def get(self) -> ConceptMemoryResponse:
        now = self._now()
        with self._lock, self._connect() as connection:
            return self._response(connection, now)

    def create(self, *, concept: str, explanation: str) -> ConceptMemoryResponse:
        now = self._now()
        today = self._local_date(now)
        next_review = today + timedelta(days=self.review_intervals[0])
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO memory_concepts (
                    id,
                    concept,
                    explanation,
                    created_at,
                    next_review_date
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    concept,
                    explanation,
                    _utc_iso(now),
                    next_review.isoformat(),
                ),
            )
            return self._response(connection, now)

    def review(
        self,
        concept_id: str,
        *,
        remembered: bool,
    ) -> ConceptReviewResult:
        now = self._now()
        now_iso = _utc_iso(now)
        today = self._local_date(now)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT *
                FROM memory_concepts
                WHERE id = ? AND status = 'active'
                LIMIT 1
                """,
                (concept_id,),
            ).fetchone()
            if row is None:
                raise ConceptNotFoundError(concept_id)

            due_date = date.fromisoformat(str(row["next_review_date"]))
            if due_date > today:
                raise ConceptNotDueError(
                    f"This concept is due on {due_date.isoformat()}."
                )

            previous_stage = int(row["review_stage"])
            completed = bool(
                remembered and previous_stage == len(self.review_intervals) - 1
            )
            if completed:
                next_stage: int | None = None
                next_review: date | None = None
                connection.execute(
                    """
                    UPDATE memory_concepts
                    SET last_reviewed_at = ?,
                        successful_recalls = successful_recalls + 1,
                        status = 'completed',
                        completed_at = ?,
                        next_review_date = NULL
                    WHERE id = ?
                    """,
                    (now_iso, now_iso, concept_id),
                )
            elif remembered:
                next_stage = previous_stage + 1
                next_review = today + timedelta(
                    days=self.review_intervals[next_stage]
                )
                connection.execute(
                    """
                    UPDATE memory_concepts
                    SET last_reviewed_at = ?,
                        successful_recalls = successful_recalls + 1,
                        review_stage = ?,
                        next_review_date = ?
                    WHERE id = ?
                    """,
                    (
                        now_iso,
                        next_stage,
                        next_review.isoformat(),
                        concept_id,
                    ),
                )
            else:
                next_stage = previous_stage
                next_review = today + timedelta(days=1)
                connection.execute(
                    """
                    UPDATE memory_concepts
                    SET last_reviewed_at = ?,
                        failed_recalls = failed_recalls + 1,
                        next_review_date = ?
                    WHERE id = ?
                    """,
                    (now_iso, next_review.isoformat(), concept_id),
                )

            connection.execute(
                """
                INSERT INTO memory_concept_reviews (
                    id,
                    concept_id,
                    reviewed_at,
                    local_date,
                    due_date,
                    remembered,
                    previous_stage,
                    next_stage,
                    next_review_date,
                    completed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uuid.uuid4().hex,
                    concept_id,
                    now_iso,
                    today.isoformat(),
                    due_date.isoformat(),
                    int(remembered),
                    previous_stage,
                    next_stage,
                    next_review.isoformat() if next_review else None,
                    int(completed),
                ),
            )
            memory = self._response(connection, now)

        if completed:
            message = "Fully remembered. The concept has left your active queue."
        elif remembered and next_review is not None:
            message = f"Remembered. The next recall is {next_review.isoformat()}."
        else:
            message = "Not yet. The same recall step will return tomorrow."
        return ConceptReviewResult(
            completed=completed,
            message=message,
            memory=memory,
        )

    def delete(self, concept_id: str) -> ConceptMemoryResponse:
        now = self._now()
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            result = connection.execute(
                """
                DELETE FROM memory_concepts
                WHERE id = ? AND status = 'active'
                """,
                (concept_id,),
            )
            if result.rowcount == 0:
                raise ConceptNotFoundError(concept_id)
            return self._response(connection, now)
