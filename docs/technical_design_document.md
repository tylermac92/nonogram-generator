# Nonogram Generator — Technical Design

Sep 27, 2026 · @Tyler MacPherson

## Summary

This design implements the Nonogram Generator — Product Brief: a personal Python tool that turns an image into a nonogram with exactly one logically reachable solution, at grid sizes up to 80×80.

Key choices:

- **Local web app.** A FastAPI server on localhost with a small HTML/JS frontend. The browser gives a live threshold preview now and in-browser play later, with no hosting.
- **Solver-centered core.** One solver module decides acceptance, finds ambiguous cells, and produces the difficulty rating.
- **CLI alongside the UI.** Every core function is callable from a command line, for scripting, testing, and benchmarking.
- **Pure Python first, Numba where profiling says so.** The line solver is the expected hot spot.

## Architecture

All logic lives in a single Python package; the server and CLI are thin wrappers over it.

&#91;embedded content: architecture · 2 entry points, 1 server, 4 core modules\]

The generator is the only module that calls the solver. The server and CLI call the image pipeline, generator, and PDF export directly. No module holds state between calls: a puzzle is a value passed in and returned.

## Data model

The solver works on a NumPy `int8` array of shape (rows, cols), where each cell is `-1` unknown, `0` empty, or `1` filled. `int8` arrays keep memory small (80×80 = 6.4 KB) and work directly with Numba. The target solution is a `bool` array of the same shape.

Clues are a list of tuples per axis: `row_clues[r] = (3, 1, 2)`, with `()` for an empty line. Clues are derived from the solution by run-length encoding and never edited by hand.

A generated puzzle is saved as JSON so it can be re-exported, replayed, or regenerated later:

```json
{
  "version": 1,
  "width": 40,
  "height": 30,
  "row_clues": [[3, 1], [5], []],
  "col_clues": [[2], [1, 1], [4]],
  "solution": ["0011100...", "..."],
  "rating": "hard",
  "stats": {"flipped_cells": 12, "flipped_pct": 1.0, "solve_ms": 840},
  "source": {"image_sha256": "...", "crop": [0, 0, 800, 600], "threshold": 0.47, "invert": false, "gamma": 1.0, "contrast": 1.0, "seed": 1234}
}
```

The `source` block records everything needed to reproduce the puzzle. The same image, settings, and seed always give the same result.

## Image pipeline

The pipeline runs once per crop or size change and returns a grayscale grid; thresholding happens separately so the preview can update instantly.

1. **Load.** Pillow opens the image, applies EXIF orientation, and flattens transparency onto white.
2. **Crop.** The user's crop box is applied. The UI locks the crop to the grid's aspect ratio so cells stay square.
3. **Grayscale.** Convert to luminance (Pillow mode `L`), scaled to floats in 0–1.
4. **Contrast.** Optional gamma and contrast adjustments from UI sliders.
5. **Downsample.** Resize to (cols, rows) with box filtering, so each cell's value is the average brightness of its source pixels. Averaging preserves the "nearly black / nearly white" information that flip scoring uses later.
6. **Default threshold.** Compute Otsu's threshold on the downsampled grid and return it as the slider's starting value.

The output is a float array of cell brightness plus the Otsu value. The browser thresholds it in JavaScript on every slider move, so the preview needs no server round trip. A cell is filled when its brightness is below the threshold; an **invert** toggle flips that for light-on-dark images.

## Solver

The solver applies techniques in increasing cost and records the hardest one it needed. Every deduction is sound, so if logic fills the whole grid, the puzzle is unique by construction.

### Line solving

Two line solvers take a clue and a line's current state and return newly determined cells, or a contradiction.

- **Simple solver.** Computes the leftmost and rightmost valid placement of each block given known cells. Cells covered by the same block in both placements are filled; cells no block can reach are empty. Cheap, and matches how a human does easy puzzles.
- **Full solver.** Dynamic programming over (cell position, block index). A forward pass records which prefixes of the line can hold the first *j* blocks; a backward pass does the same for suffixes. Combining them tells, for each cell, whether any valid placement fills it and whether any leaves it empty. Only one possibility means a deduction; neither means a contradiction. Cost is O(n · k) per line with prefix sums for "range has no empty cell" checks.

Line results are memoized in a size-capped LRU cache keyed by `(clue, line_state.tobytes())`. The function is pure, so the cache stays valid across every iteration of the generation loop, where most lines don't change.

### Propagation

A work queue holds dirty lines, starting with all of them. Each pop runs the simple solver; any newly set cell marks its crossing line dirty. When the queue empties, the full solver runs on lines the simple solver couldn't finish, and propagation resumes. It stops at a fixpoint, a solved grid, or a contradiction.

