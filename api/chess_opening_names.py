"""Random named-opening positions from the Lichess CC0 opening dataset."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import os
import secrets
from collections import defaultdict
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import chess
import chess.pgn
import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError


FetchText = Callable[[str], Awaitable[str]]
SOURCE_REPOSITORY = "https://github.com/lichess-org/chess-openings"
SOURCE_URLS = tuple(
    f"https://raw.githubusercontent.com/lichess-org/chess-openings/master/{volume}.tsv"
    for volume in "abcde"
)
CACHE_VERSION = 1
CACHE_MAX_AGE = timedelta(days=30)
MIN_PLY = 4
MAX_PLY = 22
UCI_PATTERN = r"^[a-h][1-8][a-h][1-8][qrbn]?$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpeningBookMove(StrictModel):
    uci: str = Field(pattern=UCI_PATTERN)
    san: str = Field(min_length=1, max_length=20)
    openingNames: list[str] = Field(min_length=1, max_length=20)


class OpeningNameDrill(StrictModel):
    id: str = Field(min_length=16, max_length=64)
    eco: str = Field(pattern=r"^[A-E][0-9]{2}$")
    name: str = Field(min_length=2, max_length=220)
    fen: str = Field(min_length=20, max_length=120)
    ply: int = Field(ge=MIN_PLY, le=MAX_PLY)
    moveNumber: int = Field(ge=1, le=20)
    sideToMove: Literal["white", "black"]
    orientation: Literal["white"] = "white"
    movesBefore: str = Field(min_length=2, max_length=1_200)
    nameOptions: list[str] = Field(min_length=2, max_length=6)
    askNextMove: bool
    nextMoves: list[OpeningBookMove] = Field(max_length=20)


class OpeningNameResponse(StrictModel):
    drill: OpeningNameDrill
    poolSize: int = Field(ge=1)
    sourceLabel: str
    sourceUrl: str


class OpeningPosition(StrictModel):
    id: str
    eco: str
    name: str
    fen: str
    ply: int
    movesBefore: str
    uciMoves: list[str]
    nextMoves: list[OpeningBookMove]


def _utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _format_moves(sans: list[str]) -> str:
    tokens: list[str] = []
    for ply, san in enumerate(sans):
        if ply % 2 == 0:
            tokens.append(f"{ply // 2 + 1}. {san}")
        else:
            tokens.append(san)
    return " ".join(tokens)


def _parse_pgn_moves(pgn: str) -> tuple[list[str], list[str], str] | None:
    game = chess.pgn.read_game(io.StringIO(f'[Result "*"]\n\n{pgn} *'))
    if game is None or game.errors:
        return None
    board = game.board()
    uci_moves: list[str] = []
    sans: list[str] = []
    try:
        for move in game.mainline_moves():
            sans.append(board.san(move))
            uci_moves.append(move.uci())
            board.push(move)
    except (AssertionError, ValueError):
        return None
    if not uci_moves:
        return None
    return uci_moves, sans, board.fen()


async def _default_fetch_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
        response = await client.get(
            url,
            headers={"User-Agent": "daily.chebakov.me opening-name trainer"},
        )
    response.raise_for_status()
    return response.text


class ChessOpeningNamesService:
    def __init__(
        self,
        *,
        cache_file: Path,
        fetch_text: FetchText = _default_fetch_text,
    ) -> None:
        self.cache_file = cache_file
        self._fetch_text = fetch_text
        self._pool: list[OpeningPosition] | None = None
        self._load_lock = asyncio.Lock()

    def _read_cache(self) -> tuple[datetime, list[OpeningPosition]] | None:
        try:
            payload = json.loads(self.cache_file.read_text(encoding="utf-8"))
            if payload.get("version") != CACHE_VERSION:
                return None
            fetched_at = datetime.fromisoformat(
                str(payload["fetchedAt"]).replace("Z", "+00:00")
            ).astimezone(timezone.utc)
            positions = [
                OpeningPosition.model_validate(item)
                for item in payload.get("positions") or []
            ]
            if not positions:
                return None
            return fetched_at, positions
        except (
            FileNotFoundError,
            KeyError,
            OSError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            ValidationError,
        ):
            return None

    def _write_cache(self, positions: list[OpeningPosition]) -> None:
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": CACHE_VERSION,
            "fetchedAt": _utc_iso(datetime.now(timezone.utc)),
            "source": SOURCE_REPOSITORY,
            "positions": [position.model_dump() for position in positions],
        }
        temporary = self.cache_file.with_suffix(self.cache_file.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary, self.cache_file)

    @staticmethod
    def _build_pool(source_texts: list[str]) -> list[OpeningPosition]:
        raw_entries: list[dict[str, Any]] = []
        seen_entries: set[tuple[str, tuple[str, ...]]] = set()
        continuations: dict[tuple[str, ...], dict[str, dict[str, Any]]] = (
            defaultdict(dict)
        )

        for source_text in source_texts:
            for row in csv.DictReader(io.StringIO(source_text), delimiter="\t"):
                eco = str(row.get("eco") or "").strip()
                name = str(row.get("name") or "").strip()
                pgn = str(row.get("pgn") or "").strip()
                if not eco or not name or not pgn:
                    continue
                parsed = _parse_pgn_moves(pgn)
                if parsed is None:
                    continue
                uci_moves, sans, fen = parsed
                sequence = tuple(uci_moves)
                entry_key = (name, sequence)
                if entry_key in seen_entries:
                    continue
                seen_entries.add(entry_key)
                raw_entries.append(
                    {
                        "eco": eco,
                        "name": name,
                        "uciMoves": uci_moves,
                        "sans": sans,
                        "fen": fen,
                    }
                )
                for index, (uci, san) in enumerate(zip(uci_moves, sans, strict=True)):
                    prefix = tuple(uci_moves[:index])
                    continuation = continuations[prefix].setdefault(
                        uci,
                        {"san": san, "openingNames": set()},
                    )
                    continuation["openingNames"].add(name)

        positions: list[OpeningPosition] = []
        for entry in raw_entries:
            uci_moves = list(entry["uciMoves"])
            ply = len(uci_moves)
            if not MIN_PLY <= ply <= MAX_PLY:
                continue
            next_moves = [
                OpeningBookMove(
                    uci=uci,
                    san=str(move["san"]),
                    openingNames=sorted(move["openingNames"])[:20],
                )
                for uci, move in sorted(
                    continuations.get(tuple(uci_moves), {}).items()
                )
            ]
            identity = f"{entry['eco']}|{entry['name']}|{' '.join(uci_moves)}"
            positions.append(
                OpeningPosition(
                    id=hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24],
                    eco=str(entry["eco"]),
                    name=str(entry["name"]),
                    fen=str(entry["fen"]),
                    ply=ply,
                    movesBefore=_format_moves(list(entry["sans"])),
                    uciMoves=uci_moves,
                    nextMoves=next_moves,
                )
            )
        if not positions:
            raise RuntimeError("the opening-name dataset produced no positions")
        return positions

    async def _load(self) -> list[OpeningPosition]:
        if self._pool is not None:
            return self._pool
        async with self._load_lock:
            if self._pool is not None:
                return self._pool
            cached = self._read_cache()
            if cached is not None:
                fetched_at, positions = cached
                if datetime.now(timezone.utc) - fetched_at <= CACHE_MAX_AGE:
                    self._pool = positions
                    return positions
            try:
                source_texts = await asyncio.gather(
                    *(self._fetch_text(url) for url in SOURCE_URLS)
                )
                positions = self._build_pool(source_texts)
                self._write_cache(positions)
                self._pool = positions
                return positions
            except Exception:
                if cached is not None:
                    self._pool = cached[1]
                    return cached[1]
                raise

    @staticmethod
    def _depth_bucket(position: OpeningPosition) -> int:
        if position.ply <= 7:
            return 0
        if position.ply <= 12:
            return 1
        return 2

    @staticmethod
    def _name_options(
        position: OpeningPosition,
        pool: list[OpeningPosition],
    ) -> list[str]:
        decoys: list[str] = []
        used = {position.name}
        tiers = (
            [item.name for item in pool if item.eco == position.eco],
            [
                item.name
                for item in pool
                if item.eco[0] == position.eco[0]
                and ChessOpeningNamesService._depth_bucket(item)
                == ChessOpeningNamesService._depth_bucket(position)
            ],
            [item.name for item in pool],
        )
        for tier in tiers:
            candidates = list(dict.fromkeys(tier))
            while candidates and len(decoys) < 3:
                candidate = candidates.pop(secrets.randbelow(len(candidates)))
                if candidate in used:
                    continue
                used.add(candidate)
                decoys.append(candidate)
            if len(decoys) == 3:
                break

        options = [position.name, *decoys]
        for index in range(len(options) - 1, 0, -1):
            swap_index = secrets.randbelow(index + 1)
            options[index], options[swap_index] = options[swap_index], options[index]
        return options

    async def random_drill(self, *, excluded_ids: set[str]) -> OpeningNameResponse:
        pool = await self._load()
        candidates = [position for position in pool if position.id not in excluded_ids]
        if not candidates:
            candidates = pool
        by_depth: dict[int, list[OpeningPosition]] = defaultdict(list)
        for candidate in candidates:
            by_depth[self._depth_bucket(candidate)].append(candidate)
        depth_bucket = secrets.choice(list(by_depth))
        position = secrets.choice(by_depth[depth_bucket])
        side_to_move: Literal["white", "black"] = (
            "white" if chess.Board(position.fen).turn else "black"
        )
        ask_next_move = bool(position.nextMoves and secrets.randbelow(2))
        return OpeningNameResponse(
            drill=OpeningNameDrill(
                id=position.id,
                eco=position.eco,
                name=position.name,
                fen=position.fen,
                ply=position.ply,
                moveNumber=chess.Board(position.fen).fullmove_number,
                sideToMove=side_to_move,
                movesBefore=position.movesBefore,
                nameOptions=self._name_options(position, pool),
                askNextMove=ask_next_move,
                nextMoves=position.nextMoves,
            ),
            poolSize=len(pool),
            sourceLabel="Lichess chess-openings (CC0)",
            sourceUrl=SOURCE_REPOSITORY,
        )
