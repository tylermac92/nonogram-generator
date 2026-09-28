import json
import time
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from nonogram.clues import derive_clues
from nonogram.solver.line import UNKNOWN, CachedLineSolver, solve_full, solve_simple
from nonogram.solver.probe import _Context, _probe_cell, solve
from nonogram.solver.propagate import Status, propagate

CORPUS = json.loads((Path(__file__).parents[1] / "corpus" / "puzzles.json").read_text())["puzzles"]


def grid_of(rows: list[str]) -> np.ndarray:
    return np.array([[c == "1" for c in row] for row in rows], dtype=bool)


def blank(shape) -> np.ndarray:
    return np.full(shape, UNKNOWN, dtype=np.int8)


def assert_sound(result, solution: np.ndarray, start: np.ndarray | None = None) -> None:
    known = result.grid != UNKNOWN
    assert np.array_equal(result.grid[known], solution[known].astype(np.int8)), "unsound deduction"
    if start is not None:
        assert np.array_equal(result.grid[start != UNKNOWN], start[start != UNKNOWN])
    assert result.status is not Status.CONTRADICTION
    assert (result.status is Status.SOLVED) == known.all()


# --- Corpus ---------------------------------------------------------------


@pytest.mark.parametrize("entry", CORPUS, ids=[e["name"] for e in CORPUS])
def test_corpus(entry):
    solution = grid_of(entry["solution"])
    rows, cols = derive_clues(solution)
    start = blank(solution.shape)
    line_only = propagate(start, rows, cols).status
    by_depth = {d: solve(start, rows, cols, max_depth=d) for d in (0, 1, 2)}
    for result in by_depth.values():
        assert_sound(result, solution)

    solved_at = min((d for d, r in by_depth.items() if r.status is Status.SOLVED), default=None)
    expected = {"line": 0, "depth1": 1, "depth2": 2, "none": None}[entry["requires"]]
    assert solved_at == expected
    assert (line_only is Status.SOLVED) == (expected == 0)
    if expected is not None:
        assert np.array_equal(by_depth[2].grid, solution.astype(np.int8))
    assert (entry["solutions"] == 1) == (expected is not None)


def test_corpus_has_puzzles_line_solving_cannot_finish():
    needs_probing = [e for e in CORPUS if e["requires"] in ("depth1", "depth2")]
    assert len(needs_probing) >= 5


# --- Soundness ------------------------------------------------------------


@pytest.mark.slow
def test_soundness_on_1000_random_grids():
    # Same grids as the propagation soundness test, now through probing up
    # to depth 2. A small depth-2 budget keeps the run to about two minutes.
    rng = np.random.default_rng(20260928)
    statuses = {Status.SOLVED: 0, Status.STALLED: 0}
    probed = 0
    for _ in range(1000):
        height, width = rng.integers(1, 31, size=2)
        density = rng.uniform(0.2, 0.8)
        solution = rng.random((height, width)) < density
        rows, cols = derive_clues(solution)
        result = solve(blank(solution.shape), rows, cols, max_depth=2, depth2_budget=0.05)
        assert_sound(result, solution)
        statuses[result.status] += 1
        probed += result.probe1_cells > 0
    assert statuses[Status.SOLVED] > 50 and statuses[Status.STALLED] > 50
    assert probed > 50


@settings(max_examples=150, deadline=None)
@given(arrays(bool, st.tuples(st.integers(1, 10), st.integers(1, 10))), st.data())
def test_soundness_from_partially_known_grids(solution, data):
    # Reveal about a quarter of the cells, so probing still has work to do.
    mask = data.draw(arrays(bool, solution.shape)) & data.draw(arrays(bool, solution.shape))
    start = np.where(mask, solution.astype(np.int8), UNKNOWN).astype(np.int8)
    rows, cols = derive_clues(solution)
    assert_sound(solve(start, rows, cols, max_depth=2, depth2_budget=1.0), solution, start)


# --- Probing rules --------------------------------------------------------


def make_context(rows, cols) -> _Context:
    return _Context(
        clues=(rows, cols), simple=solve_simple, full=solve_full, clock=time.monotonic,
        depth2_budget=1.0,
    )


def test_same_in_both_branches_rule():
    # Found by search: at the propagation fixpoint, both assumptions for
    # cell (0, 2) survive, yet they agree on other unknown cells.
    solution = grid_of(["1001", "0110", "0010", "0101", "0100", "1000"])
    rows, cols = derive_clues(solution)
    stalled = propagate(blank(solution.shape), rows, cols)
    assert stalled.status is Status.STALLED and stalled.grid[0, 2] == UNKNOWN

    deduced = _probe_cell(make_context(rows, cols), stalled.grid, 0, 2, depth=1)
    assert deduced is not None
    assert deduced[0, 2] == UNKNOWN  # neither value was refuted
    new = (deduced != stalled.grid)
    assert new.any()
    assert np.array_equal(deduced[new], solution[new].astype(np.int8))


def test_refuted_assumption_sets_the_cell():
    for entry in (e for e in CORPUS if e["requires"] == "depth1"):
        solution = grid_of(entry["solution"])
        rows, cols = derive_clues(solution)
        stalled = propagate(blank(solution.shape), rows, cols).grid
        ctx = make_context(rows, cols)
        for r, c in zip(*np.nonzero(stalled == UNKNOWN)):
            deduced = _probe_cell(ctx, stalled, int(r), int(c), depth=1)
            if deduced[r, c] != UNKNOWN:
                assert deduced[r, c] == solution[r, c]
                return
    pytest.fail("no corpus puzzle had a refutable cell")


