import itertools
import json
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

import nonogram.generator as generator
from nonogram.clues import derive_clues
from nonogram.generator import (
    MAX_FLIPS,
    MIN_FLIP_SPACING,
    FlipWeights,
    MAX_ITERATIONS,
    TIME_BUDGET,
    FailureReason,
    Generated,
    GenerationError,
    flip_candidates,
    flip_costs,
    generate,
    pick_batch,
    solve_gated,
)
from nonogram.image import threshold_grid
from nonogram.solver.line import UNKNOWN
from nonogram.solver.probe import SolveResult, solve
from nonogram.solver.propagate import Status
from nonogram.solver.search import Outcome, SearchResult

NO_NOISE = FlipWeights(epsilon=0.0)


def brute_matching(solution: np.ndarray, r: int, c: int) -> int:
    """8-neighbors of (r, c) matching its flipped color, off-grid as empty."""
    rows, cols = solution.shape
    new_color = not solution[r, c]
    count = 0
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if (dr, dc) == (0, 0):
                continue
            rr, cc = r + dr, c + dc
            neighbor = (
                bool(solution[rr, cc]) if 0 <= rr < rows and 0 <= cc < cols else False
            )
            count += neighbor == new_color
    return count


# Weights


def test_default_weights():
    assert FlipWeights() == FlipWeights(alpha=1, beta=0.5, epsilon=0.01)
    assert (FlipWeights().alpha, FlipWeights().beta, FlipWeights().epsilon) == (
        1.0,
        0.5,
        0.01,
    )


def test_weights_are_configurable():
    brightness = np.array([[0.2, 0.9], [0.5, 0.45]])
    solution = np.array([[1, 0], [0, 1]], dtype=bool)
    ambiguity = flip_costs(
        brightness, solution, 0.5, weights=FlipWeights(2.0, 0.0, 0.0)
    )
    assert np.allclose(ambiguity, 2.0 * np.abs(brightness - 0.5))
    fit = flip_costs(brightness, solution, 0.5, weights=FlipWeights(0.0, 3.0, 0.0))
    # Clearing a filled corner matches the 5 off-grid cells and 2 empty
    # neighbors; filling an empty corner matches the 2 filled ones.
    assert np.allclose(fit, 3.0 * (1 - np.array([[7, 2], [2, 7]]) / 8))
    noise = flip_costs(
        brightness, solution, 0.5, rng=7, weights=FlipWeights(0.0, 0.0, 0.25)
    )
    assert ((noise >= 0) & (noise < 0.25)).all() and len(np.unique(noise)) == 4


def test_zero_weights_give_zero_cost():
    costs = flip_costs(
        np.full((3, 3), 0.1), np.zeros((3, 3), bool), 0.5, 1, FlipWeights(0, 0, 0)
    )
    assert (costs == 0).all()


@pytest.mark.parametrize(
    "kwargs",
    [
        {"alpha": -1},
        {"beta": float("nan")},
        {"epsilon": float("inf")},
        {"alpha": "1"},
        {"beta": True},
    ],
)
def test_bad_weights_rejected(kwargs):
    with pytest.raises(ValueError):
        FlipWeights(**kwargs)


# Source ambiguity


def test_near_threshold_cell_is_cheaper():
    # Two empty cells in identical neighborhoods, one nearly dark enough to
    # be filled and one far lighter than the threshold.
    brightness = np.full((5, 9), 0.9)
    brightness[2, 2] = 0.52
    brightness[2, 6] = 0.95
    solution = np.zeros((5, 9), dtype=bool)
    costs = flip_costs(brightness, solution, 0.5, rng=0)
    assert costs[2, 2] < costs[2, 6]
    # Same for filled cells on the dark side of the threshold.
    costs = flip_costs(1 - brightness, ~solution, 0.5, rng=0)
    assert costs[2, 2] < costs[2, 6]


