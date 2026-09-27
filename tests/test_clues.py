import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st

from nonogram.clues import clue_fits, derive_clues, line_clue


@pytest.mark.parametrize(
    ("line", "clue"),
    [
        ([1, 1, 1, 1, 1], (5,)),
        ([0, 0, 0, 0, 0], ()),
        ([], ()),
        ([1, 0, 1, 0, 1], (1, 1, 1)),
        ([0, 1, 0, 1, 0, 1], (1, 1, 1)),
        ([1, 1, 0, 0, 1, 1, 1, 0], (2, 3)),
        ([0, 0, 1, 1, 1], (3,)),
    ],
    ids=["full", "empty", "zero-length", "alternating", "alternating-offset", "mixed", "trailing"],
)
def test_line_clue(line, clue):
    assert line_clue([bool(c) for c in line]) == clue


def test_derive_clues():
    grid = np.array(
        [
            [1, 1, 1],
            [0, 0, 0],
            [1, 0, 1],
        ],
        dtype=bool,
    )
    rows, cols = derive_clues(grid)
    assert rows == ((3,), (), (1, 1))
    assert cols == ((1, 1), (1,), (1, 1))


def test_derive_clues_rejects_non_2d():
    with pytest.raises(ValueError):
        derive_clues(np.zeros(4, dtype=bool))


@given(st.lists(st.booleans(), max_size=40))
def test_line_clue_matches_line(line):
    clue = line_clue(line)
    assert sum(clue) == sum(line)
    assert all(n >= 1 for n in clue)
    assert clue_fits(clue, len(line))


@pytest.mark.parametrize(
    ("clue", "length", "fits"),
    [
        ((), 0, True),
        ((5,), 5, True),
        ((5,), 4, False),
        ((1, 1, 1), 5, True),
        ((1, 1, 1), 4, False),
        ((2, 3), 6, True),
        ((0,), 5, False),
        ((-1,), 5, False),
        ((1.0,), 5, False),
        ((True,), 5, False),
    ],
)
def test_clue_fits(clue, length, fits):
    assert clue_fits(clue, length) is fits
