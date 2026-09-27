# Nonogram Generator — Product Brief

Sep 27, 2026 · @Tyler MacPherson

## Overview

The Nonogram Generator turns any image into a nonogram puzzle with exactly one solution, at a grid size the user chooses. Most nonogram sources offer a fixed library of puzzles; this app lets people make puzzles from pictures they care about.

The core promise: every generated puzzle is solvable by logic alone, with no guessing. Instead of letting users pick a difficulty, the app rates each puzzle after generation so users know what they're getting into.

## Goals and non-goals

**Goals**

- Generate a nonogram from any uploaded image at a user-specified grid size.
- Guarantee every puzzle has exactly one solution reachable by logic.
- Stay as visually faithful to the source image as uniqueness allows.
- Show a difficulty rating for each generated puzzle.

**Non-goals**

- Difficulty targeting. Users don't choose Easy or Hard; the image and size determine the challenge, and the rating reports it.
- Public hosting, accounts, a curated puzzle library, or social features. This is a personal tool.
- Color nonograms (a stretch goal, not the MVP).

## User flow

1. Upload an image.
2. Crop it and choose a grid size (width × height).
3. Adjust the threshold while watching a live black-and-white preview of the grid.
4. Generate. The app produces a unique puzzle and shows its difficulty rating, plus how many cells were changed from the preview to make it unique. If the result looks off, the user can regenerate for a different set of changes.
5. Export it as a printable PDF (in-browser play follows the MVP).

## MVP features

| Feature | What it does |
| --- | --- |
| Image input | Upload, crop, and resize to the chosen grid (up to 80×80) |
| Threshold preview | Live black-and-white grid with an adjustable threshold (Otsu as the default) |
| Clue generation | Derives row and column clues from the binary grid |
| Uniqueness solver | Confirms exactly one solution reachable by logic; drives the fix-up loop |
| Minimal-change fix-up | Flips the lowest-cost cells needed to remove ambiguity |
| Regenerate | Produces a different valid puzzle from the same image and settings |
| Difficulty rating | Labels the puzzle from the techniques the solver needed |
| Export | Printable PDF of the blank puzzle and its solution |

In-browser play comes after the MVP (see Milestones).

## Technical approach

The solver is the heart of the app: it both guarantees uniqueness and produces the difficulty rating.

&#91;embedded content: generation loop · 5 steps, 1 decision, 1 loop\]

The image is resized to the grid and thresholded into a candidate grid. The solver checks whether the derived clues have exactly one solution; if not, the app flips the ambiguous cells whose change is least visible and re-checks until the puzzle is unique.

**Solver.** A line solver (overlap and edge logic, then exhaustive per-line solving), plus contradiction probing. A puzzle is accepted only if these techniques solve it completely without guessing, which is stricter than uniqueness alone. When they stall, backtracking finds a second solution, and the cells where the two solutions differ become the flip candidates. Written in Python, with rows and columns stored as bitsets (Python ints or NumPy arrays). General nonogram solving is NP-complete; grids up to 80×80 are supported, and the largest sizes are the main performance risk (see Risks).

**Choosing cells to flip.** Each flip candidate gets a cost, and the cheapest goes first:

- **Source ambiguity:** a cell whose pixel brightness sat close to the threshold is cheap to flip, since it was nearly the other color anyway.
- **Neighborhood fit:** a flip that smooths an edge is cheap; one that creates an isolated speck inside a solid region is expensive.

**Regenerate.** Ties and near-ties between flip candidates are broken with a random seed. Regenerating picks a new seed, producing a different valid puzzle from the same image.

**Difficulty rating.** Recorded as a side effect of solving, based on the hardest technique the solver needed:

| Rating | Hardest technique required |
| --- | --- |
| Easy | Simple overlap and edge logic |
| Medium | Full per-line solving |
| Hard | Single-step contradiction ("if this cell were filled, a line breaks") |
| Expert | Multi-step contradiction chains |

Grid size and the number of solver passes can refine the label within a tier.

## Risks and decisions

**Risks**

- **Solver speed in Python at 80×80.** Probing and backtracking in pure Python may be slow at the largest size, and the fix-up loop re-solves many times. Mitigation: benchmark early; speed up hot loops with Numba or a small compiled extension if needed; cache line-solver results across re-solves.
- **Photos downsample poorly.** At small sizes, a photo often becomes an unrecognizable blob. Mitigation: crop, contrast, and threshold controls with a live preview; silhouettes and logos work best.
- **Fidelity vs. uniqueness.** Some images need many flipped cells to become unique, which degrades the picture. Mitigation: flip-cost scoring, plus a warning when changes pass the threshold below.

**Decisions**

- [x] Audience: personal use only.
- [x] Language: Python.
- [x] Maximum grid size: 80×80.
- [x] Success criteria (initial targets, tune after testing): under 5 seconds for grids up to 30×30, under 60 seconds at 80×80, and a warning when more than 5% of cells were flipped.
- [x] Flip scoring: source ambiguity plus neighborhood fit (see Technical approach).
- [x] Regenerate: yes, via seeded tie-breaking among flip candidates.

## Milestones and stretch goals

1. **Solver first.** Line solver, probing, and uniqueness check as a standalone module, tested against known puzzles and benchmarked at 80×80 early, since that decides whether the solver needs Numba or a compiled extension.
2. **Image pipeline.** Resize, threshold, and clue generation, with the preview grid.
3. **Generation loop.** Minimal-change fix-up wired to the solver; report cells changed.
4. **Difficulty rating.** Record techniques during solving and map them to tiers.
5. **Export.** Printable PDF of puzzle and solution. This completes the MVP.
6. **In-browser play.** Interactive grid with fill, cross-out, and completion check.

**Stretch goals:** color nonograms, difficulty targeting built on the rating system, and import/export in standard nonogram file formats.

**Reference reading:** Jan Wolter's nonogram solver survey and pbnsolve source (webpbn.com), and Batenburg and Kosters' papers on solving and rating nonograms.