@given(
    near=st.floats(0, 0.5),
    extra=st.floats(0.02, 0.5),
    t=st.floats(0.25, 0.75),
    seed=st.integers(0, 2**32 - 1),
)
def test_distance_from_threshold_orders_cost(near, extra, t, seed):
    # With default weights, a difference in |p - t| beyond epsilon always wins.
    far = near + extra
    brightness = np.full((3, 7), t)
    brightness[1, 1] = min(1.0, t + near)
    brightness[1, 5] = min(1.0, t + far)
    if brightness[1, 5] - brightness[1, 1] <= 0.011:
        return
    costs = flip_costs(brightness, np.zeros((3, 7), bool), t, rng=seed)
    assert costs[1, 1] < costs[1, 5]


# Neighborhood fit


def test_isolated_speck_costs_more_than_smoothing_an_edge():
    # Top rows filled, bottom rows empty, with a notch cut into the edge.
    solution = np.zeros((7, 7), dtype=bool)
    solution[:3] = True
    solution[2, 3] = False  # notch: filling it back smooths the edge
    brightness = np.full((7, 7), 0.6)
    costs = flip_costs(brightness, solution, 0.5, rng=0)
    notch, speck = costs[2, 3], costs[5, 3]  # speck: filling a cell in open space
    assert notch < speck
    assert brute_matching(solution, 2, 3) == 5 and brute_matching(solution, 5, 3) == 0


def test_hole_in_solid_region_costs_more_than_trimming_a_bump():
    solution = np.zeros((7, 7), dtype=bool)
    solution[:4] = True
    solution[4, 3] = True  # bump sticking out of the edge: clearing it smooths
    brightness = np.full((7, 7), 0.4)
    costs = flip_costs(brightness, solution, 0.5, rng=0)
    bump, hole = costs[4, 3], costs[1, 3]  # hole: an empty speck in solid fill
    assert bump < hole


def test_off_grid_counts_as_empty():
    costs = flip_costs(
        np.full((4, 4), 0.5), np.zeros((4, 4), bool), 0.5, weights=NO_NOISE
    )
    # Filling a corner of an empty grid: nothing matches.
    assert costs[0, 0] == pytest.approx(0.5)
    costs = flip_costs(
        np.full((4, 4), 0.5), np.ones((4, 4), bool), 0.5, weights=NO_NOISE
    )
    # Clearing a corner of a full grid: the 5 off-grid neighbors match.
    assert costs[0, 0] == pytest.approx(0.5 * (1 - 5 / 8))
    assert costs[0, 1] == pytest.approx(0.5 * (1 - 3 / 8))
    assert costs[1, 1] == pytest.approx(0.5)


@given(arrays(bool, st.tuples(st.integers(1, 7), st.integers(1, 7))))
def test_neighborhood_term_matches_brute_force(solution):
    costs = flip_costs(
        np.full(solution.shape, 0.5), solution, 0.5, weights=FlipWeights(0, 1, 0)
    )
    expected = np.array(
        [
            [1 - brute_matching(solution, r, c) / 8 for c in range(solution.shape[1])]
            for r in range(solution.shape[0])
        ]
    )
    assert np.allclose(costs, expected)


def test_full_formula():
    rng = np.random.default_rng(3)
    brightness = rng.random((6, 8))
    solution = brightness < 0.4
    costs = flip_costs(
        brightness, solution, 0.4, rng=11, weights=FlipWeights(1.5, 0.7, 0.2)
    )
    noise = np.random.default_rng(11).random((6, 8))
    matching = np.array(
        [[brute_matching(solution, r, c) for c in range(8)] for r in range(6)]
    )
    expected = 1.5 * np.abs(brightness - 0.4) + 0.7 * (1 - matching / 8) + 0.2 * noise
    assert np.allclose(costs, expected)


# Seeded tie-break


def test_same_seed_same_costs():
    brightness, solution = np.full((5, 5), 0.3), np.eye(5, dtype=bool)
    a = flip_costs(brightness, solution, 0.5, rng=42)
    b = flip_costs(brightness, solution, 0.5, rng=42)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, flip_costs(brightness, solution, 0.5, rng=43))


