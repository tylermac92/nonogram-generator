"""Depth-1 and depth-2 contradiction probing.

When propagation stalls, the solver probes an unknown cell: it assumes the
cell is filled and propagates on a copy of the grid, then assumes it is
empty. If one assumption leads to a contradiction, the cell takes the other
value (and everything the surviving branch deduced follows). If both
survive, any cell that ends up the same in both branches is deduced too.
Any deduction hands control back to propagation.

A depth-2 probe runs depth-1 probing inside each branch, so it can refute an
assumption that propagation alone can't. It is far more expensive, so it
runs only when depth 1 stalls, and under a time budget shared across the
whole solve.
"""

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np

from nonogram.clues import Clue
from nonogram.solver.line import EMPTY, FILLED, UNKNOWN, CachedLineSolver, LineSolver
from nonogram.solver.line import solve_full, solve_simple
from nonogram.solver.propagate import COL, ROW, Line, Status, propagate

DEFAULT_DEPTH2_BUDGET = 10.0  # seconds


@dataclass(frozen=True)
class SolveResult:
    """Outcome of :func:`solve`.

    ``status`` is SOLVED, STALLED, or CONTRADICTION. The ``*_cells`` fields
    count the cells each technique deduced in the top-level solve (cells
    deduced inside a probe's hypothetical branches are not counted).
    ``timed_out`` is set when depth-2 probing ran out of budget; the grid
    then holds every sound deduction made before it stopped.
    """

    status: Status
    grid: np.ndarray
    simple_cells: int = 0
    full_cells: int = 0
    probe1_cells: int = 0
    probe2_cells: int = 0
    timed_out: bool = False


class _TimedOut(Exception):
    pass


@dataclass
class _Context:
    clues: tuple[Sequence[Clue], Sequence[Clue]]
    simple: LineSolver
    full: LineSolver
    clock: Callable[[], float]
    depth2_budget: float
    deadline: float | None = None  # set when depth-2 probing first starts
    in_depth2: bool = False  # the budget applies only inside depth-2 passes
    counts: dict[str, int] = field(
        default_factory=lambda: {"simple": 0, "full": 0, "probe1": 0, "probe2": 0}
    )

    def check_deadline(self) -> None:
        if self.in_depth2 and self.clock() > self.deadline:
            raise _TimedOut

    def propagate(self, grid: np.ndarray, dirty: list[Line] | None, count: bool):
        result = propagate(
            grid, *self.clues, dirty=dirty, simple=self.simple, full=self.full
        )
        if count:
            self.counts["simple"] += result.simple_cells
            self.counts["full"] += result.full_cells
        return result


