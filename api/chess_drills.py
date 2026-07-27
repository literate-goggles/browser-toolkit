"""Repertoire-aware daily opening drills from theory and recent Chess.com games."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import os
import re
import threading
from collections import Counter, defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import chess
import chess.pgn
import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError


FetchJson = Callable[[str], Awaitable[dict[str, Any]]]
GAME_LIMIT = 100
GAME_DRILL_COUNT = 5
THEORY_DRILL_COUNT = 5
DRILL_COUNT = GAME_DRILL_COUNT + THEORY_DRILL_COUNT
MIN_GAME_PLY = 4
MAX_GAME_PLY = 17
MIN_THEORY_PLY = 8
MAX_THEORY_PLY = 29
HISTORY_LIMIT = 800
USERNAME_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"
UCI_PATTERN = r"^[a-h][1-8][a-h][1-8][qrbn]?$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AcceptedMove(StrictModel):
    uci: str = Field(pattern=UCI_PATTERN)
    san: str = Field(min_length=1, max_length=20)
    lineLabels: list[str] = Field(min_length=1, max_length=10)
    continuation: str = Field(min_length=1, max_length=800)


class ChessDrill(StrictModel):
    id: str = Field(min_length=12, max_length=120)
    historyKey: str = Field(min_length=12, max_length=120)
    positionKey: str = Field(min_length=16, max_length=64)
    drillType: Literal["game", "theory"]
    fen: str = Field(min_length=20, max_length=120)
    orientation: Literal["white", "black"]
    sideToMove: Literal["white", "black"]
    moveNumber: int = Field(ge=1, le=30)
    ply: int = Field(ge=0, le=60)
    repertoireFamilyId: str = Field(min_length=2, max_length=80)
    repertoireTitle: str = Field(min_length=2, max_length=180)
    repertoireNote: str = Field(min_length=2, max_length=500)
    eco: str = Field(max_length=10)
    movesBefore: str = Field(max_length=900)
    acceptedMoves: list[AcceptedMove] = Field(min_length=1, max_length=12)
    primaryMoveUci: str = Field(pattern=UCI_PATTERN)
    primaryMoveSan: str = Field(min_length=1, max_length=20)
    theoryContinuation: str = Field(min_length=1, max_length=800)
    actualMoveUci: str = Field(default="", pattern=rf"^$|{UCI_PATTERN}")
    actualMoveSan: str = Field(default="", max_length=20)
    playerColor: Literal["white", "black"]
    playerRating: int = Field(default=0, ge=0, le=5000)
    opponent: str = Field(default="", max_length=100)
    opponentRating: int = Field(default=0, ge=0, le=5000)
    result: str = Field(default="", max_length=40)
    timeClass: str = Field(default="", max_length=30)
    timeControl: str = Field(default="", max_length=40)
    gameDate: str = Field(default="", pattern=r"^$|^\d{4}-\d{2}-\d{2}$")
    gameUrl: str = Field(
        default="",
        pattern=r"^$|^https://www\.chess\.com/game/",
    )
    occurrenceCount: int = Field(default=1, ge=1)


class RepertoireFamilySummary(StrictModel):
    id: str
    title: str
    side: Literal["white", "black"]
    note: str


class ChessDrillDigest(StrictModel):
    date: str
    generatedAt: str
    timezone: str
    username: str = Field(pattern=USERNAME_PATTERN)
    profileUrl: str
    repertoireRevision: str = Field(pattern=r"^[0-9a-f]{16}$")
    gamesAnalyzed: int = Field(ge=1, le=GAME_LIMIT)
    candidatePositions: int = Field(ge=GAME_DRILL_COUNT)
    gameDrillCount: int = Field(default=GAME_DRILL_COUNT)
    theoryDrillCount: int = Field(default=THEORY_DRILL_COUNT)
    repertoire: list[RepertoireFamilySummary] = Field(min_length=1)
    drills: list[ChessDrill] = Field(
        min_length=DRILL_COUNT,
        max_length=DRILL_COUNT,
    )


class ChessDrillResponse(StrictModel):
    digest: ChessDrillDigest
    stale: bool = False
    warning: str = ""


@dataclass
class BookMove:
    uci: str
    san: str
    line_labels: set[str] = field(default_factory=set)
    continuations: list[str] = field(default_factory=list)


@dataclass
class BookNode:
    family_id: str
    family_title: str
    family_note: str
    side: Literal["white", "black"]
    eco: str
    priority: int
    fen: str
    signature: str
    position_key: str
    ply: int
    moves_before: str
    moves: dict[str, BookMove] = field(default_factory=dict)

    @property
    def max_continuation_plies(self) -> int:
        return max(
            (
                len(continuation.split())
                for move in self.moves.values()
                for continuation in move.continuations
            ),
            default=0,
        )


def _position_signature(fen: str) -> str:
    return " ".join(fen.split()[:4])


def _position_key(fen: str) -> str:
    return hashlib.sha256(
        _position_signature(fen).encode("utf-8")
    ).hexdigest()[:24]


def _opening_name(url: str, fallback: str = "Unclassified opening") -> str:
    path = unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])
    name = re.split(r"\.\.\.|-\d+\.", path, maxsplit=1)[0]
    name = name.replace("-", " ").strip()
    return name or fallback


def _format_moves(moves: list[str], *, start_ply: int = 0) -> str:
    tokens: list[str] = []
    for offset, san in enumerate(moves):
        ply = start_ply + offset
        if ply % 2 == 0:
            tokens.append(f"{ply // 2 + 1}. {san}")
        elif offset == 0:
            tokens.append(f"{ply // 2 + 1}... {san}")
        else:
            tokens.append(san)
    return " ".join(tokens)


def _game_date(game: dict[str, Any], headers: chess.pgn.Headers) -> str:
    end_time = game.get("end_time")
    if isinstance(end_time, (int, float)) and end_time > 0:
        return datetime.fromtimestamp(end_time, timezone.utc).date().isoformat()
    date_text = str(headers.get("UTCDate") or headers.get("Date") or "")
    try:
        return datetime.strptime(date_text, "%Y.%m.%d").date().isoformat()
    except ValueError:
        return "1970-01-01"


def _player_result(result: str) -> str:
    labels = {
        "win": "Win",
        "agreed": "Draw",
        "repetition": "Draw",
        "stalemate": "Draw",
        "insufficient": "Draw",
        "50move": "Draw",
        "timevsinsufficient": "Draw",
        "checkmated": "Loss",
        "resigned": "Loss",
        "timeout": "Loss",
        "abandoned": "Loss",
        "lose": "Loss",
    }
    return labels.get(result.casefold(), result.replace("_", " ").title() or "Unknown")


class RepertoireBook:
    """Validated position graph derived from the checked-in repertoire lines."""

    def __init__(self, path: Path, *, expected_profile: str) -> None:
        try:
            raw_repertoire = path.read_text(encoding="utf-8")
            payload = json.loads(raw_repertoire)
        except (OSError, TypeError, ValueError) as exc:
            raise RuntimeError(f"could not read chess repertoire: {exc}") from exc
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise ValueError("chess repertoire must use schema version 1")
        profile = str(payload.get("profile") or "")
        if profile.casefold() != expected_profile.casefold():
            raise ValueError("chess repertoire profile does not match configured player")

        self.revision = hashlib.sha256(
            raw_repertoire.encode("utf-8")
        ).hexdigest()[:16]
        self.nodes: list[BookNode] = []
        self.by_signature: dict[str, list[BookNode]] = defaultdict(list)
        self.family_lines: dict[str, list[list[str]]] = defaultdict(list)
        self.family_summaries: list[RepertoireFamilySummary] = []

        families = payload.get("families")
        if not isinstance(families, list) or not families:
            raise ValueError("chess repertoire has no families")
        for family in families:
            self._add_family(family)

    def _add_family(self, family: Any) -> None:
        if not isinstance(family, dict):
            raise ValueError("invalid chess repertoire family")
        family_id = str(family.get("id") or "")
        title = str(family.get("title") or "")
        note = str(family.get("note") or "")
        side = str(family.get("side") or "")
        eco = str(family.get("eco") or "")
        priority = int(family.get("priority") or 1)
        if not family_id or not title or not note or side not in {"white", "black"}:
            raise ValueError(f"invalid chess repertoire family: {family_id or title}")
        player_color = chess.WHITE if side == "white" else chess.BLACK
        self.family_summaries.append(
            RepertoireFamilySummary(
                id=family_id,
                title=title,
                side=side,
                note=note,
            )
        )
        family_nodes: dict[str, BookNode] = {}
        lines = family.get("lines")
        if not isinstance(lines, list) or not lines:
            raise ValueError(f"repertoire family {family_id} has no lines")

        for line in lines:
            if not isinstance(line, dict):
                raise ValueError(f"invalid line in repertoire family {family_id}")
            line_label = str(line.get("label") or line.get("id") or "")
            raw_moves = line.get("moves")
            if not line_label or not isinstance(raw_moves, list) or not raw_moves:
                raise ValueError(f"invalid line in repertoire family {family_id}")
            uci_moves = [str(move) for move in raw_moves]
            self.family_lines[family_id].append(uci_moves)

            board = chess.Board()
            sans: list[str] = []
            for index, uci in enumerate(uci_moves):
                try:
                    move = chess.Move.from_uci(uci)
                except ValueError as exc:
                    raise ValueError(
                        f"invalid move {uci} in {family_id}/{line_label}"
                    ) from exc
                if move not in board.legal_moves:
                    raise ValueError(
                        f"illegal move {uci} in {family_id}/{line_label}"
                    )
                san = board.san(move)
                if board.turn == player_color:
                    signature = _position_signature(board.fen())
                    node = family_nodes.get(signature)
                    if node is None:
                        node = BookNode(
                            family_id=family_id,
                            family_title=title,
                            family_note=note,
                            side=side,  # type: ignore[arg-type]
                            eco=eco,
                            priority=priority,
                            fen=board.fen(),
                            signature=signature,
                            position_key=_position_key(board.fen()),
                            ply=board.ply(),
                            moves_before=_format_moves(sans),
                        )
                        family_nodes[signature] = node
                    book_move = node.moves.setdefault(
                        uci,
                        BookMove(uci=uci, san=san),
                    )
                    book_move.line_labels.add(line_label)
                    continuation_sans: list[str] = []
                    continuation_board = board.copy()
                    for continuation_uci in uci_moves[index : index + 9]:
                        continuation_move = chess.Move.from_uci(continuation_uci)
                        continuation_sans.append(
                            continuation_board.san(continuation_move)
                        )
                        continuation_board.push(continuation_move)
                    continuation = _format_moves(
                        continuation_sans,
                        start_ply=board.ply(),
                    )
                    if continuation not in book_move.continuations:
                        book_move.continuations.append(continuation)
                board.push(move)
                sans.append(san)

        for node in family_nodes.values():
            self.nodes.append(node)
            self.by_signature[node.signature].append(node)

    def matching_node(
        self,
        *,
        fen: str,
        game_moves: list[str],
        actual_move: str,
    ) -> BookNode | None:
        matches = self.by_signature.get(_position_signature(fen), [])
        if not matches:
            return None

        def common_prefix(line: list[str]) -> int:
            count = 0
            for game_move, book_move in zip(game_moves, line, strict=False):
                if game_move != book_move:
                    break
                count += 1
            return count

        def rank(node: BookNode) -> tuple[int, int, int, str]:
            lines = self.family_lines[node.family_id]
            prefix = max((common_prefix(line) for line in lines), default=0)
            return (
                1 if actual_move in node.moves else 0,
                prefix,
                node.priority,
                node.family_id,
            )

        return max(matches, key=rank)


class ChessDrillService:
    def __init__(
        self,
        *,
        data_file: Path,
        username: str,
        timezone_name: str,
        repertoire_file: Path | None = None,
        fetch_json: FetchJson | None = None,
    ) -> None:
        if not username or not re.fullmatch(USERNAME_PATTERN, username):
            raise ValueError("invalid Chess.com username")
        self.data_file = data_file
        self.username = username
        self.timezone_name = timezone_name or "UTC"
        try:
            self.timezone = ZoneInfo(self.timezone_name)
        except ZoneInfoNotFoundError:
            self.timezone_name = "UTC"
            self.timezone = ZoneInfo("UTC")
        self.repertoire_file = repertoire_file or Path(__file__).with_name(
            "chess_repertoire.json"
        )
        self.book = RepertoireBook(
            self.repertoire_file,
            expected_profile=self.username,
        )
        self.fetch_json = fetch_json or self._fetch_json
        self._file_lock = threading.Lock()
        self._refresh_lock = asyncio.Lock()
        self._background_refresh_task: asyncio.Task[ChessDrillDigest] | None = None

    async def _fetch_json(self, url: str) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "User-Agent": (
                "daily-chebakov-me/1.0 "
                f"(Chess.com username: {self.username})"
            ),
        }
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
            headers=headers,
        ) as client:
            response = await client.get(url)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Chess.com returned an invalid JSON payload")
        return payload

    def _local_today(self) -> date:
        return datetime.now(self.timezone).date()

    @staticmethod
    def _empty_state() -> dict[str, Any]:
        return {"current": None, "history": []}

    def _load_state(self) -> dict[str, Any]:
        with self._file_lock:
            try:
                parsed = json.loads(self.data_file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return self._empty_state()
            except (OSError, TypeError, ValueError) as exc:
                print(f"[chess-drills] failed to read state: {exc}", flush=True)
                return self._empty_state()
        if not isinstance(parsed, dict):
            return self._empty_state()
        parsed["history"] = [
            str(item)
            for item in (parsed.get("history") or [])
            if isinstance(item, str) and item
        ][-HISTORY_LIMIT:]
        return parsed

    def _save_state(self, state: dict[str, Any]) -> None:
        with self._file_lock:
            self.data_file.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.data_file.with_suffix(self.data_file.suffix + ".tmp")
            temporary.write_text(
                json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, self.data_file)

    @staticmethod
    def _current_digest(state: dict[str, Any]) -> ChessDrillDigest | None:
        current = state.get("current")
        if not isinstance(current, dict):
            return None
        try:
            return ChessDrillDigest.model_validate(current)
        except ValidationError:
            print(
                "[chess-drills] cached digest uses an incompatible schema; "
                "regenerating",
                flush=True,
            )
            return None

    async def _recent_games(self) -> list[dict[str, Any]]:
        base = f"https://api.chess.com/pub/player/{self.username.casefold()}"
        archives_payload = await self.fetch_json(f"{base}/games/archives")
        archives = [
            str(url)
            for url in (archives_payload.get("archives") or [])
            if isinstance(url, str) and url.startswith(f"{base}/games/")
        ]
        games: list[dict[str, Any]] = []
        for archive_url in reversed(archives):
            payload = await self.fetch_json(archive_url)
            monthly_games = payload.get("games") or []
            if isinstance(monthly_games, list):
                games.extend(
                    game
                    for game in monthly_games
                    if isinstance(game, dict)
                    and game.get("rules") == "chess"
                    and isinstance(game.get("pgn"), str)
                )
            if len(games) >= GAME_LIMIT:
                break
        deduplicated: dict[str, dict[str, Any]] = {}
        for game in sorted(
            games,
            key=lambda item: int(item.get("end_time") or 0),
            reverse=True,
        ):
            url = str(game.get("url") or "")
            if url and url not in deduplicated:
                deduplicated[url] = game
        return list(deduplicated.values())[:GAME_LIMIT]

    @staticmethod
    def _accepted_moves(node: BookNode) -> list[dict[str, Any]]:
        accepted: list[dict[str, Any]] = []
        for move in node.moves.values():
            accepted.append(
                {
                    "uci": move.uci,
                    "san": move.san,
                    "lineLabels": sorted(move.line_labels),
                    "continuation": max(
                        move.continuations,
                        key=lambda item: len(item.split()),
                    ),
                }
            )
        return accepted

    def _base_drill(
        self,
        *,
        node: BookNode,
        drill_type: Literal["game", "theory"],
    ) -> dict[str, Any]:
        accepted = self._accepted_moves(node)
        primary = accepted[0]
        history_key = f"{drill_type}:{node.family_id}:{node.position_key}"
        digest = hashlib.sha256(history_key.encode("utf-8")).hexdigest()[:20]
        return {
            "id": f"{drill_type}-opening-{digest}",
            "historyKey": history_key,
            "positionKey": node.position_key,
            "drillType": drill_type,
            "fen": node.fen,
            "orientation": node.side,
            "sideToMove": "white" if chess.Board(node.fen).turn else "black",
            "moveNumber": chess.Board(node.fen).fullmove_number,
            "ply": node.ply,
            "repertoireFamilyId": node.family_id,
            "repertoireTitle": node.family_title,
            "repertoireNote": node.family_note,
            "eco": node.eco,
            "movesBefore": node.moves_before,
            "acceptedMoves": accepted,
            "primaryMoveUci": primary["uci"],
            "primaryMoveSan": primary["san"],
            "theoryContinuation": primary["continuation"],
            "playerColor": node.side,
            "occurrenceCount": 1,
        }

    def _game_candidates(self, game: dict[str, Any]) -> list[dict[str, Any]]:
        parsed = chess.pgn.read_game(io.StringIO(str(game.get("pgn") or "")))
        if parsed is None:
            return []
        white = game.get("white") if isinstance(game.get("white"), dict) else {}
        black = game.get("black") if isinstance(game.get("black"), dict) else {}
        username = self.username.casefold()
        if str(white.get("username") or "").casefold() == username:
            player_color = chess.WHITE
            player = white
            opponent = black
        elif str(black.get("username") or "").casefold() == username:
            player_color = chess.BLACK
            player = black
            opponent = white
        else:
            return []

        moves = list(parsed.mainline_moves())
        uci_moves = [move.uci() for move in moves]
        board = parsed.board()
        sans: list[str] = []
        candidates: list[dict[str, Any]] = []
        for move in moves:
            ply = board.ply()
            san = board.san(move)
            if (
                board.turn == player_color
                and MIN_GAME_PLY <= ply <= MAX_GAME_PLY
            ):
                node = self.book.matching_node(
                    fen=board.fen(),
                    game_moves=uci_moves,
                    actual_move=move.uci(),
                )
                if node is not None and node.side == (
                    "white" if player_color == chess.WHITE else "black"
                ):
                    candidate = self._base_drill(node=node, drill_type="game")
                    game_url = str(
                        game.get("url") or parsed.headers.get("Link") or ""
                    )
                    candidate_id = hashlib.sha256(
                        f"{game_url}:{ply}:{node.family_id}".encode("utf-8")
                    ).hexdigest()[:20]
                    candidate.update(
                        {
                            "id": f"game-opening-{candidate_id}",
                            "movesBefore": _format_moves(sans),
                            "actualMoveUci": move.uci(),
                            "actualMoveSan": san,
                            "playerRating": int(player.get("rating") or 0),
                            "opponent": str(
                                opponent.get("username") or "Unknown"
                            ),
                            "opponentRating": int(
                                opponent.get("rating") or 0
                            ),
                            "result": _player_result(
                                str(player.get("result") or "")
                            ),
                            "timeClass": str(
                                game.get("time_class") or "unknown"
                            ),
                            "timeControl": str(
                                game.get("time_control") or "unknown"
                            ),
                            "gameDate": _game_date(game, parsed.headers),
                            "gameUrl": game_url,
                        }
                    )
                    candidates.append(candidate)
            board.push(move)
            sans.append(san)
        return candidates

    @staticmethod
    def _history_rank(history: list[str]) -> dict[str, int]:
        return {key: index for index, key in enumerate(history)}

    def _select_game_drills(
        self,
        *,
        candidates: list[dict[str, Any]],
        target: date,
        history: list[str],
    ) -> list[ChessDrill]:
        occurrences = Counter(
            str(candidate["historyKey"]) for candidate in candidates
        )
        unique: dict[str, dict[str, Any]] = {}
        for candidate in candidates:
            key = str(candidate["historyKey"])
            if key not in unique:
                candidate["occurrenceCount"] = occurrences[key]
                unique[key] = candidate
        history_positions = self._history_rank(history)

        def rank(candidate: dict[str, Any]) -> tuple[int, int, int, str]:
            key = str(candidate["historyKey"])
            digest = hashlib.sha256(
                f"{target.isoformat()}:game:{candidate['id']}".encode("utf-8")
            ).hexdigest()
            return (
                0 if key not in history_positions else 1,
                -min(int(candidate["occurrenceCount"]), 12),
                abs(int(candidate["ply"]) - 11),
                digest,
            )

        pool = sorted(unique.values(), key=rank)
        selected: list[dict[str, Any]] = []
        selected_keys: set[str] = set()
        selected_families: Counter[str] = Counter()
        selected_games: Counter[str] = Counter()

        def add(*, unique_family: bool, unique_game: bool) -> None:
            for candidate in pool:
                key = str(candidate["historyKey"])
                family = str(candidate["repertoireFamilyId"])
                game_url = str(candidate["gameUrl"])
                if key in selected_keys:
                    continue
                if unique_family and selected_families[family]:
                    continue
                if unique_game and selected_games[game_url]:
                    continue
                selected.append(candidate)
                selected_keys.add(key)
                selected_families[family] += 1
                selected_games[game_url] += 1
                if len(selected) == GAME_DRILL_COUNT:
                    return

        add(unique_family=True, unique_game=True)
        if len(selected) < GAME_DRILL_COUNT:
            add(unique_family=False, unique_game=True)
        if len(selected) < GAME_DRILL_COUNT:
            add(unique_family=False, unique_game=False)
        if len(selected) < GAME_DRILL_COUNT:
            raise RuntimeError(
                "Only "
                f"{len(selected)} repertoire-matched game positions were available"
            )
        return [ChessDrill.model_validate(item) for item in selected]

    def _select_theory_drills(
        self,
        *,
        target: date,
        history: list[str],
    ) -> list[ChessDrill]:
        history_positions = self._history_rank(history)
        candidates: list[dict[str, Any]] = []
        for node in self.book.nodes:
            if not MIN_THEORY_PLY <= node.ply <= MAX_THEORY_PLY:
                continue
            if node.max_continuation_plies < 3:
                continue
            candidates.append(self._base_drill(node=node, drill_type="theory"))

        def rank(candidate: dict[str, Any]) -> tuple[int, int, str]:
            key = str(candidate["historyKey"])
            digest = hashlib.sha256(
                f"{target.isoformat()}:theory:{key}".encode("utf-8")
            ).hexdigest()
            return (
                0 if key not in history_positions else 1,
                history_positions.get(key, -1),
                digest,
            )

        by_side: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for candidate in sorted(candidates, key=rank):
            by_side[str(candidate["playerColor"])].append(candidate)
        white_target = 3 if target.toordinal() % 2 else 2
        side_targets = {"white": white_target, "black": 5 - white_target}
        selected: list[dict[str, Any]] = []
        selected_keys: set[str] = set()
        selected_families: set[str] = set()

        def add_from_side(side: str, *, unique_family: bool) -> None:
            target_count = side_targets[side]
            current_count = sum(
                1 for item in selected if item["playerColor"] == side
            )
            for candidate in by_side[side]:
                key = str(candidate["historyKey"])
                family = str(candidate["repertoireFamilyId"])
                if key in selected_keys:
                    continue
                if unique_family and family in selected_families:
                    continue
                selected.append(candidate)
                selected_keys.add(key)
                selected_families.add(family)
                current_count += 1
                if current_count == target_count:
                    return

        for side in ("white", "black"):
            add_from_side(side, unique_family=True)
            if sum(1 for item in selected if item["playerColor"] == side) < side_targets[side]:
                add_from_side(side, unique_family=False)
        if len(selected) < THEORY_DRILL_COUNT:
            for candidate in sorted(candidates, key=rank):
                if candidate["historyKey"] not in selected_keys:
                    selected.append(candidate)
                    selected_keys.add(str(candidate["historyKey"]))
                if len(selected) == THEORY_DRILL_COUNT:
                    break
        if len(selected) < THEORY_DRILL_COUNT:
            raise RuntimeError("The repertoire has too few deep theory positions")
        return [ChessDrill.model_validate(item) for item in selected]

    async def _generate(self, state: dict[str, Any], target: date) -> ChessDrillDigest:
        games = await self._recent_games()
        if not games:
            raise RuntimeError("Chess.com returned no standard games")
        candidates: list[dict[str, Any]] = []
        for game in games:
            try:
                candidates.extend(self._game_candidates(game))
            except (AssertionError, IndexError, TypeError, ValueError) as exc:
                print(
                    f"[chess-drills] skipped malformed game {game.get('url')}: {exc}",
                    flush=True,
                )
        game_drills = self._select_game_drills(
            candidates=candidates,
            target=target,
            history=state["history"],
        )
        theory_drills = self._select_theory_drills(
            target=target,
            history=state["history"],
        )
        drills = game_drills + theory_drills
        digest = ChessDrillDigest(
            date=target.isoformat(),
            generatedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            timezone=self.timezone_name,
            username=self.username,
            profileUrl=f"https://www.chess.com/member/{self.username}",
            repertoireRevision=self.book.revision,
            gamesAnalyzed=len(games),
            candidatePositions=len(
                {
                    str(item["historyKey"])
                    for item in candidates
                }
            ),
            repertoire=self.book.family_summaries,
            drills=drills,
        )
        new_keys = [drill.historyKey for drill in drills]
        selected = set(new_keys)
        state["history"] = (
            [key for key in state["history"] if key not in selected] + new_keys
        )[-HISTORY_LIMIT:]
        state["current"] = digest.model_dump(mode="json")
        self._save_state(state)
        return digest

    async def _refresh_latest(
        self,
        target: date,
        *,
        force_refresh: bool = False,
    ) -> ChessDrillDigest:
        async with self._refresh_lock:
            state = self._load_state()
            current = self._current_digest(state)
            if (
                current
                and current.date == target.isoformat()
                and current.repertoireRevision == self.book.revision
                and not force_refresh
            ):
                return current
            return await self._generate(state, target)

    def _start_background_refresh(self, target: date) -> None:
        if (
            self._background_refresh_task is not None
            and not self._background_refresh_task.done()
        ):
            return
        task = asyncio.create_task(self._refresh_latest(target))
        self._background_refresh_task = task

        def report_failure(completed: asyncio.Task[ChessDrillDigest]) -> None:
            try:
                completed.result()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                print(
                    f"[chess-drills] background refresh failed: {exc}",
                    flush=True,
                )

        task.add_done_callback(report_failure)

    async def get(
        self,
        *,
        force_refresh: bool = False,
        wait_for_refresh: bool = False,
    ) -> ChessDrillResponse:
        target = self._local_today()
        state = self._load_state()
        current = self._current_digest(state)
        if current and current.repertoireRevision != self.book.revision:
            current = None
        if (
            current
            and current.date == target.isoformat()
            and not force_refresh
        ):
            return ChessDrillResponse(digest=current)
        if current and not force_refresh and not wait_for_refresh:
            self._start_background_refresh(target)
            return ChessDrillResponse(
                digest=current,
                stale=True,
                warning=(
                    "Today's opening drills are being prepared; showing the "
                    "latest saved set."
                ),
            )
        try:
            digest = await self._refresh_latest(
                target,
                force_refresh=force_refresh,
            )
            return ChessDrillResponse(digest=digest)
        except Exception as exc:
            if current:
                print(
                    f"[chess-drills] refresh failed; serving stale drills: {exc}",
                    flush=True,
                )
                return ChessDrillResponse(
                    digest=current,
                    stale=True,
                    warning=(
                        "The Chess.com refresh failed; showing the latest saved "
                        "opening drills."
                    ),
                )
            raise

    async def scheduler(self) -> None:
        await asyncio.sleep(11)
        while True:
            try:
                await self.get(wait_for_refresh=True)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"[chess-drills] scheduled refresh failed: {exc}", flush=True)
                await asyncio.sleep(15 * 60)
                continue
            now = datetime.now(self.timezone)
            next_midnight = datetime.combine(
                now.date() + timedelta(days=1),
                datetime_time.min,
                tzinfo=self.timezone,
            )
            await asyncio.sleep(max(60.0, (next_midnight - now).total_seconds() + 7))