def test_tie_break_separates_identical_cells_and_varies_by_seed():
    # Every cell is equally ambiguous and equally isolated: only the
    # tie-break decides, and different seeds choose different cells.
    brightness, solution = np.full((6, 6), 0.5), np.zeros((6, 6), bool)
    interior = (slice(1, 5), slice(1, 5))
    cheapest = set()
    for seed in range(20):
        costs = flip_costs(brightness, solution, 0.5, rng=seed)[interior]
        assert len(np.unique(costs)) == costs.size
        assert costs.max() - costs.min() < 0.01
        cheapest.add(int(np.argmin(costs)))
    assert len(cheapest) > 1


def test_shared_generator_advances():
    brightness, solution = np.full((3, 3), 0.5), np.zeros((3, 3), bool)
    rng = np.random.default_rng(5)
    first = flip_costs(brightness, solution, 0.5, rng=rng)
    second = flip_costs(brightness, solution, 0.5, rng=rng)
    assert not np.array_equal(first, second)
    replay = np.random.default_rng(5)
    assert np.array_equal(first, flip_costs(brightness, solution, 0.5, rng=replay))
    assert np.array_equal(second, flip_costs(brightness, solution, 0.5, rng=replay))


def test_tie_break_never_outweighs_real_differences():
    # The noise is below epsilon, so it can't reorder cells whose costs
    # otherwise differ by more than that.
    brightness = np.full((3, 3), 0.5)
    brightness[1, 1] = 0.515
    solution = np.zeros((3, 3), bool)  # every flip leaves a speck: equal fit
    base = flip_costs(brightness, solution, 0.5, weights=NO_NOISE)
    for seed in range(50):
        costs = flip_costs(brightness, solution, 0.5, rng=seed)
        assert ((costs - base >= 0) & (costs - base < 0.01)).all()
        assert np.argmax(costs) == 4


# Validation


def test_integer_solution_accepted():
    brightness = np.full((3, 3), 0.5)
    ints = np.eye(3, dtype=np.int8)
    assert np.array_equal(
        flip_costs(brightness, ints, 0.5, rng=1),
        flip_costs(brightness, ints.astype(bool), 0.5, rng=1),
    )


@pytest.mark.parametrize(
    "brightness, solution, threshold, message",
    [
        (np.zeros((2, 3)), np.zeros((3, 2), bool), 0.5, "doesn't match"),
        (np.zeros(3), np.zeros(3, bool), 0.5, "2-D"),
        (np.zeros((0, 0)), np.zeros((0, 0), bool), 0.5, "non-empty"),
        (np.full((2, 2), np.nan), np.zeros((2, 2), bool), 0.5, "finite"),
        (np.zeros((2, 2)), np.full((2, 2), 2), 0.5, "0/1"),
        (np.zeros((2, 2)), np.zeros((2, 2), bool), 1.5, "threshold"),
        (np.zeros((2, 2)), np.zeros((2, 2), bool), True, "threshold"),
    ],
)
def test_bad_input_rejected(brightness, solution, threshold, message):
    with pytest.raises(ValueError, match=message):
        flip_costs(brightness, solution, threshold)


# Flip loop


def is_unique(solution: np.ndarray) -> bool:
    """Whether logic alone (sound, so SOLVED means unique) solves the clues."""
    empty = np.full(solution.shape, UNKNOWN, dtype=np.int8)
    return solve(empty, *derive_clues(solution)).status is Status.SOLVED


def chebyshev(a: tuple[int, int], b: tuple[int, int]) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def checker_image() -> np.ndarray:
    """Two dark cells on a diagonal: the classic two-solution 2x2 pattern.

    (2, 2) is barely darker than the threshold, so it's the cheap one.
    """
    brightness = np.full((6, 6), 0.9)
    brightness[2, 2] = 0.45
    brightness[3, 3] = 0.1
    return brightness


