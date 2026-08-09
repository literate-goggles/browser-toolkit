from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

import chess

from api.chess_opening_names import ChessOpeningNamesService


OPENING_TSV = """eco\tname\tpgn
C20\tKing's Pawn Game\t1. e4 e5
C50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4
C53\tItalian Game: Classical Variation\t1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3
"""


class ChessOpeningNamesServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.cache_file = (
            Path(self.temporary_directory.name) / "chess_opening_names.json"
        )
        self.fetcher = AsyncMock(return_value=OPENING_TSV)
        self.service = ChessOpeningNamesService(
            cache_file=self.cache_file,
            fetch_text=self.fetcher,
        )

    async def asyncTearDown(self) -> None:
        self.temporary_directory.cleanup()

    async def test_builds_random_named_positions_at_real_dataset_depths(self) -> None:
        response = await self.service.random_drill(excluded_ids=set())

        self.assertEqual(response.poolSize, 2)
        self.assertIn(response.drill.name, {"Italian Game", "Italian Game: Classical Variation"})
        self.assertIn(response.drill.ply, {5, 7})
        self.assertTrue(chess.Board(response.drill.fen).is_valid())
        self.assertIn(response.drill.name, response.drill.nameOptions)
        self.assertEqual(
            len(response.drill.nameOptions),
            len(set(response.drill.nameOptions)),
        )
        self.assertEqual(self.fetcher.await_count, 5)
        self.assertTrue(self.cache_file.exists())

    async def test_named_position_can_offer_a_real_child_continuation(self) -> None:
        pool = await self.service._load()
        italian = next(position for position in pool if position.name == "Italian Game")

        self.assertEqual([move.san for move in italian.nextMoves], ["Bc5"])
        self.assertEqual(
            italian.nextMoves[0].openingNames,
            ["Italian Game: Classical Variation"],
        )

    async def test_fresh_cache_avoids_another_source_download(self) -> None:
        await self.service.random_drill(excluded_ids=set())
        cached_fetcher = AsyncMock(side_effect=AssertionError("network not expected"))
        cached_service = ChessOpeningNamesService(
            cache_file=self.cache_file,
            fetch_text=cached_fetcher,
        )

        response = await cached_service.random_drill(excluded_ids=set())

        self.assertEqual(response.poolSize, 2)
        cached_fetcher.assert_not_awaited()
