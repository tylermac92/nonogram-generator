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


def solve_full(clue: Sequence[int], line: np.ndarray) -> np.ndarray | None:
    """Deduce every cell that takes the same value in all valid placements.

    A forward pass finds which prefixes of the line can hold the first *j*
    blocks, and a backward pass which suffixes can hold blocks *j* onward.
    Combined, they tell for each cell whether some placement fills it and
    whether some leaves it empty. O(n * k) using prefix counts of empty cells.
    Returns ``None`` when no valid placement exists.
    """
    cells = line.tolist()
    n = len(cells)
    k = len(clue)

    # empties[i]: count of EMPTY cells in cells[:i].
    empties = [0] * (n + 1)
    for i, cell in enumerate(cells):
        empties[i + 1] = empties[i] + (cell == EMPTY)

    # fwd[j][i]: cells[:i] can hold exactly blocks 0..j-1.
    fwd = [[False] * (n + 1) for _ in range(k + 1)]
    fwd[0][0] = True
    for i in range(1, n + 1):
        fwd[0][i] = fwd[0][i - 1] and cells[i - 1] != FILLED
    for j in range(1, k + 1):
        b = clue[j - 1]
        row, prev = fwd[j], fwd[j - 1]
        for i in range(1, n + 1):
            if cells[i - 1] != FILLED and row[i - 1]:
                row[i] = True  # cell i-1 is empty
            elif i >= b and empties[i] == empties[i - b]:  # block j-1 ends at i
                s = i - b
                row[i] = prev[0] if s == 0 else cells[s - 1] != FILLED and prev[s - 1]

    if not fwd[k][n]:
        return None

    # bwd[j][i]: cells[i:] can hold exactly blocks j..k-1.
    bwd = [[False] * (n + 1) for _ in range(k + 1)]
    bwd[k][n] = True
    for i in range(n - 1, -1, -1):
        bwd[k][i] = bwd[k][i + 1] and cells[i] != FILLED
    for j in range(k - 1, -1, -1):
        b = clue[j]
        row, nxt = bwd[j], bwd[j + 1]
        for i in range(n - 1, -1, -1):
            if cells[i] != FILLED and row[i + 1]:
                row[i] = True  # cell i is empty
            elif i + b <= n and empties[i + b] == empties[i]:  # block j starts at i
                end = i + b
                row[i] = nxt[n] if end == n else cells[end] != FILLED and nxt[end + 1]

    # A cell can be empty if some split puts blocks 0..j-1 left of it and j..
    # right of it. It can be filled if some block covers it in a placement
    # that both passes accept; coverage is accumulated in a difference array.
    can_empty = [
        cells[c] != FILLED and any(fwd[j][c] and bwd[j][c + 1] for j in range(k + 1))
        for c in range(n)
    ]
    coverage = [0] * (n + 1)
    for j, b in enumerate(clue):
        for s in range(n - b + 1):
            end = s + b
            if (
                empties[end] == empties[s]
                and (fwd[j][0] if s == 0 else cells[s - 1] != FILLED and fwd[j][s - 1])
                and (bwd[j + 1][n] if end == n else cells[end] != FILLED and bwd[j + 1][end + 1])
            ):
                coverage[s] += 1
                coverage[end] -= 1

    result = list(cells)
    covered = 0
    for c in range(n):
        covered += coverage[c]
        if covered and not can_empty[c]:
            result[c] = FILLED
        elif can_empty[c] and not covered:
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
