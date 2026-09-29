"""Generation loop: flip-cost scoring, seeded tie-breaking, and fix-up."""

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FlipWeights:
    """Weights for the flip cost; see ``flip_costs``.

    ``alpha`` scales source ambiguity, ``beta`` neighborhood fit, and
    ``epsilon`` the random tie-break. Each must be a finite number >= 0.
    """

    alpha: float = 1.0
    beta: float = 0.5
    epsilon: float = 0.01

    def __post_init__(self) -> None:
        for name in ("alpha", "beta", "epsilon"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be a number, got {value!r}")
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite number >= 0, got {value!r}")


def flip_costs(
    brightness: np.ndarray,
    solution: np.ndarray,
    threshold: float,
    rng: np.random.Generator | int | None = None,
    weights: FlipWeights = FlipWeights(),
) -> np.ndarray:
    """The cost of flipping each cell of ``solution``; lower is flipped first.

    For each cell *c*::

        cost(c) = alpha * |p_c - t| + beta * (1 - n_c / 8) + epsilon * u_c

    where *p* is the cell's brightness, *t* the threshold, *n* the number of
    8-neighbors that would match the cell's color after the flip (cells off
    the grid count as empty), and *u* a uniform draw in [0, 1) from ``rng``.

    The first term makes cells that were nearly the other color cheap. The
    second makes a flip that smooths an edge cheap and one that leaves an
    isolated speck expensive. The third breaks ties: the same seed gives the
    same costs, and a new seed (Regenerate) can pick different cells.

    ``rng`` is a NumPy ``Generator`` (advanced by one draw per cell, so a
    generation loop can share one across iterations) or a seed for a new one.
    Returns a float array shaped like ``solution``.
    """
    values = np.asarray(brightness, dtype=np.float64)
    filled = np.asarray(solution)
    if values.ndim != 2 or values.size == 0 or not np.isfinite(values).all():
        raise ValueError("brightness must be a non-empty 2-D array of finite values")
    if filled.shape != values.shape:
        raise ValueError(
            f"solution shape {filled.shape} doesn't match brightness shape {values.shape}"
        )
    if filled.dtype != bool:
        if not np.isin(filled, (0, 1)).all():
            raise ValueError("solution must contain only 0/1 or booleans")
        filled = filled.astype(bool)
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not 0 <= threshold <= 1
    ):
        raise ValueError(f"threshold must be a number from 0 to 1, got {threshold!r}")

    filled_neighbors = _filled_neighbors(filled)
    # After a flip the cell takes the opposite color: an empty cell becomes
    # filled and matches its filled neighbors, and vice versa.
    matching = np.where(filled, 8 - filled_neighbors, filled_neighbors)
    noise = np.random.default_rng(rng).random(values.shape)
    return (
        weights.alpha * np.abs(values - threshold)
        + weights.beta * (1.0 - matching / 8.0)
        + weights.epsilon * noise
    )


def _filled_neighbors(filled: np.ndarray) -> np.ndarray:
    """How many of each cell's 8 neighbors are filled; off-grid counts as empty."""
    rows, cols = filled.shape
    padded = np.pad(filled.astype(np.int8), 1)
    total = np.zeros((rows, cols), dtype=np.int8)
    for dr in (0, 1, 2):
        for dc in (0, 1, 2):
            if (dr, dc) != (1, 1):
                total += padded[dr : dr + rows, dc : dc + cols]
    return total