def solve(
    grid: np.ndarray,
    row_clues: Sequence[Clue],
    col_clues: Sequence[Clue],
    *,
    max_depth: int = 2,
    depth2_budget: float = DEFAULT_DEPTH2_BUDGET,
    simple: LineSolver | None = None,
    full: LineSolver | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> SolveResult:
    """Solve by propagation plus probing up to ``max_depth`` (0, 1, or 2).

    Every deduction is sound, so a SOLVED result is the puzzle's unique
    solution. ``depth2_budget`` caps the seconds spent in depth-2 probing
    across the whole call; when it runs out, the result is STALLED with
    ``timed_out`` set. ``simple`` and ``full`` default to fresh line-solver
    caches shared by every probe in this call. ``grid`` is not modified.
    """
    if max_depth not in (0, 1, 2):
        raise ValueError(f"max_depth must be 0, 1, or 2, got {max_depth}")
    ctx = _Context(
        clues=(row_clues, col_clues),
        # "is None", not "or": an empty CachedLineSolver is falsy (it has __len__).
        simple=CachedLineSolver(solve_simple) if simple is None else simple,
        full=CachedLineSolver(solve_full) if full is None else full,
        clock=clock,
        depth2_budget=depth2_budget,
    )

    def finish(status: Status, grid: np.ndarray, timed_out: bool = False) -> SolveResult:
        c = ctx.counts
        return SolveResult(
            status, grid, c["simple"], c["full"], c["probe1"], c["probe2"], timed_out
        )

    result = ctx.propagate(grid, None, count=True)
    grid = result.grid
    if result.status is not Status.STALLED or max_depth == 0:
        return finish(result.status, grid)

    while True:
        status, grid = _probe_to_fixpoint(ctx, grid, count=True)
        if status is not Status.STALLED or max_depth == 1:
            return finish(status, grid)

        # Depth 1 is exhausted: try one depth-2 deduction, then go back to
        # the cheaper techniques.
        if ctx.deadline is None:
            ctx.deadline = ctx.clock() + ctx.depth2_budget
        ctx.in_depth2 = True
        try:
            outcome = _probe_pass(ctx, grid, depth=2, count=True, first_only=True)
        except _TimedOut:
            return finish(Status.STALLED, grid, timed_out=True)
        finally:
            ctx.in_depth2 = False
        if outcome is None:
            return finish(Status.STALLED, grid)
        status, grid = outcome
        if status is not Status.STALLED:
            return finish(status, grid)


def _probe_to_fixpoint(
    ctx: _Context, grid: np.ndarray, count: bool
) -> tuple[Status, np.ndarray]:
    """Alternate depth-1 probing and propagation until neither deduces more."""
    while True:
        outcome = _probe_pass(ctx, grid, depth=1, count=count, first_only=False)
        if outcome is None:
            return Status.STALLED, grid
        status, grid = outcome
        if status is not Status.STALLED:
            return status, grid


def _probe_pass(
    ctx: _Context, grid: np.ndarray, depth: int, count: bool, first_only: bool
) -> tuple[Status, np.ndarray] | None:
    """Probe each unknown cell once at ``depth``, propagating after deductions.

    Returns None if no probe deduced anything, else the status and grid after
    the last deduction's propagation. With ``first_only``, returns right after
    the first deduction.
    """
    progressed = False
    for r, c in _probe_order(grid):
        if grid[r, c] != UNKNOWN:
            continue  # deduced earlier in this pass
        deduced = _probe_cell(ctx, grid, r, c, depth)
        if deduced is None:
            return Status.CONTRADICTION, grid
        changed = deduced != grid
        if not changed.any():
            continue
        progressed = True
        if count:
            ctx.counts[f"probe{depth}"] += int(changed.sum())
        rows, cols = np.nonzero(changed)
        dirty = [(ROW, int(i)) for i in set(rows.tolist())] + [
            (COL, int(j)) for j in set(cols.tolist())
        ]
        result = ctx.propagate(deduced, dirty, count)
        grid = result.grid
        if result.status is not Status.STALLED or first_only:
            return result.status, grid
    return (Status.STALLED, grid) if progressed else None


def _probe_cell(
    ctx: _Context, grid: np.ndarray, r: int, c: int, depth: int
) -> np.ndarray | None:
    """The grid with everything probing cell (r, c) proves, or None if both
    assumptions lead to a contradiction (the grid itself is contradictory)."""
    branches = []
    for value in (FILLED, EMPTY):
        ctx.check_deadline()
        trial = grid.copy()
        trial[r, c] = value
        result = ctx.propagate(trial, [(ROW, r), (COL, c)], count=False)
        status, branch = result.status, result.grid
        if status is Status.STALLED and depth == 2:
            status, branch = _probe_to_fixpoint(ctx, branch, count=False)
        branches.append(None if status is Status.CONTRADICTION else branch)

    filled, empty = branches
    if filled is None and empty is None:
        return None
    if filled is None:
        return empty
    if empty is None:
        return filled
    # Both branches survive: keep what they agree on.
    agreed = (filled == empty) & (filled != UNKNOWN)
    return np.where(agreed, filled, grid).astype(np.int8)


def _probe_order(grid: np.ndarray) -> list[tuple[int, int]]:
    """Unknown cells, those next to a known cell or the border first."""
    unknown = grid == UNKNOWN
    padded = np.pad(~unknown, 1, constant_values=True)
    near_known = (
        padded[:-2, 1:-1] | padded[2:, 1:-1] | padded[1:-1, :-2] | padded[1:-1, 2:]
    )
    cells = [(int(r), int(c)) for r, c in zip(*np.nonzero(unknown))]
    return sorted(cells, key=lambda rc: not near_known[rc])