NOISE = [np.random.default_rng(seed).random((10, 10)) for seed in range(8)]


def test_unique_image_needs_no_flips():
    brightness = np.full((8, 8), 0.9)
    brightness[2:5, 1:6] = 0.1
    result = generate(brightness, 0.5, seed=0)
    assert result.iterations == 1 and result.batches == ()
    assert np.array_equal(result.solution, result.original)
    assert result.flipped_count == 0 and result.solve.status is Status.SOLVED


def test_ambiguous_image_flips_the_cheapest_diff_cell():
    result = generate(checker_image(), 0.5, seed=0)
    assert result.batches == (((2, 2),),)
    assert result.iterations == 2
    expected = np.zeros((6, 6), bool)
    expected[3, 3] = True
    assert np.array_equal(result.solution, expected)
    assert is_unique(result.solution)


def test_invert_thresholds_the_other_way():
    brightness = 1 - checker_image()
    result = generate(brightness, 0.5, invert=True, seed=0)
    assert np.array_equal(result.original, threshold_grid(brightness, 0.5, invert=True))
    assert is_unique(result.solution)


@pytest.mark.parametrize("index", range(len(NOISE)))
def test_loop_invariants_on_noise(index, monkeypatch):
    brightness = NOISE[index]
    solves, searches = [], []
    real_solve, real_search = generator.solve, generator.find_second_solution

    def recording_solve(grid, *args, **kwargs):
        solves.append((grid.copy(), kwargs["max_depth"]))
        return real_solve(grid, *args, **kwargs)

    def recording_search(stalled, *args, **kwargs):
        result = real_search(stalled, *args, **kwargs)
        searches.append((stalled.copy(), result))
        return result

    monkeypatch.setattr(generator, "solve", recording_solve)
    monkeypatch.setattr(generator, "find_second_solution", recording_search)
    result = generate(brightness, 0.5, seed=index)

    assert is_unique(result.solution)
    assert result.iterations == len(result.batches) + 1 == len(searches) + 1
    # Every iteration starts its solve from an empty grid.
    first_stage = [grid for grid, depth in solves if depth == 1]
    assert len(first_stage) == result.iterations
    assert all((grid == UNKNOWN).all() for grid in first_stage)
    # At most 4 cells per batch, spaced at least 4 apart.
    for batch in result.batches:
        assert 1 <= len(batch) <= MAX_FLIPS
        assert all(
            chebyshev(a, b) >= MIN_FLIP_SPACING
            for a, b in itertools.combinations(batch, 2)
        )
    # No cell is flipped twice, so none is ever flipped back.
    cells = [cell for batch in result.batches for cell in batch]
    assert len(cells) == len(set(cells)) == result.flipped_count
    flipped = np.zeros_like(result.flipped)
    for r, c in cells:
        flipped[r, c] = True
    assert np.array_equal(flipped, result.flipped)
    # Each batch comes from the search's preferred cells when it found a
    # second solution (and some are still unflipped), else the stall's unknowns.
    done = np.zeros_like(flipped)
    for batch, (stalled, search) in zip(result.batches, searches):
        preferred = (
            search.candidates & ~done if search.outcome is Outcome.FOUND else None
        )
        pool = (
            preferred
            if preferred is not None and preferred.any()
            else stalled == UNKNOWN
        )
        assert all(pool[r, c] and not done[r, c] for r, c in batch)
        for r, c in batch:
            done[r, c] = True


def test_same_seed_same_puzzle_and_seeds_vary():
    brightness = NOISE[0]
    first = generate(brightness, 0.5, seed=3)
    again = generate(brightness, 0.5, seed=3)
    assert (
        np.array_equal(first.solution, again.solution)
        and first.batches == again.batches
    )
    # A symmetric checker ties its two dark cells: the seed picks which goes.
    symmetric = checker_image()
    symmetric[2, 2] = 0.1
    batches = {generate(symmetric, 0.5, seed=s).batches for s in range(10)}
    assert batches == {(((2, 2),),), (((3, 3),),)}


