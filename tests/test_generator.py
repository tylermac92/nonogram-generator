import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from nonogram.generator import FlipWeights, flip_costs

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
