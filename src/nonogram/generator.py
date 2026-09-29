"""Generation loop: flip-cost scoring, seeded tie-breaking, and fix-up."""

import math
import time
from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np

from nonogram.clues import derive_clues
from nonogram.image import threshold_grid
from nonogram.solver.line import UNKNOWN, CachedLineSolver, solve_full, solve_simple
from nonogram.solver.probe import DEFAULT_DEPTH2_BUDGET, SolveResult, solve
from nonogram.solver.propagate import Status
from nonogram.solver.search import DEFAULT_SEARCH_BUDGET, Outcome, SearchResult
from nonogram.solver.search import find_second_solution

MAX_FLIPS = 4  # cells flipped per iteration
MIN_FLIP_SPACING = 4  # Chebyshev distance between cells flipped together
MAX_ITERATIONS = 200
TIME_BUDGET = 120.0  # seconds
# Depth-2 probing runs only when depth 1 stalls with at most this many
# unknown cells (see benchmarks/RESULTS.md). Its cost tracks that count, and
# a count gate, unlike a time budget, gives the same result on any machine.
DEPTH2_MAX_UNKNOWN = 50


@dataclass(frozen=True)
class FlipWeights:
    """Weights for the flip cost; see ``flip_costs``.

    ``alpha`` scales source ambiguity, ``beta`` neighborhood fit, and
    ``epsilon`` the random tie-break. Each must be a finite number >= 0.
    """

    alpha: float = 1.0
    beta: float = 0.5
    epsilon: float = 0.01

    def __post_init__(self) -> None:
        for name in ("alpha", "beta", "epsilon"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be a number, got {value!r}")
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite number >= 0, got {value!r}")


def flip_costs(
    brightness: np.ndarray,
    solution: np.ndarray,
    threshold: float,
    rng: np.random.Generator | int | None = None,
    weights: FlipWeights = FlipWeights(),
) -> np.ndarray:
    """The cost of flipping each cell of ``solution``; lower is flipped first.

    For each cell *c*::

        cost(c) = alpha * |p_c - t| + beta * (1 - n_c / 8) + epsilon * u_c

    where *p* is the cell's brightness, *t* the threshold, *n* the number of
    8-neighbors that would match the cell's color after the flip (cells off
    the grid count as empty), and *u* a uniform draw in [0, 1) from ``rng``.

    The first term makes cells that were nearly the other color cheap. The
    second makes a flip that smooths an edge cheap and one that leaves an
    isolated speck expensive. The third breaks ties: the same seed gives the
    same costs, and a new seed (Regenerate) can pick different cells.

    ``rng`` is a NumPy ``Generator`` (advanced by one draw per cell, so a
    generation loop can share one across iterations) or a seed for a new one.
    Returns a float array shaped like ``solution``.
    """
    values = np.asarray(brightness, dtype=np.float64)
    filled = np.asarray(solution)
    if values.ndim != 2 or values.size == 0 or not np.isfinite(values).all():
        raise ValueError("brightness must be a non-empty 2-D array of finite values")
    if filled.shape != values.shape:
        raise ValueError(
            f"solution shape {filled.shape} doesn't match brightness shape {values.shape}"
        )
    if filled.dtype != bool:
        if not np.isin(filled, (0, 1)).all():
            raise ValueError("solution must contain only 0/1 or booleans")
        filled = filled.astype(bool)
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not 0 <= threshold <= 1
    ):
        raise ValueError(f"threshold must be a number from 0 to 1, got {threshold!r}")

    filled_neighbors = _filled_neighbors(filled)
    # After a flip the cell takes the opposite color: an empty cell becomes
    # filled and matches its filled neighbors, and vice versa.
    matching = np.where(filled, 8 - filled_neighbors, filled_neighbors)
    noise = np.random.default_rng(rng).random(values.shape)
    return (
        weights.alpha * np.abs(values - threshold)
        + weights.beta * (1.0 - matching / 8.0)
        + weights.epsilon * noise
    )


