"""Depth-first search for a second solution when logic stalls.

When logical solving stalls, the puzzle either has several solutions or needs
techniques beyond depth-2 probing. The search tells which, and finds the cells
that make it ambiguous. It tries the stall's unknown cells in turn, forcing
each to the opposite of its target value and running a depth-first search
with propagation for any solution that includes that choice. Any solution
found differs from the target, so it is a second solution, and the cells
where the two differ are the flip candidates. A forced value with no solution
at all proves the cell equals its target in every solution; the cell is set
and the next one is tried.

The search runs under a time budget. When it runs out, or when it proves the
target is the only solution, every unknown cell at the stall is a candidate.
"""

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import Enum

import numpy as np

from nonogram.clues import Clue, derive_clues
from nonogram.solver.line import FILLED, UNKNOWN, CachedLineSolver, LineSolver
from nonogram.solver.line import solve_full, solve_simple
from nonogram.solver.propagate import COL, ROW, Status, propagate

DEFAULT_SEARCH_BUDGET = 2.0  # seconds


class Outcome(Enum):
    FOUND = "found"  # a second solution exists
    UNIQUE = "unique"  # the search proved the target is the only solution
    TIMED_OUT = "timed_out"  # the budget ran out first


@dataclass(frozen=True)
class SearchResult:
    """Outcome of :func:`find_second_solution`.

    ``candidates`` is a ``bool`` mask of the cells to consider flipping: where
    the second solution differs from the target when one was found, and
    every unknown cell of the stalled grid otherwise.
    """

    outcome: Outcome
    candidates: np.ndarray
    second_solution: np.ndarray | None = None  # bool grid, when FOUND


class _TimedOut(Exception):
    pass


def find_second_solution(
    stalled: np.ndarray,
    target: np.ndarray,
    row_clues: Sequence[Clue],
    col_clues: Sequence[Clue],
    *,
    budget: float = DEFAULT_SEARCH_BUDGET,
    simple: LineSolver | None = None,
    full: LineSolver | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> SearchResult:
    """Look for a solution other than ``target``, starting from ``stalled``.

    ``stalled`` is the ``int8`` grid where logical solving stopped; its known
    cells must agree with ``target``, a ``bool`` solution of the clues.
    Neither is modified. ``budget`` caps the search's wall-clock seconds.
    """
    target = np.asarray(target, dtype=bool)
    stalled = np.asarray(stalled)
    if derive_clues(target) != (tuple(map(tuple, row_clues)), tuple(map(tuple, col_clues))):
        raise ValueError("target does not solve the clues")
    unknown = stalled == UNKNOWN
    if not np.array_equal(stalled[~unknown], target[~unknown].astype(stalled.dtype)):
        raise ValueError("stalled grid disagrees with the target")
    deadline = clock() + budget
    clues = (row_clues, col_clues)
    solvers = {
        # "is None", not "or": an empty CachedLineSolver is falsy (it has __len__).
        "simple": CachedLineSolver(solve_simple) if simple is None else simple,
        "full": CachedLineSolver(solve_full) if full is None else full,
    }

    def fallback(outcome: Outcome) -> SearchResult:
        return SearchResult(outcome, unknown.copy())

    def assign(grid: np.ndarray, r: int, c: int, value: int):
        if clock() > deadline:
            raise _TimedOut
        trial = grid.copy()
        trial[r, c] = value
        return propagate(trial, *clues, dirty=[(ROW, r), (COL, c)], **solvers)

    def complete(grid: np.ndarray) -> np.ndarray | None:
        """Any solution extending a stalled ``grid``, or None.

        Iterative, since branching can nest deeper than Python's recursion
        limit on large grids. Each frame holds a stalled grid, its branch
        cell, and the values still to try there: the target's value first,
        since it is known to fit the clues and so tends to reach a solution
        sooner.
        """
        stack = [_frame(grid, target)]
        while stack:
            node, r, c, values = stack[-1]
            if not values:
                stack.pop()
                continue
            result = assign(node, r, c, values.pop())
            if result.status is Status.SOLVED:
                return result.grid
            if result.status is Status.STALLED:
                stack.append(_frame(result.grid, target))
        return None

    grid = np.array(stalled, dtype=np.int8)
    try:
        for r, c in zip(*np.nonzero(unknown)):
            r, c = int(r), int(c)
            if grid[r, c] != UNKNOWN:
                continue  # proved equal to the target by an earlier refutation
            opposite = 1 - int(target[r, c])
            result = assign(grid, r, c, opposite)
            second = None
            if result.status is Status.SOLVED:
                second = result.grid
            elif result.status is Status.STALLED:
                second = complete(result.grid)
            if second is not None:
                second = second == FILLED
                return SearchResult(Outcome.FOUND, second != target, second)
            # No solution has the opposite value: fix the cell to its target.
            settled = assign(grid, r, c, 1 - opposite)
            if settled.status is Status.SOLVED:
                break
            grid = settled.grid
    except _TimedOut:
        return fallback(Outcome.TIMED_OUT)
    return fallback(Outcome.UNIQUE)


def _frame(grid: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, int, int, list[int]]:
    r, c = _branch_cell(grid)
    first = int(target[r, c])
    return grid, r, c, [1 - first, first]  # popped from the end: target value first


def _branch_cell(grid: np.ndarray) -> tuple[int, int]:
    """An unknown cell in the row or column with the fewest unknowns left."""
    unknown = grid == UNKNOWN
    per_row = np.where(unknown.any(axis=1), unknown.sum(axis=1), grid.shape[1] + 1)
    per_col = np.where(unknown.any(axis=0), unknown.sum(axis=0), grid.shape[0] + 1)
    if per_row.min() <= per_col.min():
        r = int(per_row.argmin())
        return r, int(np.flatnonzero(unknown[r])[0])
    c = int(per_col.argmin())
    return int(np.flatnonzero(unknown[:, c])[0]), c
