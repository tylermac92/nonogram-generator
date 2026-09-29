"""Checks that every corpus entry's recorded answers are true, and that the
corpus covers what the solver tests need."""

import numpy as np
import pytest

from corpus import PUZZLES, RATINGS, ids, rating_from, select, solution_of
from grid_reference import count_solutions
from nonogram.clues import derive_clues
from nonogram.solver.line import UNKNOWN
from nonogram.solver.probe import solve

SOURCES = {"hand", "hand, 1 cell edited", "search"}


@pytest.mark.parametrize("entry", PUZZLES, ids=ids(PUZZLES))
def test_entry_is_well_formed(entry):
    assert set(entry) == {"name", "source", "rating", "solutions", "notes", "solution"}
    assert entry["source"] in SOURCES
    assert entry["rating"] in (*RATINGS, None)
    assert entry["solutions"] in (1, "2+")
    rows = entry["solution"]
    assert rows and len({len(row) for row in rows}) == 1
    assert all(set(row) <= {"0", "1"} for row in rows)


def test_names_are_unique():
    names = ids(PUZZLES)
    assert len(names) == len(set(names))


def _slow_if_stalls_unique(entry):
    # Proving logic stalls on a unique puzzle means running depth 2 to its
    # end: about 30 s for long-stairs-kinked.
    if entry["rating"] is None and entry["solutions"] == 1:
        return pytest.param(entry, marks=pytest.mark.slow, id=entry["name"])
    return pytest.param(entry, id=entry["name"])


@pytest.mark.parametrize("entry", [_slow_if_stalls_unique(e) for e in PUZZLES])
def test_recorded_rating_and_solution_count_are_correct(entry):
    solution = solution_of(entry)
    rows, cols = derive_clues(solution)
    result = solve(np.full(solution.shape, UNKNOWN, dtype=np.int8), rows, cols, depth2_budget=60)
    assert not result.timed_out
    assert rating_from(result) == entry["rating"]

    # Independent of the solver: brute force over row patterns.
    assert solution.shape[1] <= 12, "too wide for the brute-force count"
    count = count_solutions(rows, cols, limit=2)
    assert count == (1 if entry["solutions"] == 1 else 2)


@pytest.mark.parametrize("rating", RATINGS)
def test_every_tier_has_a_hand_built_puzzle(rating):
    assert any(e["source"].startswith("hand") for e in select(rating))


def test_has_hand_built_multi_solution_puzzle():
    assert any(e["source"] == "hand" for e in select(None, "2+"))


def test_has_unique_puzzle_that_logic_cannot_finish():
    assert select(None, 1)
