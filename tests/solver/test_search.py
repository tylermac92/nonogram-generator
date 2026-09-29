import json
import time
from pathlib import Path

import numpy as np
import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from grid_reference import count_solutions
from nonogram.clues import derive_clues
from nonogram.solver.line import UNKNOWN
from nonogram.solver.probe import solve
from nonogram.solver.propagate import Status, propagate
from nonogram.solver.search import DEFAULT_SEARCH_BUDGET, Outcome, find_second_solution

CORPUS = json.loads((Path(__file__).parents[1] / "corpus" / "puzzles.json").read_text())["puzzles"]
AMBIGUOUS = [e for e in CORPUS if e["solutions"] != 1]


def grid_of(rows: list[str]) -> np.ndarray:
    return np.array([[c == "1" for c in row] for row in rows], dtype=bool)


def blank(shape) -> np.ndarray:
    return np.full(shape, UNKNOWN, dtype=np.int8)


def check_found(result, stalled, target, rows, cols) -> None:
    assert result.outcome is Outcome.FOUND
    second = result.second_solution
    assert second.dtype == bool and second.shape == target.shape
    assert derive_clues(second) == (tuple(rows), tuple(cols)), "not a solution"
    assert not np.array_equal(second, target), "not a different solution"
    assert np.array_equal(result.candidates, second != target)
    # Logic proved the stall's known cells, so every solution agrees there.
    assert not (result.candidates & (stalled != UNKNOWN)).any()


def test_corpus_has_ambiguous_puzzles():
    assert len(AMBIGUOUS) >= 5


@pytest.mark.parametrize("entry", AMBIGUOUS, ids=[e["name"] for e in AMBIGUOUS])
def test_finds_second_solution_for_ambiguous_corpus_puzzles(entry):
    target = grid_of(entry["solution"])
    rows, cols = derive_clues(target)
    stalled = solve(blank(target.shape), rows, cols).grid
    stalled_before, target_before = stalled.copy(), target.copy()
    result = find_second_solution(stalled, target, rows, cols)
    check_found(result, stalled, target, rows, cols)
    assert np.array_equal(stalled, stalled_before) and np.array_equal(target, target_before)


@st.composite
def stalling_grids(draw):
    """Random grids up to 8x8 whose clues propagation alone can't finish."""
    seed = draw(st.integers(0, 2**32 - 1))
    rng = np.random.default_rng(seed)
    height, width = draw(st.integers(4, 8)), draw(st.integers(4, 8))
    target = rng.random((height, width)) < draw(st.floats(0.35, 0.7))
    rows, cols = derive_clues(target)
    stalled = propagate(blank(target.shape), rows, cols)
    assume(stalled.status is Status.STALLED)
    return target, rows, cols, stalled


@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.filter_too_much])
@given(stalling_grids())
def test_outcome_matches_brute_force_count(case):
    target, rows, cols, stalled = case
    result = find_second_solution(stalled.grid, target, rows, cols, budget=10)
    if count_solutions(rows, cols) > 1:
        check_found(result, stalled.grid, target, rows, cols)
    else:
        assert result.outcome is Outcome.UNIQUE
        assert np.array_equal(result.candidates, stalled.grid == UNKNOWN)


def test_proves_uniqueness_when_logic_stalls_early():
    # A puzzle probing solves, searched from its propagation-only stall.
    entry = next(e for e in CORPUS if e["requires"] == "depth1")
    target = grid_of(entry["solution"])
    rows, cols = derive_clues(target)
    stalled = propagate(blank(target.shape), rows, cols).grid
    result = find_second_solution(stalled, target, rows, cols)
    assert result.outcome is Outcome.UNIQUE
    assert result.second_solution is None
    assert np.array_equal(result.candidates, stalled == UNKNOWN)


def large_stall():
    # Random 60x60 noise: propagation deduces almost nothing, and the search
    # can't find a second solution within 30 s.
    target = np.random.default_rng(3).random((60, 60)) < 0.5
    rows, cols = derive_clues(target)
    return target, rows, cols, propagate(blank(target.shape), rows, cols).grid


def test_times_out_when_the_clock_passes_the_budget():
    target, rows, cols, stalled = large_stall()
    readings = iter([0.0])  # the deadline is set from the first reading...

    def clock():
        return next(readings, 1e9)  # ...and every later reading is past it

    result = find_second_solution(stalled, target, rows, cols, budget=5, clock=clock)
    assert result.outcome is Outcome.TIMED_OUT
    assert result.second_solution is None
    assert np.array_equal(result.candidates, stalled == UNKNOWN)


def test_stops_within_the_default_budget_in_real_time():
    assert DEFAULT_SEARCH_BUDGET == 2.0
    target, rows, cols, stalled = large_stall()
    started = time.monotonic()
    result = find_second_solution(stalled, target, rows, cols)
    elapsed = time.monotonic() - started
    assert result.outcome is Outcome.TIMED_OUT
    assert np.array_equal(result.candidates, stalled == UNKNOWN)
    # One propagation may run past the deadline before the next check.
    assert elapsed < DEFAULT_SEARCH_BUDGET + 0.5


def test_rejects_target_that_does_not_solve_the_clues():
    target = grid_of(["10", "01"])
    rows, cols = derive_clues(target)
    with pytest.raises(ValueError, match="clues"):
        find_second_solution(blank((2, 2)), ~target, rows, [(1,), ()])


def test_rejects_stall_that_disagrees_with_target():
    target = grid_of(["10", "01"])
    rows, cols = derive_clues(target)
    stalled = blank((2, 2))
    stalled[0, 0] = 0
    with pytest.raises(ValueError, match="disagrees"):
        find_second_solution(stalled, target, rows, cols)