### Probing

When propagation stalls, the solver probes unknown cells, starting with those next to known cells:

1. Assume the cell is filled and propagate on a copy of the grid; then assume it is empty.
2. If one assumption hits a contradiction, the cell takes the other value.
3. If both succeed, any cell that ended up the same in both copies is also deduced.

Any deduction returns control to propagation. **Depth-2 probing** allows depth-1 probes inside a probe. It is much more expensive, so it runs only when depth 1 stalls, under a time budget.

### Acceptance and search

A puzzle is **accepted** when propagation plus probing up to depth 2 solves it completely. Otherwise it has **stalled**, and the solver returns the grid's remaining unknown cells.

On a stall, a depth-first search with propagation looks for a second solution: it tries unknown cells in turn, forcing each to the opposite of its target value and searching. A cell whose forced value leads to no solution is skipped, and the next is tried. If it finds one, the cells where the two solutions differ are the true source of ambiguity and become the preferred flip candidates. The search has a time budget (2 seconds to start); if it runs out, all unknown cells at the stall are used as candidates instead.

## Generation loop and flip scoring

The generator repeatedly solves, flips the cheapest ambiguous cells, and re-solves until the puzzle is accepted or a budget runs out.

1. Threshold the brightness grid into the target solution.
2. Derive clues and run the solver.
3. If accepted, stop and return the puzzle with its rating.
4. Otherwise, score the flip candidates and flip a small batch of the cheapest.
5. Go to step 2.

**Scoring.** Each candidate cell *c* gets a cost; lower is flipped first:

```latex
\mathrm{cost}(c) = \alpha \, |p_c - t| + \beta \left(1 - \frac{n_c}{8}\right) + \varepsilon \, u_c
```

Here *p* is the cell's brightness, *t* the threshold, *n* the number of 8-neighbors that would match the cell's new color (out-of-bounds counts as empty), and *u* a uniform random draw from the seeded RNG. The first term makes near-threshold cells cheap; the second makes edge-smoothing flips cheap and isolated specks expensive; the third breaks ties, which is what makes Regenerate produce a different puzzle. Starting weights: α = 1, β = 0.5, ε = 0.01, tuned during testing.

**Batching.** Each iteration flips up to 4 cells, each at least 4 cells apart (Chebyshev distance), so separate ambiguous regions are fixed in parallel. A flipped cell is never flipped back.

**Full re-solve.** Each iteration re-solves from an empty grid. Changing one clue can invalidate deductions anywhere, so reusing the previous solve state isn't safe. The line-solver cache makes this cheap, because most lines' clues and states repeat. This corrects the brief's "re-solve only affected lines" mitigation.

**Limits.** Generation fails when no eligible flip candidates remain, or after 200 iterations or 120 seconds, with a message suggesting a larger grid or a different threshold. The result carries a warning when flipped cells exceed 5% of the grid.

## Difficulty rating

The rating comes from a trace the solver keeps during the final, accepted solve: the hardest technique used, and how many deductions each technique made.

| Rating | Hardest technique needed |
| --- | --- |
| Easy | Simple line solver only |
| Medium | Full (DP) line solver |
| Hard | Depth-1 probing |
| Expert | Depth-2 probing |

The trace is stored in the puzzle file's `stats` so thresholds can be re-tuned without regenerating. Refining the label within a tier (for example, weighting by grid size or number of probe deductions) is deferred until there's real data from generated puzzles.

## API and UI

The server binds to `127.0.0.1` only and has three endpoints.

| Endpoint | Input | Output |
| --- | --- | --- |
| `POST /api/preview` | Image upload, crop box, grid size, gamma/contrast | Brightness grid, Otsu threshold, image SHA-256 |
| `POST /api/generate` | Brightness grid, threshold, invert flag, seed, and the source metadata (image hash, crop, gamma/contrast) echoed back from the preview | Puzzle JSON (clues, solution, rating, stats, warnings) |
| `POST /api/export/pdf` | Puzzle JSON | PDF file |

**Input validation.** Uploads are capped at 20 MB and limited to formats Pillow opens (PNG, JPEG, GIF, WebP, BMP). Grid dimensions must be 5–80 per side. The preview warns when the thresholded grid is under 5% or over 95% filled, since near-empty or near-solid grids make poor puzzles.

Generation can take up to a minute at 80×80, so `/api/generate` runs the work in a separate process (ProcessPoolExecutor). Solving is CPU-bound, so a thread would hold the GIL and stall the server; a process keeps it responsive and lets a new request abandon a stale job, such as when the user hits Regenerate mid-run. The UI shows a spinner with elapsed time. For a single local user a blocking request is simpler than a job queue; a progress endpoint can come later if needed.

