"""Simple and DP line solvers, with a memoizing cache.

A line is a 1-D ``int8`` array whose cells are ``UNKNOWN`` (-1), ``EMPTY`` (0),
or ``FILLED`` (1). A line solver takes a clue and a line and returns a new line
with every cell it could deduce filled in, or ``None`` if no placement of the
clue's blocks agrees with the line's known cells (a contradiction). Solvers
never modify their input.
"""

from collections.abc import Sequence

import numpy as np

UNKNOWN = -1
EMPTY = 0
FILLED = 1


def solve_simple(clue: Sequence[int], line: np.ndarray) -> np.ndarray | None:
    """Deduce cells from the overlap of the leftmost and rightmost placements.

    Each block's start is bounded by its position in the leftmost valid
    placement and in the rightmost one. Cells a block covers at both bounds
    are filled; cells no block can reach are empty. Returns ``None`` when no
    valid placement exists.
    """
    cells = line.tolist()
    n = len(cells)
    bounds = placement_bounds(clue, cells)
    if bounds is None:
        return None
    lefts, rights = bounds

    result = list(cells)
    reachable = [False] * n
    for b, left, right in zip(clue, lefts, rights):
        for c in range(right, left + b):
            result[c] = FILLED
        for c in range(left, right + b):
            reachable[c] = True
    for c in range(n):
        if not reachable[c]:
            result[c] = EMPTY
    return np.array(result, dtype=np.int8)


def placement_bounds(
    clue: Sequence[int], cells: Sequence[int]
) -> tuple[list[int], list[int]] | None:
    """Leftmost and rightmost start of each block over all valid placements.

    Returns ``(lefts, rights)``, or ``None`` if the clue cannot be placed.
    """
    lefts = _leftmost(clue, cells)
    if lefts is None:
        return None
    n = len(cells)
    reversed_starts = _leftmost(clue[::-1], cells[::-1])
    assert reversed_starts is not None  # a placement exists, so its mirror does too
    rights = [n - s - b for s, b in zip(reversed_starts[::-1], clue)]
    return lefts, rights


def _leftmost(clue: Sequence[int], cells: Sequence[int]) -> list[int] | None:
    """Start of each block in the leftmost valid placement, or ``None``."""
    n = len(cells)
    k = len(clue)

    # empties[i] / filleds[i]: count of EMPTY / FILLED cells in cells[:i].
    empties = [0] * (n + 1)
    filleds = [0] * (n + 1)
    for i, cell in enumerate(cells):
        empties[i + 1] = empties[i] + (cell == EMPTY)
        filleds[i + 1] = filleds[i] + (cell == FILLED)

    def block_fits(b: int, s: int) -> bool:
        # Block covers no EMPTY cell and is not directly followed by a FILLED one.
        end = s + b
        return (
            end <= n
            and empties[end] == empties[s]
            and (end == n or cells[end] != FILLED)
        )

    def after(b: int, s: int) -> int:
        return min(s + b + 1, n)

    # feasible[j][i]: blocks j.. can be placed in cells[i:], leaving no FILLED
    # cell uncovered. Filled right to left, one block at a time.
    feasible = [[False] * (n + 1) for _ in range(k + 1)]
    for i in range(n + 1):
        feasible[k][i] = filleds[n] == filleds[i]
    for j in range(k - 1, -1, -1):
        b = clue[j]
        row, next_row = feasible[j], feasible[j + 1]
        for i in range(n - 1, -1, -1):
            row[i] = (block_fits(b, i) and next_row[after(b, i)]) or (
                cells[i] != FILLED and row[i + 1]
            )

    if not feasible[0][0]:
        return None

    # Greedily take the earliest start that keeps the rest feasible. Since
    # feasible[j][pos] holds, the scan finds one before passing a FILLED cell.
    starts = []
    pos = 0
    for j, b in enumerate(clue):
        s = pos
        while not (block_fits(b, s) and feasible[j + 1][after(b, s)]):
            s += 1
        starts.append(s)
        pos = after(b, s)
    return starts
