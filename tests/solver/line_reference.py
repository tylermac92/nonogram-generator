"""Brute-force line-solving reference and Hypothesis line strategies for tests."""

from itertools import combinations

import numpy as np
from hypothesis import strategies as st

from nonogram.clues import line_clue
from nonogram.solver.line import EMPTY, FILLED, UNKNOWN

MAX_LENGTH = 20


def parse(text: str) -> np.ndarray:
    """'.' unknown, '0' empty, '1' filled."""
    return np.array([{".": UNKNOWN, "0": EMPTY, "1": FILLED}[c] for c in text], dtype=np.int8)


def show(line: np.ndarray | None) -> str | None:
    if line is None:
        return None
    return "".join({UNKNOWN: ".", EMPTY: "0", FILLED: "1"}[int(c)] for c in line)


def placements(clue, n):
    """Every way to place the clue's blocks in a line of n cells, as block starts."""
    k = len(clue)
    slack = n - (sum(clue) + max(k - 1, 0))
    if slack < 0:
        return
    # Distribute slack among k+1 gaps: choose k positions in range(k + slack).
    for picks in combinations(range(k + slack), k):
        starts, pos = [], 0
        prev = -1
        for j, p in enumerate(picks):
            pos += p - prev - 1  # extra gap before this block
            starts.append(pos)
            pos += clue[j] + 1
            prev = p
        yield starts


def brute_force(clue, line):
    """Full deductions and block-start bounds by enumerating every placement.

    Returns (deduced line, lefts, rights), or None if nothing fits.
    """
    n = len(line)
    can_fill = [False] * n
    can_empty = [False] * n
    lefts = [n] * len(clue)
    rights = [-1] * len(clue)
    found = False
    for starts in placements(clue, n):
        cells = [EMPTY] * n
        for s, b in zip(starts, clue):
            cells[s : s + b] = [FILLED] * b
        if any(known != UNKNOWN and known != cell for known, cell in zip(line, cells)):
            continue
        found = True
        for c, cell in enumerate(cells):
            if cell == FILLED:
                can_fill[c] = True
            else:
                can_empty[c] = True
        lefts = [min(a, s) for a, s in zip(lefts, starts)]
        rights = [max(a, s) for a, s in zip(rights, starts)]
    if not found:
        return None
    deduced = np.array(
        [FILLED if f and not e else EMPTY if e and not f else UNKNOWN for f, e in zip(can_fill, can_empty)],
        dtype=np.int8,
    )
    return deduced, lefts, rights


@st.composite
def solvable_lines(draw):
    """A clue and a partial line consistent with at least one solution."""
    solution = draw(st.lists(st.booleans(), min_size=0, max_size=MAX_LENGTH))
    mask = draw(st.lists(st.booleans(), min_size=len(solution), max_size=len(solution)))
    line = [int(cell) if known else UNKNOWN for cell, known in zip(solution, mask)]
    return line_clue(solution), np.array(line, dtype=np.int8)


@st.composite
def arbitrary_lines(draw):
    """Any clue that fits the length, with any partial line: often contradictory."""
    n = draw(st.integers(0, MAX_LENGTH))
    clue = []
    remaining = n
    while remaining >= 1 and draw(st.booleans()):
        b = draw(st.integers(1, remaining))
        clue.append(b)
        remaining -= b + 1
    line = draw(st.lists(st.sampled_from([UNKNOWN, EMPTY, FILLED]), min_size=n, max_size=n))
    return tuple(clue), np.array(line, dtype=np.int8)


@st.composite
def oversized_lines(draw):
    """Clues drawn without regard to length, so some cannot fit even an empty line."""
    n = draw(st.integers(0, MAX_LENGTH))
    clue = draw(st.lists(st.integers(1, MAX_LENGTH + 1), max_size=6))
    line = draw(st.lists(st.sampled_from([UNKNOWN, EMPTY, FILLED]), min_size=n, max_size=n))
    return tuple(clue), np.array(line, dtype=np.int8)


any_lines = st.one_of(solvable_lines(), arbitrary_lines(), oversized_lines())