The frontend is one static HTML page with vanilla JavaScript and a `<canvas>`, served by FastAPI: an image drop zone with a crop rectangle, grid-size inputs, threshold, contrast, and invert controls redrawing the preview on each change, then a Generate button. The result view shows the puzzle, rating, flipped-cell count, any warning, and buttons for Regenerate (new seed) and Export PDF. Changed cells are highlighted on the preview so their effect on the picture is visible.

## PDF export

ReportLab draws the PDF directly as vector graphics: page 1 is the blank puzzle with clues, page 2 the solution. The footer on both pages shows grid size, rating, and seed.

Layout is computed from the clues: the left clue area is as wide as the longest row clue, the top area as tall as the longest column clue, and the cell size is whatever fits the remaining page. Every fifth grid line is drawn heavier, as in printed nonograms.

Large grids are the constraint. An 80×80 puzzle with long clues leaves cells around 5 pt (under 2 mm) on Letter paper, which is hard to solve on paper. The exporter switches to landscape when the grid is wider than tall, and warns when cells fall below a minimum readable size (6 pt to start).

## Project layout and dependencies

```
nonogram/
  pyproject.toml
  src/nonogram/
    image.py          # load, crop, grayscale, downsample, Otsu
    clues.py          # run-length encoding, clue validation
    solver/
      line.py         # simple and DP line solvers, memo cache
      propagate.py    # dirty-line queue to fixpoint
      probe.py        # depth-1 and depth-2 probing
      search.py       # DFS for a second solution
      trace.py        # technique counts, rating
    generator.py      # flip loop, cost scoring, seeded RNG
    puzzle.py         # Puzzle dataclass, JSON load/save
    export_pdf.py     # ReportLab layout
    cli.py            # Typer commands
    server/
      app.py          # FastAPI endpoints
      static/         # index.html, app.js
  tests/
  benchmarks/
```

| Package | Used for |
| --- | --- |
| NumPy | Grid arrays |
| Pillow | Image loading and resizing |
| FastAPI + Uvicorn | Local server |
| python-multipart | Image uploads |
| ReportLab | PDF export |
| Typer | CLI |
| Numba (optional extra) | JIT for the line solver if profiling calls for it |
| pytest, Hypothesis, pytest-benchmark | Tests and benchmarks |

The CLI mirrors the API: `nonogram generate IMG --size 40x30 [--threshold T] [--seed N] -o puzzle.json`, `nonogram export puzzle.json -o puzzle.pdf`, `nonogram solve puzzle.json` (prints the rating trace), and `nonogram bench`.

## Testing and performance plan

The solver must never make a wrong deduction, so most testing effort goes there.

**Correctness tests**

- **Line solver vs. brute force.** Hypothesis generates random clues and partial line states up to length 20; the DP result must match enumerating every placement. Simple-solver deductions must be a subset of full-solver deductions.
- **Soundness on random grids.** Generate a random grid, derive its clues, run the solver: every cell it sets must match the grid, whether or not it finishes.
- **Known puzzles.** A small corpus of puzzles with known answers and known uniqueness, including cases that need probing and ones that have multiple solutions.
- **Generator invariants.** Every accepted puzzle re-solves to its stored solution; the same image, settings, and seed always give identical output.

**Performance targets** (from the brief): under 5 seconds up to 30×30, under 60 seconds at 80×80.

`nonogram bench` runs a fixed set of test images at 15×15, 30×30, 50×50, and 80×80 and reports solve time, generation time, iterations, and cache hit rate. The plan:

1. Build pure Python and measure at 80×80 in the first milestone.
2. Profile with cProfile; the DP line solver is the expected hot spot.
3. If targets are missed, move the line solver to Numba `@njit` over `int8` arrays. The data model is already shaped for it. The cache stays in Python, wrapping the jitted function, and a parity test checks that Numba and pure-Python results match.
4. Only if still too slow, consider a compiled extension for the line solver.

## Open questions

- [x] Is depth-2 probing affordable at 80×80 in Python, or should Expert be capped to smaller grids? Answered by the first benchmark: only when depth 1 leaves few unknown cells, so gate depth 2 on that count rather than capping by grid size (see `benchmarks/RESULTS.md`).
- [ ] Should the minimum readable PDF cell size block export or only warn?
- [ ] Is 4 flips per iteration the right batch size, or should it scale with grid size?
- [ ] Which puzzles make up the known-puzzle test corpus? Hand-built cases are enough to start.
