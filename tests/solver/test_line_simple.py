import numpy as np
import pytest
from hypothesis import given, settings

from line_reference import any_lines, arbitrary_lines, brute_force, parse, show, solvable_lines
from nonogram.solver.line import UNKNOWN, placement_bounds, solve_full, solve_simple


def check_against_brute_force(clue, line):
    before = line.copy()
    result = solve_simple(clue, line)
    reference = brute_force(clue, line.tolist())
    assert np.array_equal(line, before), "input line was modified"

    if reference is None:
        assert result is None
        return
    assert result is not None
    assert result.dtype == np.int8
    full, lefts, rights = reference
    for c in range(len(line)):
        if line[c] != UNKNOWN:
            assert result[c] == line[c], f"known cell {c} changed"
        elif result[c] != UNKNOWN:
            assert result[c] == full[c], f"cell {c}: simple={result[c]}, full={full[c]}"
    assert placement_bounds(clue, line.tolist()) == (lefts, rights)


@settings(max_examples=500)
@given(solvable_lines())
def test_matches_brute_force_on_solvable_lines(case):
    clue, line = case
    assert brute_force(clue, line.tolist()) is not None
    check_against_brute_force(clue, line)


@settings(max_examples=500)
@given(arbitrary_lines())
def test_matches_brute_force_on_arbitrary_lines(case):
    check_against_brute_force(*case)


@settings(max_examples=1000)
@given(any_lines)
def test_deductions_are_a_subset_of_full_solver(case):
    clue, line = case
    simple = solve_simple(clue, line)
    full = solve_full(clue, line)
    assert (simple is None) == (full is None)
    if simple is not None:
        deduced = simple != UNKNOWN
        assert np.array_equal(simple[deduced], full[deduced])


@pytest.mark.parametrize(
    ("clue", "line", "expected"),
    [
        ((8,), "..........", "..111111.."),
        ((10,), "..........", "1111111111"),
        ((), ".....", "00000"),
        ((), "", ""),
        ((3,), "..........", ".........."),
        ((1, 1, 1), ".....", "10101"),
        ((4, 3), "........", "11110111"),
        ((3, 2), "........", "..1....."),
        ((3,), "0.......0.", "0.......00"),
        ((2,), "...1......", "00.1.00000"),
        ((1,), "..1..", "00100"),
        ((2, 1), "0....", "01101"),
        ((1, 2), "....0", "10110"),
    ],
)
def test_known_deductions(clue, line, expected):
    assert show(solve_simple(clue, parse(line))) == expected


@pytest.mark.parametrize(
    ("clue", "line"),
    [
        ((6,), "....."),  # block longer than the line
        ((1, 1, 1), "...."),  # blocks plus gaps too long
        ((), "..1.."),  # filled cell in an empty line
        ((3,), "..0.."),  # no gap of 3 around the empty cell
        ((1,), "1.1"),  # two filled cells, one block of 1
        ((2,), "111.."),  # filled run longer than the block
        ((1, 1), "11..."),  # adjacent filled cells need one block of 2
        ((2, 1), "0..."),  # 2 + gap + 1 needs 4 cells after the empty one
        ((2,), "00000"),  # all empty
        ((1,), "0000"),
    ],
)
def test_contradiction(clue, line):
    assert solve_simple(clue, parse(line)) is None
