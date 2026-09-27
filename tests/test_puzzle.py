import json

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra.numpy import arrays

from nonogram.puzzle import Puzzle, PuzzleFormatError

GRID = np.array(
    [
        [0, 0, 1, 1, 1],
        [1, 0, 1, 0, 1],
        [0, 0, 0, 0, 0],
    ],
    dtype=bool,
)


def make_puzzle() -> Puzzle:
    return Puzzle.from_solution(
        GRID,
        rating="hard",
        stats={"flipped_cells": 2, "flipped_pct": 13.3, "solve_ms": 840},
        source={
            "image_sha256": "ab" * 32,
            "crop": [0, 0, 800, 600],
            "threshold": 0.47,
            "invert": False,
            "gamma": 1.0,
            "contrast": 1.0,
            "seed": 1234,
        },
    )


def valid_dict() -> dict:
    return make_puzzle().to_dict()


def write(tmp_path, data) -> str:
    path = tmp_path / "puzzle.json"
    path.write_text(json.dumps(data))
    return path


def test_from_solution_derives_clues():
    p = make_puzzle()
    assert (p.width, p.height) == (5, 3)
    assert p.row_clues == ((3,), (1, 1, 1), ())
    assert p.col_clues == ((1,), (), (2,), (1,), (2,))


def test_solution_is_read_only_copy():
    grid = GRID.copy()
    p = Puzzle.from_solution(grid)
    grid[0, 0] = True
    assert not p.solution[0, 0]
    with pytest.raises(ValueError):
        p.solution[0, 0] = True


def test_to_dict_matches_file_format():
    d = valid_dict()
    assert d["version"] == 1
    assert d["row_clues"] == [[3], [1, 1, 1], []]
    assert d["solution"] == ["00111", "10101", "00000"]


def test_save_and_load_round_trip(tmp_path):
    p = make_puzzle()
    path = tmp_path / "puzzle.json"
    p.save(path)
    loaded = Puzzle.load(path)
    assert loaded == p
    assert loaded.solution.dtype == bool
    loaded.save(tmp_path / "again.json")
    assert (tmp_path / "again.json").read_text() == path.read_text()


def test_round_trip_minimal_puzzle(tmp_path):
    p = Puzzle.from_solution(np.zeros((1, 1), dtype=bool))
    p.save(tmp_path / "p.json")
    assert Puzzle.load(tmp_path / "p.json") == p


@given(arrays(bool, st.tuples(st.integers(1, 12), st.integers(1, 12))))
def test_dict_round_trip_random_grids(grid):
    p = Puzzle.from_solution(grid)
    assert Puzzle.from_dict(json.loads(json.dumps(p.to_dict()))) == p


@pytest.mark.parametrize("shape", [(0, 0), (0, 5), (5,), (2, 2, 2)])
def test_rejects_bad_solution_shape(shape):
    with pytest.raises(PuzzleFormatError):
        Puzzle.from_solution(np.zeros(shape, dtype=bool))


def test_equality_detects_differences():
    p = make_puzzle()
    assert p != Puzzle.from_solution(GRID)
    flipped = GRID.copy()
    flipped[2, 0] = True
    assert p != Puzzle.from_solution(flipped, rating=p.rating, stats=p.stats, source=p.source)


@pytest.mark.parametrize("version", [0, 2, "1", 1.5, None, True])
def test_load_rejects_wrong_version(tmp_path, version):
    d = valid_dict()
    d["version"] = version
    with pytest.raises(PuzzleFormatError, match="version"):
        Puzzle.load(write(tmp_path, d))


def test_load_rejects_missing_version(tmp_path):
    d = valid_dict()
    del d["version"]
    with pytest.raises(PuzzleFormatError, match="version"):
        Puzzle.load(write(tmp_path, d))


@pytest.mark.parametrize(
    ("key", "index", "clue"),
    [
        ("row_clues", 0, [6]),  # longer than the 5-wide row
        ("row_clues", 1, [2, 1, 1]),  # 2+1+1 plus two gaps = 6 > 5
        ("col_clues", 2, [4]),  # longer than the 3-tall column
        ("col_clues", 0, [1, 1, 1]),  # needs 5 cells, has 3
        ("row_clues", 2, [0]),
        ("row_clues", 2, [-1]),
    ],
)
def test_load_rejects_clues_that_cannot_fit(tmp_path, key, index, clue):
    d = valid_dict()
    d[key][index] = clue
    with pytest.raises(PuzzleFormatError, match="does not fit"):
        Puzzle.load(write(tmp_path, d))


def test_load_rejects_clues_inconsistent_with_solution(tmp_path):
    d = valid_dict()
    d["row_clues"][2] = [1]
    with pytest.raises(PuzzleFormatError, match="do not match"):
        Puzzle.load(write(tmp_path, d))


def test_load_rejects_wrong_clue_count(tmp_path):
    d = valid_dict()
    d["col_clues"].append([])
    with pytest.raises(PuzzleFormatError, match="expected 5 column clues"):
        Puzzle.load(write(tmp_path, d))


@pytest.mark.parametrize(
    "solution",
    [["00111", "10101"], ["0011", "10101", "00000"], ["00111", "10101", "0000x"], "00111"],
)
def test_load_rejects_malformed_solution(tmp_path, solution):
    d = valid_dict()
    d["solution"] = solution
    with pytest.raises(PuzzleFormatError, match="solution"):
        Puzzle.load(write(tmp_path, d))


def test_load_rejects_invalid_json(tmp_path):
    path = tmp_path / "puzzle.json"
    path.write_text("{not json")
    with pytest.raises(PuzzleFormatError, match="invalid JSON"):
        Puzzle.load(path)


def test_load_rejects_non_object(tmp_path):
    with pytest.raises(PuzzleFormatError):
        Puzzle.load(write(tmp_path, [1, 2, 3]))
