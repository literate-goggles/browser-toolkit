from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

import chess


API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

from chess_drills import ChessDrillService, _opening_name  # noqa: E402


WHITE_GAME_PGN = """[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.07.24"]
[White "unlimited_bezdarnost"]
[Black "opponent_one"]
[Result "1-0"]
[ECO "C53"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Classical-Variation-Center-Attack"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4
6. e5 d5 7. Bb5 Ne4 8. cxd4 Bb4+ 9. Bd2 Bxd2+ 10. Nbxd2 1-0
"""

BLACK_GAME_PGN = """[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.07.23"]
[White "opponent_two"]
[Black "unlimited_bezdarnost"]
[Result "0-1"]
[ECO "B34"]
[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-Accelerated-Dragon"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 g6 5. Nc3 Bg7
6. Be3 d6 7. Qd2 Nf6 8. f3 O-O 9. O-O-O 0-1
"""


def game(
    *,
    url: str,
    pgn: str,
    end_time: int,
    white: str,
    black: str,
    player_result: str,
) -> dict:
    return {
        "url": url,
        "pgn": pgn,
        "end_time": end_time,
        "time_class": "blitz",
        "time_control": "180+2",
        "rules": "chess",
        "eco": "https://www.chess.com/openings/Test-Opening",
        "white": {
            "username": white,
            "rating": 1500,
            "result": player_result if white == "unlimited_bezdarnost" else "loss",
        },
        "black": {
            "username": black,
            "rating": 1510,
            "result": player_result if black == "unlimited_bezdarnost" else "loss",
        },
    }


class ChessDrillServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.data_file = (
            Path(self.temporary_directory.name) / "chess_drills.json"
        )
        self.archive_url = (
            "https://api.chess.com/pub/player/"
            "unlimited_bezdarnost/games/2026/07"
        )
        self.games = [
            game(
                url="https://www.chess.com/game/live/1001",
                pgn=WHITE_GAME_PGN,
                end_time=1784907902,
                white="unlimited_bezdarnost",
                black="opponent_one",
                player_result="win",
            ),
            game(
                url="https://www.chess.com/game/live/1002",
                pgn=BLACK_GAME_PGN,
                end_time=1784821502,
                white="opponent_two",
                black="unlimited_bezdarnost",
                player_result="win",
            ),
        ]
        self.requests: list[str] = []

        async def fetch_json(url: str) -> dict:
            self.requests.append(url)
            if url.endswith("/games/archives"):
                return {"archives": [self.archive_url]}
            if url == self.archive_url:
                return {"games": self.games}
            raise AssertionError(f"unexpected URL: {url}")

        self.service = ChessDrillService(
            data_file=self.data_file,
            username="unlimited_bezdarnost",
            timezone_name="UTC",
            fetch_json=fetch_json,
        )
        self.service._local_today = lambda: date(2026, 7, 25)

    async def asyncTearDown(self) -> None:
        self.temporary_directory.cleanup()

    async def test_builds_and_caches_five_game_and_five_theory_drills(self) -> None:
        first = await self.service.get()
        second = await self.service.get()

        self.assertEqual(first.digest.date, "2026-07-25")
        self.assertEqual(first.digest.gamesAnalyzed, 2)
        self.assertEqual(len(first.digest.drills), 10)
        self.assertEqual(first.digest.gameDrillCount, 5)
        self.assertEqual(first.digest.theoryDrillCount, 5)
        self.assertEqual(
            [drill.drillType for drill in first.digest.drills].count("game"),
            5,
        )
        self.assertEqual(
            [drill.drillType for drill in first.digest.drills].count("theory"),
            5,
        )
        self.assertTrue(
            all(
                drill.ply <= 17
                for drill in first.digest.drills
                if drill.drillType == "game"
            )
        )
        self.assertTrue(
            all(
                drill.ply >= 8
                for drill in first.digest.drills
                if drill.drillType == "theory"
            )
        )
        self.assertEqual(
            {drill.orientation for drill in first.digest.drills},
            {"white", "black"},
        )
        self.assertTrue(
            all(drill.acceptedMoves for drill in first.digest.drills)
        )
        self.assertTrue(
            all(
                drill.actualMoveUci and drill.actualMoveSan
                for drill in first.digest.drills
                if drill.drillType == "game"
            )
        )
        self.assertTrue(
            all(
                not drill.actualMoveUci and not drill.gameUrl
                for drill in first.digest.drills
                if drill.drillType == "theory"
            )
        )
        self.assertEqual(second.digest.model_dump(), first.digest.model_dump())
        self.assertEqual(len(self.requests), 2)

        persisted = json.loads(self.data_file.read_text(encoding="utf-8"))
        self.assertEqual(len(persisted["history"]), 10)
        self.assertEqual(
            len(set(persisted["history"])),
            len(persisted["history"]),
        )

    async def test_force_refresh_prefers_positions_not_seen_today(self) -> None:
        first = await self.service.get()
        refreshed = await self.service.get(force_refresh=True)

        first_keys = {drill.positionKey for drill in first.digest.drills}
        refreshed_keys = {drill.positionKey for drill in refreshed.digest.drills}
        self.assertNotEqual(first_keys, refreshed_keys)
        self.assertGreater(len(refreshed_keys - first_keys), 0)

    async def test_repertoire_revision_invalidates_daily_cache(self) -> None:
        first = await self.service.get()
        persisted = json.loads(self.data_file.read_text(encoding="utf-8"))
        persisted["current"]["repertoireRevision"] = "0" * 16
        self.data_file.write_text(json.dumps(persisted), encoding="utf-8")

        refreshed = await self.service.get()

        self.assertEqual(
            refreshed.digest.repertoireRevision,
            self.service.book.revision,
        )
        self.assertEqual(len(self.requests), 4)
        self.assertNotEqual(
            refreshed.digest.repertoireRevision,
            "0" * 16,
        )
        self.assertEqual(first.digest.date, refreshed.digest.date)

    async def test_skips_nonstandard_and_unknown_player_games(self) -> None:
        self.games.insert(
            0,
            {
                **self.games[0],
                "url": "https://www.chess.com/game/live/variant",
                "rules": "chess960",
            },
        )
        self.games.insert(
            0,
            {
                **self.games[0],
                "url": "https://www.chess.com/game/live/unknown",
                "rules": "chess",
                "white": {"username": "someone", "rating": 1200, "result": "win"},
                "black": {"username": "else", "rating": 1200, "result": "loss"},
            },
        )

        response = await self.service.get()

        self.assertEqual(response.digest.gamesAnalyzed, 3)
        self.assertTrue(
            all(
                drill.gameUrl
                in {
                    "https://www.chess.com/game/live/1001",
                    "https://www.chess.com/game/live/1002",
                }
                for drill in response.digest.drills
                if drill.drillType == "game"
            )
        )

    def test_opening_name_discards_move_suffixes(self) -> None:
        self.assertEqual(
            _opening_name(
                "https://www.chess.com/openings/"
                "Caro-Kann-Defense-Exchange-Variation-3.exd5"
            ),
            "Caro Kann Defense Exchange Variation",
        )
        self.assertEqual(
            _opening_name(
                "https://www.chess.com/openings/"
                "Reti-Opening...2.Bg2"
            ),
            "Reti Opening",
        )

    def test_personal_french_and_caro_kann_choices_are_authoritative(self) -> None:
        def accepted_moves(family_id: str, prefix: list[str]) -> set[str]:
            board = chess.Board()
            for uci in prefix:
                board.push_uci(uci)
            signature = " ".join(board.fen().split()[:4])
            nodes = [
                node
                for node in self.service.book.by_signature[signature]
                if node.family_id == family_id
            ]
            self.assertEqual(len(nodes), 1)
            return set(nodes[0].moves)

        french = accepted_moves(
            "french-advance-c3",
            [
                "e2e4",
                "e7e6",
                "d2d4",
                "d7d5",
                "e4e5",
                "c7c5",
                "c2c3",
                "b8c6",
                "g1f3",
                "d8b6",
            ],
        )
        caro_kann = accepted_moves(
            "caro-kann-advance",
            [
                "e2e4",
                "c7c6",
                "d2d4",
                "d7d5",
                "e4e5",
                "c8f5",
                "g1f3",
                "e7e6",
                "f1e2",
                "c6c5",
            ],
        )

        self.assertEqual(french, {"f1d3"})
        self.assertEqual(caro_kann, {"c2c4"})


if __name__ == "__main__":
    unittest.main()
