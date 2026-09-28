import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from nonogram.clues import derive_clues
from nonogram.solver.line import EMPTY, FILLED, UNKNOWN, CachedLineSolver, solve_full, solve_simple
from nonogram.solver.propagate import COL, ROW, Status, propagate


def blank(shape) -> np.ndarray:
    return np.full(shape, UNKNOWN, dtype=np.int8)


def grid_of(rows: list[str]) -> np.ndarray:
    return np.array([[c == "1" for c in row] for row in rows], dtype=bool)


def solve_from_blank(solution: np.ndarray, **kwargs):
    rows, cols = derive_clues(solution)
    return propagate(blank(solution.shape), rows, cols, **kwargs)


def assert_sound(result, solution: np.ndarray, start: np.ndarray | None = None) -> None:
    known = result.grid != UNKNOWN
    assert np.array_equal(result.grid[known], solution[known].astype(np.int8)), "unsound deduction"
    if start is not None:
        assert np.array_equal(result.grid[start != UNKNOWN], start[start != UNKNOWN])
    # The source grid is a solution, so logic can never reach a contradiction,
    # and a solved grid must be the source grid itself.
    assert result.status is not Status.CONTRADICTION
    if result.status is Status.SOLVED:
        assert known.all()
    else:
        assert result.status is Status.STALLED and not known.all()


def test_soundness_on_1000_random_grids():
    rng = np.random.default_rng(20260928)
    shared = (CachedLineSolver(solve_simple), CachedLineSolver(solve_full))
    statuses = {Status.SOLVED: 0, Status.STALLED: 0}
    used_full = 0
    for _ in range(1000):
        height, width = rng.integers(1, 31, size=2)
        density = rng.uniform(0.2, 0.8)
        solution = rng.random((height, width)) < density
        result = solve_from_blank(solution, simple=shared[0], full=shared[1])
        assert_sound(result, solution)
        statuses[result.status] += 1
        used_full += result.full_cells > 0
    # The sample should exercise both outcomes and the full solver.
    assert statuses[Status.SOLVED] > 50 and statuses[Status.STALLED] > 50
    assert used_full > 50


@settings(max_examples=300, deadline=None)
@given(
    arrays(bool, st.tuples(st.integers(1, 12), st.integers(1, 12))),
    st.data(),
)
def test_soundness_from_partially_known_grids(solution, data):
    mask = data.draw(arrays(bool, solution.shape))
    start = np.where(mask, solution.astype(np.int8), UNKNOWN).astype(np.int8)
    rows, cols = derive_clues(solution)
    assert_sound(propagate(start, rows, cols), solution, start)


def test_solves_a_simple_puzzle_with_the_simple_solver_alone():
    solution = grid_of(["11111", "10001", "10101", "10001", "11111"])
    result = solve_from_blank(solution)
    assert result.status is Status.SOLVED
    assert np.array_equal(result.grid, solution.astype(np.int8))
    assert result.simple_cells == 25 and result.full_cells == 0


def test_falls_back_to_full_solver_when_simple_stalls():
    # Found by searching random grids: with the full solver disabled,
    # propagation stalls; with it, the puzzle is solved.
    solution = grid_of(["001010", "111110", "011101"])
    simple_only = solve_from_blank(solution, full=lambda clue, line: line.copy())
    assert simple_only.status is Status.STALLED
    result = solve_from_blank(solution)
    assert result.status is Status.SOLVED
    assert result.full_cells > 0
    assert result.simple_cells + result.full_cells == solution.size


def test_stalls_at_fixpoint_on_ambiguous_puzzle():
    # Two diagonals share these clues, so nothing can be deduced.
    solution = grid_of(["10", "01"])
    result = solve_from_blank(solution)
    assert result.status is Status.STALLED
    assert (result.grid == UNKNOWN).all()
    assert result.simple_cells == result.full_cells == 0


def test_detects_contradiction_from_known_cells():
    solution = grid_of(["111", "000", "111"])
    rows, cols = derive_clues(solution)
    start = blank(solution.shape)
    start[1, 1] = FILLED  # row 1 has clue ()
    assert propagate(start, rows, cols).status is Status.CONTRADICTION


def test_detects_contradiction_between_lines():
    # Each line is satisfiable alone, but rows need 2 filled cells and
    # columns only 1.
    result = propagate(blank((2, 2)), [(1,), (1,)], [(1,), ()])
    assert result.status is Status.CONTRADICTION


def test_detects_contradiction_on_a_complete_grid():
    solution = grid_of(["10", "01"])
    rows, cols = derive_clues(solution)
    wrong = np.array([[1, 1], [0, 0]], dtype=np.int8)
    assert propagate(wrong, rows, cols).status is Status.CONTRADICTION
    right = solution.astype(np.int8)
    result = propagate(right, rows, cols)
    assert result.status is Status.SOLVED
    assert result.simple_cells == result.full_cells == 0


def test_input_grid_is_not_modified():
    solution = grid_of(["111", "101", "111"])
    rows, cols = derive_clues(solution)
    start = blank(solution.shape)
    result = propagate(start, rows, cols)
    assert result.status is Status.SOLVED
    assert (start == UNKNOWN).all()


def test_dirty_limits_the_initial_queue():
    solution = grid_of(["010", "010", "010"])
    rows, cols = derive_clues(solution)
    no_full = {"full": lambda clue, line: line.copy()}
    # Only column 1 starts dirty. Its clue (3,) fills it, which queues every
    # row, and each row's (1,) then empties the rest: simple solver only.
    result = propagate(blank((3, 3)), rows, cols, dirty=[(COL, 1)], **no_full)
    assert result.status is Status.SOLVED
    assert result.simple_cells == 9
    # Starting from column 0, whose (,) clue empties it, the rows can't finish.
    partial = propagate(blank((3, 3)), rows, cols, dirty=[(COL, 0)], **no_full)
    assert partial.status is Status.STALLED
    # With nothing dirty, the simple solver never runs.
    idle = propagate(blank((3, 3)), rows, cols, dirty=[], **no_full)
    assert idle.status is Status.STALLED
    assert idle.simple_cells == 0


def test_cached_solvers_give_identical_results():
    rng = np.random.default_rng(7)
    simple, full = CachedLineSolver(solve_simple), CachedLineSolver(solve_full)
    for _ in range(50):
        solution = rng.random((10, 10)) < 0.5
        plain = solve_from_blank(solution)
        cached = solve_from_blank(solution, simple=simple, full=full)
        assert plain.status is cached.status
        assert np.array_equal(plain.grid, cached.grid)
        assert (plain.simple_cells, plain.full_cells) == (cached.simple_cells, cached.full_cells)
    assert simple.hit_rate > 0


def test_rejects_mismatched_clue_counts():
    with pytest.raises(ValueError):
        propagate(blank((2, 3)), [(), ()], [(), ()])
