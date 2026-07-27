"""Durable IELTS writing-attempt history backed by SQLite."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SavedWritingAttempt(StrictModel):
    id: str
    savedAt: str


class WritingAttemptSummary(StrictModel):
    id: str
    savedAt: str
    mode: str
    title: str
    overallBand: float = Field(ge=0, le=9)
    wordCount: int = Field(ge=0)
    elapsedSeconds: float = Field(ge=0)
    taskAchievementOrResponseBand: float = Field(ge=0, le=9)
    coherenceAndCohesionBand: float = Field(ge=0, le=9)
    lexicalResourceBand: float = Field(ge=0, le=9)
    grammaticalRangeAndAccuracyBand: float = Field(ge=0, le=9)
    targetStatus: str


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class WritingProgressService:
    def __init__(
        self,
        *,
        database_file: Path,
        now_provider: Callable[[], datetime] | None = None,
    ) -> None:
        self.database_file = database_file
        self._now_provider = now_provider or (lambda: datetime.now(timezone.utc))
        self._lock = threading.Lock()
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_file, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _initialize_database(self) -> None:
        self.database_file.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS writing_attempts (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    topic_id TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    topic_json TEXT NOT NULL,
                    essay TEXT NOT NULL,
                    rewritten_essay TEXT NOT NULL,
                    elapsed_seconds REAL NOT NULL
                        CHECK (elapsed_seconds >= 0),
                    word_count INTEGER NOT NULL
                        CHECK (word_count >= 0),
                    overall_band REAL NOT NULL
                        CHECK (overall_band >= 0 AND overall_band <= 9),
                    task_band REAL NOT NULL,
                    coherence_band REAL NOT NULL,
                    lexical_band REAL NOT NULL,
                    grammar_band REAL NOT NULL,
                    target_status TEXT NOT NULL,
                    evaluation_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS writing_attempts_created_at_index
                ON writing_attempts (created_at DESC)
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS writing_attempts_mode_index
                ON writing_attempts (mode, created_at DESC)
                """
            )
            connection.execute("PRAGMA user_version = 1")

    def _now(self) -> datetime:
        value = self._now_provider()
        if value.tzinfo is None:
            raise ValueError("writing progress clock must be timezone-aware")
        return value.astimezone(timezone.utc)

    @staticmethod
    def _attempt_id(topic_id: str, essay: str) -> str:
        digest = hashlib.sha256(
            f"{topic_id}\0{essay}".encode("utf-8")
        ).hexdigest()
        return f"writing-{digest[:32]}"

    def save(
        self,
        *,
        topic: dict[str, Any],
        essay: str,
        elapsed_seconds: float,
        evaluation: dict[str, Any],
    ) -> SavedWritingAttempt:
        topic_id = str(topic["id"])
        attempt_id = self._attempt_id(topic_id, essay)
        now_iso = _utc_iso(self._now())
        criteria = evaluation["criteria"]
        values = (
            attempt_id,
            now_iso,
            now_iso,
            topic_id,
            str(topic["mode"]),
            str(topic["title"]),
            str(topic["prompt"]),
            json.dumps(topic, ensure_ascii=False, separators=(",", ":")),
            essay,
            str(evaluation["rewrittenEssay"]),
            float(elapsed_seconds),
            int(evaluation["wordCount"]),
            float(evaluation["overallBand"]),
            float(criteria["taskAchievementOrResponse"]["band"]),
            float(criteria["coherenceAndCohesion"]["band"]),
            float(criteria["lexicalResource"]["band"]),
            float(criteria["grammaticalRangeAndAccuracy"]["band"]),
            str(evaluation["targetStatus"]),
            json.dumps(
                evaluation,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO writing_attempts (
                    id,
                    created_at,
                    updated_at,
                    topic_id,
                    mode,
                    title,
                    prompt,
                    topic_json,
                    essay,
                    rewritten_essay,
                    elapsed_seconds,
                    word_count,
                    overall_band,
                    task_band,
                    coherence_band,
                    lexical_band,
                    grammar_band,
                    target_status,
                    evaluation_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    rewritten_essay = excluded.rewritten_essay,
                    overall_band = excluded.overall_band,
                    task_band = excluded.task_band,
                    coherence_band = excluded.coherence_band,
                    lexical_band = excluded.lexical_band,
                    grammar_band = excluded.grammar_band,
                    target_status = excluded.target_status,
                    evaluation_json = excluded.evaluation_json
                """,
                values,
            )
            row = connection.execute(
                """
                SELECT id, created_at
                FROM writing_attempts
                WHERE id = ?
                """,
                (attempt_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("saved writing attempt could not be read back")
        return SavedWritingAttempt(
            id=str(row["id"]),
            savedAt=str(row["created_at"]),
        )

    def summaries(self, *, limit: int = 100) -> list[WritingAttemptSummary]:
        safe_limit = min(500, max(1, int(limit)))
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    id,
                    created_at,
                    mode,
                    title,
                    overall_band,
                    word_count,
                    elapsed_seconds,
                    task_band,
                    coherence_band,
                    lexical_band,
                    grammar_band,
                    target_status
                FROM writing_attempts
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        return [
            WritingAttemptSummary(
                id=str(row["id"]),
                savedAt=str(row["created_at"]),
                mode=str(row["mode"]),
                title=str(row["title"]),
                overallBand=float(row["overall_band"]),
                wordCount=int(row["word_count"]),
                elapsedSeconds=float(row["elapsed_seconds"]),
                taskAchievementOrResponseBand=float(row["task_band"]),
                coherenceAndCohesionBand=float(row["coherence_band"]),
                lexicalResourceBand=float(row["lexical_band"]),
                grammaticalRangeAndAccuracyBand=float(row["grammar_band"]),
                targetStatus=str(row["target_status"]),
            )
            for row in rows
        ]
