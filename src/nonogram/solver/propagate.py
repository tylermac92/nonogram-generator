"""Dirty-line work queue that propagates deductions to a fixpoint."""

from collections import deque
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import Enum

import numpy as np

from nonogram.clues import Clue
from nonogram.solver.line import UNKNOWN, LineSolver, solve_full, solve_simple

ROW = 0
COL = 1

Line = tuple[int, int]  # (ROW or COL, index)


class Status(Enum):
    SOLVED = "solved"  # every cell is known
    STALLED = "stalled"  # fixpoint with unknown cells left
    CONTRADICTION = "contradiction"  # some line has no valid placement


@dataclass(frozen=True)
class PropagationResult:
    """Outcome of :func:`propagate`.

    ``grid`` is the state propagation reached; after a contradiction it holds
    the deductions made before the contradiction was found, which are
    meaningless. ``simple_cells`` and ``full_cells`` count the cells each
    line solver deduced.
    """

    status: Status
    grid: np.ndarray
    simple_cells: int
    full_cells: int


def propagate(
    grid: np.ndarray,
    row_clues: Sequence[Clue],
    col_clues: Sequence[Clue],
    *,
    dirty: Iterable[Line] | None = None,
    simple: LineSolver = solve_simple,
    full: LineSolver = solve_full,
) -> PropagationResult:
    """Apply line solvers until no line yields another deduction.

    A queue holds dirty lines, starting with ``dirty`` (every line by
    default). Each pop runs the ``simple`` solver, and every newly set cell
    marks its crossing line dirty. When the queue empties, the ``full``
    solver runs on unfinished lines whose state it hasn't seen; its first
    deduction sends control back to the queue. Stops when the grid is solved,
    a line has a contradiction, or the full solver finds nothing new.

    ``grid`` is an ``int8`` array of UNKNOWN, EMPTY, and FILLED cells and is
    not modified. Every line is checked against its clue at least once when
    ``dirty`` is None. Pass ``CachedLineSolver`` instances as ``simple`` and
    ``full`` to reuse line results across calls.
    """
    grid = np.array(grid, dtype=np.int8)
    height, width = grid.shape
    if len(row_clues) != height or len(col_clues) != width:
        raise ValueError(
            f"{len(row_clues)}x{len(col_clues)} clues for a {height}x{width} grid"
        )
    clues = (row_clues, col_clues)

    def view(line: Line) -> np.ndarray:
        axis, i = line
        return grid[i, :] if axis == ROW else grid[:, i]

    if dirty is None:
        dirty = [(ROW, r) for r in range(height)] + [(COL, c) for c in range(width)]
    queue: deque[Line] = deque()
    queued: set[Line] = set()
    for line in dirty:
        if line not in queued:
            queue.append(line)
            queued.add(line)

    # Lines whose current state the full solver has already exhausted.
    full_clean: set[Line] = set()
    counts = {"simple": 0, "full": 0}

    def apply(line: Line, result: np.ndarray, technique: str) -> bool:
        """Write a solver's result into the grid; queue crossing lines."""
        state = view(line)
        changed = np.flatnonzero(result != state)
        if changed.size == 0:
            return False
        state[changed] = result[changed]
        counts[technique] += int(changed.size)
        full_clean.discard(line)
        cross = COL if line[0] == ROW else ROW
        for j in changed.tolist():
            crossing = (cross, j)
            full_clean.discard(crossing)
            if crossing not in queued:
                queue.append(crossing)
                queued.add(crossing)
        return True

    def finish(status: Status) -> PropagationResult:
        return PropagationResult(status, grid, counts["simple"], counts["full"])

    while True:
        while queue:
            line = queue.popleft()
            queued.discard(line)
            result = simple(clues[line[0]][line[1]], view(line))
            if result is None:
                return finish(Status.CONTRADICTION)
            apply(line, result, "simple")

        if not (grid == UNKNOWN).any():
            return finish(Status.SOLVED)

        progressed = False
        for line in _unfinished_lines(grid):
            if line in full_clean:
                continue
            result = full(clues[line[0]][line[1]], view(line))
            if result is None:
                return finish(Status.CONTRADICTION)
            progressed = apply(line, result, "full")
            full_clean.add(line)
            if progressed:
                break
        if not progressed:
            return finish(Status.STALLED)


def _unfinished_lines(grid: np.ndarray) -> list[Line]:
    unknown = grid == UNKNOWN
    return [(ROW, int(r)) for r in np.flatnonzero(unknown.any(axis=1))] + [
        (COL, int(c)) for c in np.flatnonzero(unknown.any(axis=0))
    ]