def test_flip_candidates_prefers_second_solution_diff():
    stalled = np.full((4, 4), UNKNOWN, dtype=np.int8)
    stalled[0] = 1
    diff = np.zeros((4, 4), bool)
    diff[1, 1] = diff[2, 2] = True
    flipped = np.zeros((4, 4), bool)
    found = SearchResult(Outcome.FOUND, diff, np.zeros((4, 4), bool))
    assert np.array_equal(flip_candidates(found, stalled, flipped), diff)
    # A diff cell already flipped is never eligible again.
    flipped[1, 1] = True
    assert np.array_equal(flip_candidates(found, stalled, flipped), diff & ~flipped)


@pytest.mark.parametrize("outcome", [Outcome.TIMED_OUT, Outcome.UNIQUE, Outcome.FOUND])
def test_flip_candidates_falls_back_to_unknown_cells(outcome):
    stalled = np.full((4, 4), UNKNOWN, dtype=np.int8)
    stalled[0] = 1
    flipped = np.zeros((4, 4), bool)
    flipped[3, 3] = True
    if outcome is Outcome.FOUND:
        # Every cell the second solution changes has been flipped already.
        search = SearchResult(outcome, flipped.copy(), np.zeros((4, 4), bool))
    else:
        search = SearchResult(outcome, stalled == UNKNOWN)
    expected = (stalled == UNKNOWN) & ~flipped
    assert np.array_equal(flip_candidates(search, stalled, flipped), expected)


def test_loop_uses_unknown_cells_when_search_finds_nothing(monkeypatch):
    stalls = []

    def no_second(stalled, *args, **kwargs):
        stalls.append(stalled.copy())
        return SearchResult(Outcome.TIMED_OUT, stalled == UNKNOWN)

    monkeypatch.setattr(generator, "find_second_solution", no_second)
    result = generate(NOISE[1], 0.5, seed=0)
    assert is_unique(result.solution)
    for batch, stalled in zip(result.batches, stalls):
        assert all(stalled[r, c] == UNKNOWN for r, c in batch)


def naive_batch(costs, eligible, max_flips, spacing):
    cells = sorted(zip(*np.nonzero(eligible)), key=lambda rc: (costs[rc], rc))
    batch = []
    for r, c in cells:
        if len(batch) < max_flips and all(
            chebyshev((r, c), b) >= spacing for b in batch
        ):
            batch.append((int(r), int(c)))
    return tuple(batch)


@given(
    costs=arrays(np.float64, (9, 9), elements=st.floats(0, 1)),
    eligible=arrays(bool, (9, 9)),
    max_flips=st.integers(1, 6),
    spacing=st.integers(1, 5),
)
def test_pick_batch_is_greedy_cheapest_with_spacing(
    costs, eligible, max_flips, spacing
):
    batch = pick_batch(costs, eligible, max_flips, spacing)
    assert batch == naive_batch(costs, eligible, max_flips, spacing)
    assert len(batch) <= max_flips and all(eligible[cell] for cell in batch)
    assert all(chebyshev(a, b) >= spacing for a, b in itertools.combinations(batch, 2))
    if eligible.any():
        cheapest = costs[eligible].min()
        assert batch and costs[batch[0]] == cheapest
    if len(batch) < max_flips:
        # Every eligible cell left out is too close to one taken.
        for cell in zip(*np.nonzero(eligible)):
            assert cell in batch or any(chebyshev(cell, b) < spacing for b in batch)


def test_pick_batch_defaults():
    batch = pick_batch(np.zeros((12, 12)), np.ones((12, 12), bool))
    assert batch == ((0, 0), (0, 4), (0, 8), (4, 0))


# Depth-2 gate

STAIRS_KINKED = next(
    e
    for e in json.loads(
        (Path(__file__).parent / "corpus" / "puzzles.json").read_text()
    )["puzzles"]
    if e["name"] == "stairs-kinked"
)
STAIRS = np.array([[ch == "1" for ch in row] for row in STAIRS_KINKED["solution"]])


