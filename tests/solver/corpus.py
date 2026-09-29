"""Loader for the known-answer puzzle corpus in tests/corpus/puzzles.json."""

import json
from pathlib import Path

import numpy as np

CORPUS_PATH = Path(__file__).parents[1] / "corpus" / "puzzles.json"
PUZZLES: list[dict] = json.loads(CORPUS_PATH.read_text())["puzzles"]

RATINGS = ("easy", "medium", "hard", "expert")

# Probing depth each rating needs: 0 is line solving alone.
DEPTH = {"easy": 0, "medium": 0, "hard": 1, "expert": 2, None: None}


def solution_of(entry: dict) -> np.ndarray:
    return np.array([[c == "1" for c in row] for row in entry["solution"]], dtype=bool)


def select(rating: str | None = "any", solutions: int | str | None = None) -> list[dict]:
    """Entries with the given rating (None: logic can't finish) and solution count."""
    return [
        e
        for e in PUZZLES
        if (rating == "any" or e["rating"] == rating)
        and (solutions is None or e["solutions"] == solutions)
    ]


def rating_from(result) -> str | None:
    """The tier a SolveResult earns: the hardest technique it needed."""
    if result.status.value != "solved":
        return None
    if result.probe2_cells:
        return "expert"
    if result.probe1_cells:
        return "hard"
    if result.full_cells:
        return "medium"
    return "easy"


def ids(entries: list[dict]) -> list[str]:
    return [e["name"] for e in entries]
