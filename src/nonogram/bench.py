"""Benchmark harness: solve fixed test grids and report time, cache hit
rates, and the technique trace.

The image pipeline doesn't exist yet, so the grids are generated from fixed
seeds rather than loaded from test images:

- ``blobs``: smoothed random noise thresholded at its median, standing in
  for a thresholded photo.
- ``shapes``: concentric rings and bars, standing in for a logo or icon.
- ``detail``: lightly smoothed noise, standing in for a busy photo.
- ``noise``: uniform random cells, the worst case for the solver.
"""

import time
from collections.abc import Callable
from dataclasses import asdict, dataclass

import numpy as np

from nonogram.clues import derive_clues
from nonogram.solver.line import UNKNOWN, CachedLineSolver, solve_full, solve_simple
from nonogram.solver.probe import DEFAULT_DEPTH2_BUDGET, solve

SIZES = (15, 30, 50, 80)
SEED = 20260929


def blobs(size: int, seed: int = SEED, radius: int | None = None) -> np.ndarray:
    """Smoothed noise thresholded at its median: large irregular regions."""
    field = np.random.default_rng(seed).random((size, size))
    radius = radius or max(1, size // 15)
    for _ in range(3):  # repeated box blur approximates a Gaussian
        padded = np.pad(field, radius, mode="reflect")
        cumulative = padded.cumsum(axis=0).cumsum(axis=1)
        cumulative = np.pad(cumulative, ((1, 0), (1, 0)))
        k = 2 * radius + 1
        field = (
            cumulative[k:, k:] - cumulative[:-k, k:] - cumulative[k:, :-k] + cumulative[:-k, :-k]
        ) / (k * k)
    return field < np.median(field)


def detail(size: int, seed: int = SEED) -> np.ndarray:
    """Lightly smoothed noise: many small features, like a busy photo."""
    return blobs(size, seed, radius=1)


def shapes(size: int, seed: int = SEED) -> np.ndarray:
    """Concentric rings with a bar through them: a logo-like picture."""
    y, x = np.mgrid[0:size, 0:size] + 0.5
    r = np.hypot(x - size / 2, y - size / 2) / size
    rings = (np.floor(r * 10) % 2 == 0) & (r < 0.45)
    bar = np.abs(y - size * 0.7) < size * 0.06
    return rings ^ bar


def noise(size: int, seed: int = SEED) -> np.ndarray:
    """Uniform random cells at 50% density: the solver's worst case."""
    return np.random.default_rng(seed).random((size, size)) < 0.5


GRIDS: dict[str, Callable[[int], np.ndarray]] = {
    "blobs": blobs,
    "shapes": shapes,
    "detail": detail,
    "noise": noise,
}


@dataclass(frozen=True)
class BenchResult:
    grid: str
    size: int
    max_depth: int
    status: str
    rating: str | None
    seconds: float
    unknown_cells: int
    simple_cells: int
    full_cells: int
    probe1_cells: int
    probe2_cells: int
    depth2_timed_out: bool
    simple_hit_rate: float
    full_hit_rate: float

    def as_dict(self) -> dict:
        return asdict(self)


def rating(result) -> str | None:
    """The tier a solved puzzle earns from the hardest technique it needed."""
    if result.status.value != "solved":
        return None
    if result.probe2_cells:
        return "expert"
    if result.probe1_cells:
        return "hard"
    if result.full_cells:
        return "medium"
    return "easy"


COLUMNS = (
    ("grid", "grid", "{}"),
    ("size", "size", "{0}x{0}"),
    ("status", "status", "{}"),
    ("rating", "rating", "{}"),
    ("seconds", "time (s)", "{:.2f}"),
    ("unknown_cells", "unknown", "{}"),
    ("simple_cells", "simple", "{}"),
    ("full_cells", "full", "{}"),
    ("probe1_cells", "probe1", "{}"),
    ("probe2_cells", "probe2", "{}"),
    ("depth2_timed_out", "d2 timeout", "{}"),
    ("simple_hit_rate", "simple hit", "{:.0%}"),
    ("full_hit_rate", "full hit", "{:.0%}"),
)


def format_table(results: list[BenchResult]) -> str:
    """A plain-text table, one row per result; technique columns count cells."""
    header = [title for _, title, _ in COLUMNS]
    rows = [
        [
            "-" if (value := getattr(r, key)) is None else fmt.format(value)
            for key, _, fmt in COLUMNS
        ]
        for r in results
    ]
    widths = [max(len(cell) for cell in column) for column in zip(header, *rows)]
    lines = ["  ".join(cell.rjust(w) for cell, w in zip(line, widths)) for line in [header, *rows]]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)


def run_one(
    grid: str, size: int, max_depth: int = 2, depth2_budget: float = DEFAULT_DEPTH2_BUDGET
) -> BenchResult:
    """Solve one fixed grid from blank with fresh caches and time it."""
    solution = GRIDS[grid](size)
    rows, cols = derive_clues(solution)
    simple, full = CachedLineSolver(solve_simple), CachedLineSolver(solve_full)
    start = np.full(solution.shape, UNKNOWN, dtype=np.int8)
    began = time.perf_counter()
    result = solve(
        start, rows, cols, max_depth=max_depth, depth2_budget=depth2_budget,
        simple=simple, full=full,
    )
    seconds = time.perf_counter() - began
    known = result.grid != UNKNOWN
    if not np.array_equal(result.grid[known], solution[known].astype(np.int8)):
        raise AssertionError(f"unsound deduction on {grid} {size}x{size}")
    return BenchResult(
        grid=grid,
        size=size,
        max_depth=max_depth,
        status=result.status.value,
        rating=rating(result),
        seconds=round(seconds, 3),
        unknown_cells=int((~known).sum()),
        simple_cells=result.simple_cells,
        full_cells=result.full_cells,
        probe1_cells=result.probe1_cells,
        probe2_cells=result.probe2_cells,
        depth2_timed_out=result.timed_out,
        simple_hit_rate=round(simple.hit_rate, 3),
        full_hit_rate=round(full.hit_rate, 3),
    )
