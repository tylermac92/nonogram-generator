"""Clue derivation by run-length encoding, and clue validation."""

from collections.abc import Iterable, Sequence

import numpy as np

Clue = tuple[int, ...]


def line_clue(line: Iterable[bool]) -> Clue:
    """Run-length encode one line: the lengths of its filled runs, in order.

    An empty line gives ``()``.
    """
    runs: list[int] = []
    run = 0
    for cell in line:
        if cell:
            run += 1
        elif run:
            runs.append(run)
            run = 0
    if run:
        runs.append(run)
    return tuple(runs)


def derive_clues(solution: np.ndarray) -> tuple[tuple[Clue, ...], tuple[Clue, ...]]:
    """Derive ``(row_clues, col_clues)`` from a 2-D boolean solution grid."""
    grid = np.asarray(solution, dtype=bool)
    if grid.ndim != 2:
        raise ValueError(f"solution must be 2-D, got shape {grid.shape}")
    row_clues = tuple(line_clue(row) for row in grid)
    col_clues = tuple(line_clue(col) for col in grid.T)
    return row_clues, col_clues


def min_length(clue: Sequence[int]) -> int:
    """Shortest line that can hold ``clue``: the runs plus one gap between each."""
    return sum(clue) + max(len(clue) - 1, 0)


def clue_fits(clue: Sequence[int], length: int) -> bool:
    """Whether ``clue`` is well formed and fits in a line of ``length`` cells."""
    return all(type(n) is int and n >= 1 for n in clue) and min_length(clue) <= length