def test_depth2_skipped_above_the_unknown_limit():
    # Depth 1 stalls on this unique expert puzzle with 61 unknown cells.
    result = solve_gated(*derive_clues(STAIRS))
    assert result.status is Status.STALLED
    assert int((result.grid == UNKNOWN).sum()) == 61 and result.probe2_cells == 0


def test_depth2_runs_within_the_unknown_limit():
    depth1 = solve_gated(*derive_clues(STAIRS), depth2_max_unknown=0)
    result = solve_gated(*derive_clues(STAIRS), depth2_max_unknown=61)
    assert result.status is Status.SOLVED and result.probe2_cells > 0
    # Counts cover both stages.
    assert result.probe1_cells >= depth1.probe1_cells
    assert result.simple_cells >= depth1.simple_cells
    total = (
        result.simple_cells
        + result.full_cells
        + result.probe1_cells
        + result.probe2_cells
    )
    assert total == STAIRS.size


def test_generate_passes_the_gate_through():
    brightness = np.where(STAIRS, 0.1, 0.9)
    result = generate(brightness, 0.5, seed=0, depth2_max_unknown=61)
    assert result.flipped_count == 0 and result.solve.probe2_cells > 0


# Limits

ADVICE = "Try a larger grid or a different threshold."


def test_iteration_limit():
    with pytest.raises(GenerationError) as info:
        generate(checker_image(), 0.5, seed=0, max_iterations=1)
    error = info.value
    assert error.reason is FailureReason.ITERATIONS
    assert "still ambiguous after 1 iteration " in str(error) and ADVICE in str(error)
    assert (error.iterations, error.flipped_cells) == (1, 0)


def test_default_iteration_limit_is_200(monkeypatch):
    # Pretend every solve stalls and the search always finds new cells.
    stalled = SolveResult(Status.STALLED, np.full((10, 10), UNKNOWN, dtype=np.int8))
    monkeypatch.setattr(generator, "solve_gated", lambda *a, **k: stalled)
    searches = []

    def search(grid, *args, **kwargs):
        searches.append(1)
        return SearchResult(Outcome.TIMED_OUT, grid == UNKNOWN)

    monkeypatch.setattr(generator, "find_second_solution", search)
    monkeypatch.setattr(generator, "pick_batch", lambda costs, eligible: ())
    with pytest.raises(GenerationError, match="after 200 iterations") as info:
        generate(NOISE[0], 0.5, seed=0)
    assert MAX_ITERATIONS == 200 and info.value.iterations == 200
    # The last solve's stall isn't searched: its flips could never be tried.
    assert len(searches) == 199


def test_time_limit():
    # Each clock read advances 100 s: the first stall is already past 120 s.
    ticks = itertools.count(step=100)
    with pytest.raises(GenerationError) as info:
        generate(checker_image(), 0.5, seed=0, clock=lambda: next(ticks))
    error = info.value
    assert TIME_BUDGET == 120
    assert error.reason is FailureReason.TIME
    assert "ran out of time after 120 seconds" in str(error) and ADVICE in str(error)
    assert (error.iterations, error.flipped_cells) == (1, 0)


def test_time_limit_counts_from_the_start(monkeypatch):
    now = [0.0]
    real_search = generator.find_second_solution

    def slow_search(*args, **kwargs):
        now[0] += 50  # each search takes 50 s of fake time
        return real_search(*args, **kwargs)

    monkeypatch.setattr(generator, "find_second_solution", slow_search)
    with pytest.raises(GenerationError, match="120 seconds") as info:
        generate(NOISE[2], 0.5, seed=0, clock=lambda: now[0])
    # This grid needs 6 solves unhindered. Searches end at 50, 100 and
    # 150 s, so the fourth stall is past 120 s.
    assert info.value.iterations == 4 and info.value.flipped_cells > 0


