"""Puzzle dataclass with JSON load and save."""

import json
from dataclasses import dataclass, field
from os import PathLike
from typing import Any

import numpy as np

from nonogram.clues import Clue, clue_fits, derive_clues

FORMAT_VERSION = 1


class PuzzleFormatError(ValueError):
    """A puzzle file or puzzle value is malformed or inconsistent."""


@dataclass(frozen=True, eq=False)
class Puzzle:
    """A nonogram: its solution, the clues derived from it, and generation metadata.

    ``solution`` is a read-only ``bool`` array of shape (height, width).
    ``stats`` and ``source`` hold JSON-compatible values and round-trip through
    the puzzle file unchanged.
    """

    solution: np.ndarray
    row_clues: tuple[Clue, ...]
    col_clues: tuple[Clue, ...]
    rating: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)
    source: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        solution = _as_grid(self.solution)
        object.__setattr__(self, "solution", solution)
        object.__setattr__(self, "row_clues", tuple(tuple(c) for c in self.row_clues))
        object.__setattr__(self, "col_clues", tuple(tuple(c) for c in self.col_clues))
        self._validate_clues()

    def _validate_clues(self) -> None:
        for axis, clues, count, length in (
            ("row", self.row_clues, self.height, self.width),
            ("column", self.col_clues, self.width, self.height),
        ):
            if len(clues) != count:
                raise PuzzleFormatError(f"expected {count} {axis} clues, got {len(clues)}")
            for i, clue in enumerate(clues):
                if not clue_fits(clue, length):
                    raise PuzzleFormatError(
                        f"{axis} {i} clue {list(clue)} does not fit a line of {length}"
                    )
        if (self.row_clues, self.col_clues) != derive_clues(self.solution):
            raise PuzzleFormatError("clues do not match the solution")

    @classmethod
    def from_solution(cls, solution: np.ndarray, **kwargs: Any) -> "Puzzle":
        """Build a puzzle whose clues are derived from ``solution``."""
        solution = _as_grid(solution)
        row_clues, col_clues = derive_clues(solution)
        return cls(solution=solution, row_clues=row_clues, col_clues=col_clues, **kwargs)

    @property
    def height(self) -> int:
        return self.solution.shape[0]

    @property
    def width(self) -> int:
        return self.solution.shape[1]

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Puzzle):
            return NotImplemented
        return (
            np.array_equal(self.solution, other.solution)
            and self.row_clues == other.row_clues
            and self.col_clues == other.col_clues
            and self.rating == other.rating
            and self.stats == other.stats
            and self.source == other.source
        )

    __hash__ = None  # type: ignore[assignment]

    def to_dict(self) -> dict[str, Any]:
        """The puzzle file's JSON structure."""
        return {
            "version": FORMAT_VERSION,
            "width": self.width,
            "height": self.height,
            "row_clues": [list(c) for c in self.row_clues],
            "col_clues": [list(c) for c in self.col_clues],
            "solution": ["".join("1" if cell else "0" for cell in row) for row in self.solution],
            "rating": self.rating,
            "stats": self.stats,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: Any) -> "Puzzle":
        """Parse and validate the structure produced by :meth:`to_dict`."""
        if not isinstance(data, dict):
            raise PuzzleFormatError("puzzle must be a JSON object")
        version = data.get("version")
        if version != FORMAT_VERSION or type(version) is not int:
            raise PuzzleFormatError(
                f"unsupported puzzle version {version!r}; expected {FORMAT_VERSION}"
            )

        width = _require(data, "width", int)
        height = _require(data, "height", int)
        if width < 1 or height < 1:
            raise PuzzleFormatError(f"invalid grid size {width}x{height}")

        rows = _require(data, "solution", list)
        if len(rows) != height or any(
            not isinstance(row, str) or len(row) != width or set(row) - {"0", "1"}
            for row in rows
        ):
            raise PuzzleFormatError(f"solution must be {height} strings of {width} '0'/'1' cells")
        solution = np.array([[ch == "1" for ch in row] for row in rows], dtype=bool)

        rating = data.get("rating")
        if rating is not None and not isinstance(rating, str):
            raise PuzzleFormatError("'rating' must be a string or null")

        return cls(
            solution=solution,
            row_clues=_parse_clues(data, "row_clues"),
            col_clues=_parse_clues(data, "col_clues"),
            rating=rating,
            stats=_require(data, "stats", dict, default={}),
            source=_require(data, "source", dict, default={}),
        )

    def save(self, path: str | PathLike[str]) -> None:
        """Write the puzzle as JSON."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)
            f.write("\n")

    @classmethod
    def load(cls, path: str | PathLike[str]) -> "Puzzle":
        """Read and validate a puzzle JSON file."""
        with open(path, encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                raise PuzzleFormatError(f"invalid JSON: {e}") from e
        return cls.from_dict(data)


def _as_grid(solution: Any) -> np.ndarray:
    """A read-only boolean copy of ``solution``, which must be a non-empty 2-D grid."""
    grid = np.array(solution, dtype=bool)
    if grid.ndim != 2 or grid.size == 0:
        raise PuzzleFormatError(f"solution must be a non-empty 2-D grid, got shape {grid.shape}")
    grid.flags.writeable = False
    return grid


_MISSING = object()


def _require(data: dict[str, Any], key: str, kind: type, default: Any = _MISSING) -> Any:
    if key not in data and default is not _MISSING:
        return default
    value = data.get(key)
    # bool is a subclass of int, but true/false is never a valid size or clue.
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        raise PuzzleFormatError(f"{key!r} must be a {kind.__name__}")
    return value


def _parse_clues(data: dict[str, Any], key: str) -> tuple[Clue, ...]:
    clues = _require(data, key, list)
    if not all(isinstance(c, list) for c in clues):
        raise PuzzleFormatError(f"{key!r} must be a list of lists")
    # Element types and fit are checked by Puzzle._validate_clues.
    return tuple(tuple(c) for c in clues)
