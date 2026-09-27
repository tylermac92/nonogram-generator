import numpy as np
import pytest
from hypothesis import given, settings

from line_reference import any_lines, brute_force, parse, show
from nonogram.solver.line import solve_full


@settings(max_examples=10_000, deadline=None)
@given(any_lines)
def test_matches_brute_force(case):
    clue, line = case
    before = line.copy()
    result = solve_full(clue, line)
    reference = brute_force(clue, line.tolist())
    assert np.array_equal(line, before), "input line was modified"
    if reference is None:
        assert result is None
    else:
        assert result is not None
        assert result.dtype == np.int8
        assert show(result) == show(reference[0])


@pytest.mark.parametrize(
    ("clue", "line", "expected"),
    [
        ((8,), "..........", "..111111.."),
        ((), ".....", "00000"),
        ((), "", ""),
        ((1, 1, 1), ".....", "10101"),
        ((3,), "..........", ".........."),
        # The filled cell and the empty one pin the block of 3 to start at
        # 0 or 1, so cells 1 and 2 are filled and everything from 4 is empty.
        ((3,), ".1..0.....", ".11.000000"),
        # Only one placement agrees with both known cells.
        ((1, 2), "..1..1", "001011"),
        ((2, 2), "1.....1", "1100011"),
        # The 1 can only go after the empty cell; the 3 starts at 0 or 1.
        ((3, 1), "....0.", ".11.01"),
        ((2, 2), ".1.1.", "11011"),
    ],
)
def test_known_deductions(clue, line, expected):
    assert show(solve_full(clue, parse(line))) == expected


@pytest.mark.parametrize(
    ("clue", "line"),
    [
        # Clues that can't fit the line at all.
        ((6,), "....."),
        ((1, 1, 1), "...."),
        # Clues that fit the length but not the known cells.
        ((), "..1.."),
        ((3,), "..0.."),
        ((1,), "1.1"),
        ((2,), "111.."),
        ((1, 1), "11..."),
        ((2, 1), "0..."),
        ((1,), "0000"),
        ((1, 1), "1.0.1.0.1"),  # three separated filled cells, two blocks
        ((3, 3, 3), "...0.0..."),  # only two gaps can hold a block of 3
        ((2, 1), ".1.1.1"),  # three filled cells need three blocks
    ],
)
def test_contradiction(clue, line):
    assert solve_full(clue, parse(line)) is None