def _filled_neighbors(filled: np.ndarray) -> np.ndarray:
    """How many of each cell's 8 neighbors are filled; off-grid counts as empty."""
    rows, cols = filled.shape
    padded = np.pad(filled.astype(np.int8), 1)
    total = np.zeros((rows, cols), dtype=np.int8)
    for dr in (0, 1, 2):
        for dc in (0, 1, 2):
            if (dr, dc) != (1, 1):
                total += padded[dr : dr + rows, dc : dc + cols]
    return total


class GenerationError(Exception):
    """The flip loop couldn't make the puzzle unique within its limits."""


@dataclass(frozen=True)
class Generated:
    """A unique puzzle produced by :func:`generate`.

    ``solution`` is the accepted grid and ``original`` the thresholded grid
    it started from; they differ exactly at the flipped cells. ``batches``
    lists the cells flipped in each iteration, in order. ``solve`` is the
    final, accepted solve, whose counts feed the difficulty rating.
    """

    solution: np.ndarray
    original: np.ndarray
    batches: tuple[tuple[tuple[int, int], ...], ...]
    iterations: int
    solve: SolveResult

    @property
    def flipped(self) -> np.ndarray:
        return self.solution != self.original

    @property
    def flipped_count(self) -> int:
        return int(self.flipped.sum())


def generate(
    brightness: np.ndarray,
    threshold: float,
    *,
    invert: bool = False,
    seed: np.random.Generator | int | None = None,
    weights: FlipWeights = FlipWeights(),
    max_iterations: int = MAX_ITERATIONS,
    time_budget: float = TIME_BUDGET,
    search_budget: float = DEFAULT_SEARCH_BUDGET,
    depth2_max_unknown: int = DEPTH2_MAX_UNKNOWN,
    depth2_budget: float = DEFAULT_DEPTH2_BUDGET,
    clock: Callable[[], float] = time.monotonic,
) -> Generated:
    """Threshold ``brightness`` and flip cells until the puzzle is unique.

    Each iteration derives the clues and solves them from an empty grid,
    since a changed clue can invalidate deductions anywhere. A complete solve
    means the puzzle is unique and is accepted. On a stall, the second-
    solution search picks the candidate cells: those where a second solution
    differs, when it finds one, or else the stall's unknown cells. The
    cheapest candidates by :func:`flip_costs` are flipped, at most
    ``MAX_FLIPS`` per iteration and each at least ``MIN_FLIP_SPACING`` cells
    from the others, and the loop repeats. A cell is never flipped back.

    ``seed`` drives the cost tie-break, so the same inputs and seed give
    the same puzzle (unless a time budget runs out). Raises
    ``GenerationError`` when no eligible candidate remains, or after
    ``max_iterations`` solves or ``time_budget`` seconds.
    """
    original = threshold_grid(brightness, threshold, invert)
    solution = original.copy()
    rng = np.random.default_rng(seed)
    # One pair of line caches for the whole run: most lines repeat between
    # iterations, which is what makes re-solving from scratch cheap.
    solvers = {
        "simple": CachedLineSolver(solve_simple),
        "full": CachedLineSolver(solve_full),
    }
    deadline = clock() + time_budget
    batches: list[tuple[tuple[int, int], ...]] = []
    for iteration in range(1, max_iterations + 1):
        row_clues, col_clues = derive_clues(solution)
        result = solve_gated(
            row_clues,
            col_clues,
            depth2_max_unknown=depth2_max_unknown,
            depth2_budget=depth2_budget,
            clock=clock,
            **solvers,
        )
        if result.status is Status.SOLVED:
            return Generated(solution, original, tuple(batches), iteration, result)
        remaining = deadline - clock()
        if remaining <= 0:
            raise GenerationError(
                f"Couldn't make the puzzle unique within {time_budget:g} seconds "
                f"({len(batches)} rounds of flips). {_ADVICE}"
            )
        search = find_second_solution(
            result.grid,
            solution,
            row_clues,
            col_clues,
            budget=min(search_budget, remaining),
            clock=clock,
            **solvers,
        )
        eligible = flip_candidates(search, result.grid, solution != original)
        if not eligible.any():
            raise GenerationError(
                "Couldn't make the puzzle unique: every cell that could resolve the "
                f"ambiguity has already been flipped. {_ADVICE}"
            )
        costs = flip_costs(brightness, solution, threshold, rng, weights)
        batch = pick_batch(costs, eligible)
        for r, c in batch:
            solution[r, c] = not solution[r, c]
        batches.append(batch)
    raise GenerationError(
        f"Couldn't make the puzzle unique within {max_iterations} iterations. {_ADVICE}"
    )


