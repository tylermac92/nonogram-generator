# Solver benchmark results

## 2026-09-29: first measurement (pure Python)

**Command:** `nonogram bench --json benchmarks/results/2026-09-29.json` (defaults: probing up to depth 2, 10 s depth-2 budget, fresh line-solver caches per grid).
**Machine:** Intel Xeon @ 2.10 GHz, 4 CPUs; Python 3.11.15, NumPy 2.4.6. The whole run took 57 s.

The image pipeline doesn't exist yet, so the benchmark uses fixed, seeded grids instead of test images:

| Grid | Stands in for | How it's made |
| --- | --- | --- |
| blobs | a thresholded photo with large regions | noise, box-blurred with radius size/15, thresholded at the median |
| shapes | a logo or icon | concentric rings crossed by a bar |
| detail | a busy photo | noise, box-blurred with radius 1, thresholded at the median |
| noise | the worst case | 50% random cells |

Each row is one solve from a blank grid. The technique columns count the cells each technique deduced. The hit-rate columns show the simple and full line-solver caches.

```
  grid   size   status  rating  time (s)  unknown  simple  full  probe1  probe2  d2 timeout  simple hit  full hit
------  -----  -------  ------  --------  -------  ------  ----  ------  ------  ----------  ----------  --------
 blobs  15x15   solved    easy      0.00        0     225     0       0       0       False          5%        0%
shapes  15x15  stalled       -      3.30       72      87     0      60       6       False         99%       99%
detail  15x15   solved    easy      0.00        0     225     0       0       0       False          5%        0%
 noise  15x15  stalled       -      0.01        4     221     0       0       0       False         24%        0%
 blobs  30x30   solved    easy      0.01        0     900     0       0       0       False          9%        0%
shapes  30x30   solved    hard      0.03        0     130     0     770       0       False         73%       44%
detail  30x30   solved    hard      0.02        0     840     0      60       0       False          5%        0%
 noise  30x30  stalled       -      0.14       18     873     0       9       0       False         87%       94%
 blobs  50x50   solved    easy      0.02        0    2500     0       0       0       False          7%        0%
shapes  50x50   solved    hard      0.14        0     322     0    2178       0       False         89%       48%
detail  50x50   solved    easy      0.05        0    2500     0       0       0       False          0%        0%
 noise  50x50  stalled       -     14.69       62      57    11    2370       0       False         83%       79%
 blobs  80x80   solved    easy      0.04        0    6400     0       0       0       False         13%        0%
shapes  80x80   solved    hard      1.09        0     650     0    5750       0       False         80%       85%
detail  80x80  stalled       -      1.01       24     122     2    6252       0       False         74%       67%
 noise  80x80  stalled       -     36.52     6391       0     0       9       0        True         79%       79%
```

### Supporting measurements

These came from separate runs during the same session.

- **Where the time goes at 80×80:** under cProfile, the line solvers' own time is 69% of the solve for `shapes` and 85% for `detail`. The rest is propagation bookkeeping and array copies in probing.
- **Depth-1 versus depth-2 time:** `detail` 80×80 takes 0.99 s at depth 1. Adding depth 2 costs another 0.08 s; it deduces nothing and doesn't time out. For `noise` 80×80, depth 1 takes about 26 s, then depth 2 spends its full 10 s budget without deducing anything.
- **Depth-2 cost against the unknown cells left after depth 1:**

  | Unknown cells after depth 1 | Grid | Depth-2 time | Deduced |
  | --- | --- | --- | --- |
  | 24 | detail 80×80 | 0.08 s | 0 cells |
  | 72 | shapes 15×15 | about 3.3 s | 6 cells, then stalled |
  | about 390 | random 20×20 at 40% density (the probing test grid) | over 8 s | stopped by the budget |
  | 6,391 | noise 80×80 | over 10 s | stopped by the budget, 0 cells |

  Depth-2 cost follows how many cells are still unknown, not the grid size. The data between 72 and 390 unknowns is thin.

### Observations

1. **Picture-like grids are cheap to solve once.** Every blobs, shapes and detail grid finishes in about 1.1 s or less at 80×80. The only small-grid case over 0.2 s is `shapes` 15×15, which spends its 3.3 s in depth 2.
2. **Noise is the pathological case.** At 80×80, propagation deduces nothing, depth-1 probing takes 26 s to find 9 cells, and depth 2 finds none. Real images should rarely look like this, but a busy, finely detailed photo at 80×80 could come close.
3. **Hit rates on a single solve say little about generation.** A solve with little probing barely reuses anything (5–13% for easy grids). Probing reuses a lot (70–99%). The generation loop re-solves nearly the same clues up to 200 times, so its hit rate should be much higher. Measure it once the loop exists.

## Decision: Numba

**Yes, move the line solvers to Numba, and do it right after the generation loop lands.**

- **The line solvers dominate.** They take 69–85% of solve time at 80×80, and they are tight integer loops over short arrays, which is what Numba speeds up most.
- **The 80×80 target doesn't fit in pure Python.** Generating a puzzle means a full re-solve every iteration (up to 200), plus up to 2 s of second-solution search whenever the solve stalls. At about 1.1 s per 80×80 solve for a picture that needs probing, the 60 s target allows about 55 iterations with no stalls. With a stall, each iteration costs about 3 s (the solve plus the search), which allows about 20.
- **30×30 is fine as it is.** Single solves take ≤ 0.14 s, except where depth 2 runs long (see the next decision). That is well inside the 5 s target for 30×30.
- **Doing it after the generation loop means the speed-up is measured on the real workload** (iteration counts, cache hit rates) rather than estimated. Keep the plan from the technical design: Numba `@njit` over `int8` arrays, the cache stays in Python, and a parity test checks the Numba and pure-Python results match.

## Decision: depth-2 probing at 80×80

**Affordable only when depth 1 leaves few unknown cells. Gate it on that count, not on grid size, and don't cap Expert at small grids.**

- Depth 2 costs almost nothing at 80×80 when 24 cells remain unknown, and it's unaffordable when thousands do. Grid size alone doesn't predict the cost. A size cap would block Expert on large pictures that are nearly solved, while still letting depth 2 run long on a busy 30×30 grid.
- **Proposed rule:** run depth 2 only when depth 1 stalls with at most 50 unknown cells. Otherwise count the solve as stalled and go straight to the second-solution search and fix-up. The 50 is a starting point to tune with the generation loop, since the evidence between 72 and 390 unknowns is thin.
- **Why a cell count rather than time:** the technical design requires that the same image, settings and seed always produce the same puzzle. A time budget breaks that, because where depth 2 stops depends on machine speed and load. A cell-count gate is deterministic, so the time budget should remain only as a safety net, and a solve that hits it should be treated as stalled. This belongs in the generation-loop milestone.

This answers the design doc's open question "Is depth-2 probing affordable at 80×80 in Python, or should Expert be capped to smaller grids?"
