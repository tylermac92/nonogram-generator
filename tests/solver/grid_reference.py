"""Brute-force solution counting for small grids, independent of the solver."""

from itertools import product

from nonogram.clues import line_clue


def count_solutions(row_clues, col_clues, limit: int = 2) -> int:
    """Number of grids matching the clues, counting no further than ``limit``.

    Tries every row pattern that matches its clue, row by row, pruning when a
    column's runs so far can no longer extend to its clue. Practical for
    widths up to about 10.
    """
    height, width = len(row_clues), len(col_clues)
    patterns = [
        [bits for bits in product((0, 1), repeat=width) if line_clue(bits) == clue]
        for clue in row_clues
    ]
    rows: list[tuple[int, ...]] = []
    count = 0

    def columns_ok() -> bool:
        done = len(rows) == height
        for c in range(width):
            column = [row[c] for row in rows]
            runs = line_clue(column)
            clue = col_clues[c]
            if done:
                if runs != tuple(clue):
                    return False
                continue
            if len(runs) > len(clue):
                return False
            # Closed runs must match exactly; a run still open at the bottom
            # may only grow.
            open_run = bool(column) and column[-1] == 1
            for i, run in enumerate(runs):
                if i == len(runs) - 1 and open_run:
                    if run > clue[i]:
                        return False
                elif run != clue[i]:
                    return False
        return True

    def extend() -> None:
        nonlocal count
        if count >= limit:
            return
        if len(rows) == height:
            count += 1
            return
        for pattern in patterns[len(rows)]:
            rows.append(pattern)
            if columns_ok():
                extend()
            rows.pop()

    extend()
    return count