def test_depth2_deduces_cells_depth1_cannot():
    # Found by search: depth 1 stalls with 42 cells unknown; depth 2 finds
    # one more in under a second, and it must match the source grid.
    solution = grid_of([
        "1010001101100001100010",
        "0001110000100100101100",
        "0000001000110000100101",
        "0000100000000000101000",
    ])
    rows, cols = derive_clues(solution)
    depth1 = solve(blank(solution.shape), rows, cols, max_depth=1)
    depth2 = solve(blank(solution.shape), rows, cols, max_depth=2, depth2_budget=60)
    assert depth1.status is depth2.status is Status.STALLED
    assert not depth2.timed_out
    assert depth2.probe2_cells > 0
    assert (depth2.grid != UNKNOWN).sum() > (depth1.grid != UNKNOWN).sum()
    assert_sound(depth2, solution)


def test_detects_contradiction_that_propagation_misses():
    # Found by search: every line fits its clue and propagation stalls, but
    # probing shows no grid satisfies all the clues.
    rows = [(1, 1), (1, 1), (2,)]
    cols = [(2,), (1,), (), (1,), (2,)]
    assert propagate(blank((3, 5)), rows, cols).status is Status.STALLED
    assert solve(blank((3, 5)), rows, cols, max_depth=1).status is Status.CONTRADICTION


def test_max_depth_zero_is_propagation():
    entry = next(e for e in CORPUS if e["requires"] == "depth1")
    solution = grid_of(entry["solution"])
    rows, cols = derive_clues(solution)
    result = solve(blank(solution.shape), rows, cols, max_depth=0)
    plain = propagate(blank(solution.shape), rows, cols)
    assert result.status is plain.status is Status.STALLED
    assert np.array_equal(result.grid, plain.grid)
    assert result.probe1_cells == result.probe2_cells == 0


def test_counts_cells_by_technique():
    entry = next(e for e in CORPUS if e["requires"] == "depth1")
    solution = grid_of(entry["solution"])
    rows, cols = derive_clues(solution)
    result = solve(blank(solution.shape), rows, cols, max_depth=1)
    assert result.status is Status.SOLVED
    assert result.probe1_cells > 0 and result.probe2_cells == 0
    total = result.simple_cells + result.full_cells + result.probe1_cells
    assert total == solution.size


def test_input_grid_is_not_modified():
    entry = next(e for e in CORPUS if e["requires"] == "depth1")
    solution = grid_of(entry["solution"])
    rows, cols = derive_clues(solution)
    start = blank(solution.shape)
    solve(start, rows, cols)
    assert (start == UNKNOWN).all()


def test_rejects_invalid_depth():
    with pytest.raises(ValueError):
        solve(blank((1, 1)), [()], [()], max_depth=3)


# --- Depth-2 time budget --------------------------------------------------


def ambiguous_grid():
    # About 390 cells stay unknown after depth 1 (0.3 s), and depth 2 needs
    # well over 8 s to finish, so any small budget is reached.
    solution = np.random.default_rng(0).random((20, 20)) < 0.4
    return solution, *derive_clues(solution)


def test_depth2_stops_when_the_clock_passes_the_budget():
    solution, rows, cols = ambiguous_grid()
    readings = iter([0.0])  # the deadline is set from the first reading...

    def clock():
        return next(readings, 1e9)  # ...and every later reading is past it

    depth1 = solve(blank(solution.shape), rows, cols, max_depth=1)
    assert depth1.status is Status.STALLED
    result = solve(blank(solution.shape), rows, cols, max_depth=2, depth2_budget=5.0, clock=clock)
    assert result.status is Status.STALLED and result.timed_out
    assert result.probe2_cells == 0
    assert np.array_equal(result.grid, depth1.grid)
    assert_sound(result, solution)


def test_depth2_does_not_overrun_its_budget_in_real_time():
    solution, rows, cols = ambiguous_grid()
    budget = 0.3
    started = []

    def clock():
        now = time.monotonic()
        if not started:
            started.append(now)  # first reading: depth-2 probing begins
        return now

    result = solve(blank(solution.shape), rows, cols, max_depth=2, depth2_budget=budget, clock=clock)
    finished = time.monotonic()
    assert result.status is Status.STALLED and result.timed_out
    assert_sound(result, solution)
    # One probe's propagation may run past the deadline before the next check.
    assert finished - started[0] < budget + 0.5


def test_timed_out_flag_is_clear_when_depth2_finishes():
    solution = grid_of(next(e for e in CORPUS if e["requires"] == "none")["solution"])
    rows, cols = derive_clues(solution)
    result = solve(blank(solution.shape), rows, cols, max_depth=2, depth2_budget=60)
    assert result.status is Status.STALLED
    assert not result.timed_out


def test_shared_caches_give_identical_results():
    simple, full = CachedLineSolver(solve_simple), CachedLineSolver(solve_full)
    for entry in CORPUS:
        solution = grid_of(entry["solution"])
        rows, cols = derive_clues(solution)
        plain = solve(blank(solution.shape), rows, cols)
        cached = solve(blank(solution.shape), rows, cols, simple=simple, full=full)
        assert plain.status is cached.status
        assert np.array_equal(plain.grid, cached.grid)
        assert plain.probe1_cells == cached.probe1_cells
    assert len(simple) > 0 and simple.hit_rate > 0  # the caller's caches were used


def test_uses_a_fresh_caller_cache():
    # An empty cache is falsy, so it must not be swapped for a default one.
    simple = CachedLineSolver(solve_simple)
    solve(blank((2, 2)), [(1,), (1,)], [(1,), (1,)], simple=simple)
    assert simple.stats.lookups > 0