_ADVICE = "Try a larger grid or a different threshold."


def solve_gated(
    row_clues,
    col_clues,
    *,
    depth2_max_unknown: int = DEPTH2_MAX_UNKNOWN,
    depth2_budget: float = DEFAULT_DEPTH2_BUDGET,
    simple=None,
    full=None,
    clock: Callable[[], float] = time.monotonic,
) -> SolveResult:
    """Solve from an empty grid, with depth-2 probing gated on the unknown count.

    Runs propagation and depth-1 probing; if that stalls with at most
    ``depth2_max_unknown`` unknown cells, continues with depth 2 from where
    it stopped. The returned counts cover both stages.
    """
    empty = np.full((len(row_clues), len(col_clues)), UNKNOWN, dtype=np.int8)
    kwargs = {"simple": simple, "full": full, "clock": clock}
    first = solve(empty, row_clues, col_clues, max_depth=1, **kwargs)
    unknown = int((first.grid == UNKNOWN).sum())
    if first.status is not Status.STALLED or unknown > depth2_max_unknown:
        return first
    second = solve(
        first.grid,
        row_clues,
        col_clues,
        max_depth=2,
        depth2_budget=depth2_budget,
        **kwargs,
    )
    return replace(
        second,
        simple_cells=first.simple_cells + second.simple_cells,
        full_cells=first.full_cells + second.full_cells,
        probe1_cells=first.probe1_cells + second.probe1_cells,
    )


def flip_candidates(
    search: SearchResult, stalled: np.ndarray, flipped: np.ndarray
) -> np.ndarray:
    """The cells eligible to flip after a stall, as a ``bool`` mask.

    Prefers the cells where the search's second solution differs from the
    target. When there is no second solution (the search timed out or proved
    the target unique), or every differing cell was already flipped, falls
    back to the stall's unknown cells. Cells flipped before are never
    eligible, so nothing is flipped back.
    """
    if search.outcome is Outcome.FOUND:
        preferred = search.candidates & ~flipped
        if preferred.any():
            return preferred
    return (np.asarray(stalled) == UNKNOWN) & ~flipped


def pick_batch(
    costs: np.ndarray,
    eligible: np.ndarray,
    max_flips: int = MAX_FLIPS,
    spacing: int = MIN_FLIP_SPACING,
) -> tuple[tuple[int, int], ...]:
    """The cheapest eligible cells, greedily, at most ``max_flips`` of them,
    each at least ``spacing`` apart in Chebyshev distance.

    Spacing lets separate ambiguous regions be fixed in the same iteration
    without two flips in one region interfering. Equal costs keep row-major
    order.
    """
    rows, cols = np.nonzero(eligible)
    order = np.argsort(costs[rows, cols], kind="stable")
    batch: list[tuple[int, int]] = []
    for i in order:
        r, c = int(rows[i]), int(cols[i])
        if all(max(abs(r - br), abs(c - bc)) >= spacing for br, bc in batch):
            batch.append((r, c))
            if len(batch) == max_flips:
                break
    return tuple(batch)