def test_late_but_successful_solve_is_kept():
    # Past the deadline before the first solve finishes, but it succeeds.
    brightness = np.full((8, 8), 0.9)
    brightness[2:5, 1:6] = 0.1
    ticks = itertools.count(step=1000)
    result = generate(brightness, 0.5, seed=0, clock=lambda: next(ticks))
    assert result.solve.status is Status.SOLVED


def test_no_eligible_candidates(monkeypatch):
    monkeypatch.setattr(
        generator, "flip_candidates", lambda s, g, f: np.zeros(g.shape, bool)
    )
    with pytest.raises(GenerationError) as info:
        generate(checker_image(), 0.5, seed=0)
    error = info.value
    assert error.reason is FailureReason.NO_CANDIDATES
    assert "already been changed" in str(error) and ADVICE in str(error)


def test_candidates_run_out_after_flips(monkeypatch):
    # The search only ever offers the checker's four cells: after flipping
    # the ones it picks, nothing eligible is left.
    square = np.zeros((6, 6), bool)
    square[2:4, 2:4] = True
    monkeypatch.setattr(
        generator,
        "find_second_solution",
        lambda *a, **k: SearchResult(Outcome.FOUND, square.copy(), None),
    )
    monkeypatch.setattr(
        generator,
        "solve_gated",
        lambda rows, cols, **k: SolveResult(
            Status.STALLED, np.full((6, 6), 0, dtype=np.int8)
        ),
    )
    with pytest.raises(GenerationError) as info:
        generate(checker_image(), 0.5, seed=0)
    assert info.value.reason is FailureReason.NO_CANDIDATES
    assert info.value.flipped_cells == 4 and info.value.iterations == 5


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"max_iterations": 0}, "at least 1"),
        ({"max_iterations": 2.5}, "integer"),
        ({"max_iterations": True}, "integer"),
        ({"time_budget": 0}, "greater than 0"),
        ({"time_budget": float("nan")}, "greater than 0"),
    ],
)
def test_bad_limits_rejected(kwargs, message):
    with pytest.raises(ValueError, match=message):
        generate(checker_image(), 0.5, **kwargs)


# Warnings


def generated(flips: int, size: int = 20) -> Generated:
    original = np.zeros((size, size), bool)
    solution = original.copy()
    solution.flat[:flips] = True
    solve_result = SolveResult(Status.SOLVED, solution.astype(np.int8))
    return Generated(solution, original, (), 1, solve_result)


@pytest.mark.parametrize("flips", [0, 1, 19, 20])
def test_no_warning_at_or_under_5_percent(flips):
    assert generated(flips).warning is None


@pytest.mark.parametrize("flips", [21, 40, 400])
def test_warning_over_5_percent(flips):
    warning = generated(flips).warning
    assert (
        warning is not None and f"{flips} of 400 cells" in warning and ADVICE in warning
    )


def test_warning_text_and_percentage():
    result = generated(21)
    assert result.flipped_pct == pytest.approx(5.25)
    assert result.warning.startswith("21 of 400 cells (5.2%) were changed")
    # Non-square grids use the full cell count.
    original = np.zeros((10, 30), bool)
    solution = original.copy()
    solution.flat[:16] = True
    result = Generated(solution, original, (), 1, SolveResult(Status.SOLVED, solution))
    assert result.flipped_pct == pytest.approx(16 / 3)
    assert "16 of 300 cells (5.3%)" in result.warning


def test_generate_warns_only_past_5_percent():
    # One flip in a 6x6 grid is 2.8%: no warning.
    assert generate(checker_image(), 0.5, seed=0).warning is None
    # The same pattern in a 4x4 grid needs one flip out of 16 cells, 6.25%.
    small = np.full((4, 4), 0.9)
    small[1, 1], small[2, 2] = 0.45, 0.1
    result = generate(small, 0.5, seed=0)
    assert result.flipped_count == 1
    assert result.warning.startswith("1 of 16 cells (6.2%)")
