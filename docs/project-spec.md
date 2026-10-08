# Nonogram Generator — Project Spec

Oct 8, 2026 · @Tyler MacPherson

## Overview

A browser app that turns any image into a black-and-white nonogram up to 50x50, guarantees the puzzle is solvable by pure logic, and exports it for printing, sharing, or playing in the app. Everything runs client-side: images never leave the user's machine and there is no server to run.

| Area | Decision | Why |
| --- | --- | --- |
| Platform | Client-side web app on free static hosting (GitHub Pages, Netlify, or Cloudflare Pages) | No install, no server cost, private by design |
| Stack | React + Vite + TypeScript; core logic in framework-free TS modules | Familiar ecosystem; core is unit-testable and reusable |
| Colors | Black-and-white in v1; data model ready for color | Ships sooner; color later without a rewrite |
| Grid sizing | Crop box + width slider (5–50); height follows crop aspect; square lock and presets | Framing matters more than resolution |
| Conversion | Area-average downscale, grayscale, brightness/contrast, Otsu auto-threshold + slider, invert, speck cleanup | Predictable; strong on high-contrast images |
| Solvability | Line-solvable is the pass bar; timed deep check explains failures | Unique solution, no guessing required |
| Repair | Highlight + manual edit, auto-fix, suggest nearby settings | Three escalating ways to reach a valid puzzle |
| Output | Print view (puzzle + solution), SVG/PNG, JSON project file, shareable URL | Covers paper, web, re-editing, and sharing |
| Play | Basic play first, comfort features later, solver hints as stretch | Shared links need a place to land |
| Extras | Difficulty rating, sample images + tips, original-vs-grid compare | Cheap, high value for creators |
| Devices | Desktop-first creator; touch-ready play with zoom/pan | Creation happens at a desk; play happens anywhere |

## Architecture

The React UI is a thin shell over pure TypeScript core modules; anything slow (solving, deep check, auto-fix, settings scan) runs in a Web Worker so sliders stay smooth. Core modules never import React, so they are unit-tested with Vitest and reusable later (CLI, color mode, batch).

- `core/image` — decode, crop, area-average downscale, grayscale, adjust, threshold, cleanup.
- `core/puzzle` — grid type, clue generation, edit overlay.
- `core/solver` — line solver, deep check, difficulty rating.
- `core/repair` — auto-fix and settings suggestions.
- `core/io` — JSON project files, URL encoding, SVG rendering.
- `workers/solver.worker.ts` — runs solver and repair jobs; each job has an id so stale results are discarded.
- `ui/` — creator, play, and print views; all grids drawn on `<canvas>`, not 2,500 DOM cells.

The data model is color-ready: v1 only uses values 0 and 1, and color later adds palette indices without changing shapes.

```ts
type CellValue = number;            // 0 = empty/background; 1 = filled (v1). Color: 1..N = palette index
interface Grid { width: number; height: number; cells: Uint8Array }   // row-major
interface ClueRun { length: number; color: number }                 // color is always 1 in v1
interface Puzzle {
  width: number; height: number;
  rows: ClueRun[][]; cols: ClueRun[][];
  solution: Grid; palette: string[];  // v1: ['#fff', '#000']
}
// Solver state: one bitmask per cell of still-possible values (bit 0 = empty, bit 1 = filled).
// Solved when every mask has one bit set. The same representation extends to N colors.
```

&#91;embedded content: architecture · UI shell, main-thread core, worker\]

The creator feeds settings to the image pipeline on the main thread; finished puzzles go to the worker, which sends back the verdict and the cells to highlight. `core/io` is shared by every view for saving, sharing, and printing.

## Image-to-grid pipeline

Each step is a pure function, and only the steps downstream of a changed setting re-run, so a threshold drag is near-instant. Dark cells become filled by default.

1. **Load and normalize.** Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` so phone photos aren't rotated. Flatten transparency onto white and cap the working copy at 2048 px on the longest side. Accept whatever the browser decodes (PNG, JPEG, WebP, GIF first frame, BMP, SVG; AVIF on most browsers).
2. **Crop.** The user drags a crop rectangle over the image; "lock to square" fixes its aspect ratio at 1:1.
3. **Size.** The width slider runs 5–50. Height = round(width × crop height ÷ crop width), clamped to 5–50; if the height would exceed 50, the width slider's maximum shrinks to fit. Presets (10, 15, 20, 25, 30, 40, 50) set the width and turn on the square lock.
4. **Downscale by area averaging.** Each cell's value is the average of every source pixel it covers, weighted by partial coverage. Don't rely on canvas `drawImage` scaling: at big reduction ratios it samples rather than averages, which gives noisy grids. Cache this result per crop and size.
5. **Grayscale.** Luminance = 0.2126 R + 0.7152 G + 0.0722 B, giving 0–255 per cell.
6. **Brightness and contrast.** Sliders applied to the cell values (cheap on at most 2,500 cells).
7. **Threshold.** Otsu's method on the cell histogram picks the default cutoff; a slider (0–255) overrides it, and an "Auto" button restores Otsu. Cell is filled when value < cutoff; **Invert** flips this.
8. **Cleanup** (default: on). Removes filled cells with no filled orthogonal neighbor and fills single-cell holes. Specks create long clue lists and ambiguity.
9. **Apply manual edits.** User overrides are stored as a sparse map and applied last, so they survive slider changes. Changing the grid size clears them, after a confirmation prompt.

Warn when the result is nearly all filled or all empty (above 90% or below 5%): such puzzles are technically valid but dull. Empty rows and columns are allowed and get the clue "0".

## Solvability

A puzzle passes when the line solver alone fills every cell: that proves the solution is unique and reachable without guessing. The deep check only runs on failure, to tell the user why.

**Line solver.** For one row or column, a dynamic-programming pass over (cell position, clue run index) finds every placement of the runs consistent with the cells already known. Any cell that is filled in all placements, or empty in all, is fixed. A queue of "dirty" lines repeats this until nothing changes; each line costs O(length × runs), so a 50x50 puzzle should solve in well under 50 ms. The solver returns the final cell masks, the list of undetermined cells, and a trace (rounds, deductions per round) for difficulty rating.

**Deep check.** Clues come from the image, so at least one solution (the image itself) always exists. The real question is whether a *second* one exists, so the search looks only for a solution that differs from the image. Backtracking picks the most-constrained undetermined cell, assumes the opposite of the image's value, propagates with the line solver, and recurses. It stops after 3 seconds (configurable).

| Verdict | Meaning | Shown as |
| --- | --- | --- |
| Valid | Line solver completes the grid | Green: "Unique, solvable by logic" |
| Needs guessing | Search exhausted, no second solution | Amber: unique but requires trial and error |
| Ambiguous | Second solution found | Red, with the differing cells highlighted |
| Inconclusive | Deep check timed out | Grey: "Couldn't prove either way" |

Only Valid counts as passing; export stays available for the other verdicts, behind a warning.

**Difficulty rating.** A heuristic from the line solver's trace: number of rounds needed, scaled by grid size, mapped to Easy / Medium / Hard / Expert. Tune the thresholds against the bundled sample puzzles and label the rating as an estimate.

## Repair tools

When a puzzle fails, the UI offers three fixes in escalating order: suggested settings first, then auto-fix, then hand edits. All three re-run the solver and update the verdict immediately.

**Highlight and manual edit.** Undetermined cells get a tinted overlay, with a counter such as "37 cells undetermined". Click toggles a cell and drag paints a run; edits go into the override map, with undo and redo.

**Suggest nearby settings.** Once settings stop changing (≈500 ms idle), the worker scans cutoff ±30 in steps of 2 and width ±3, line-solving each combination. It shows up to three passing options closest to the current settings, each applied with one click; the user can cancel a scan.

**Auto-fix.** A greedy loop in the worker:

1. Candidates = undetermined cells and their neighbors, ranked by how close their gray value sits to the cutoff (the least visible flips first). Cap at about 200 candidates per round.
2. For each candidate, flip it and line-solve; score = cells newly determined.
3. Keep the best flip, then repeat until the puzzle passes, no flip helps, or the flip budget (5% of cells) is spent.
4. Report the result. Flipped cells stay marked in the preview so the user can revert any one of them, for instance one that landed on an eye.

## Output formats

Every format is generated from the same `Puzzle` object, and the SVG renderer is shared by print, image export, and thumbnails.

| Format | Contents | Implementation notes |
| --- | --- | --- |
| Print view | Page 1: blank grid with clues, title, difficulty. Page 2: solution | Dedicated route + `@media print` CSS; user saves PDF through the browser dialog. Letter/A4 and portrait/landscape options; cell size auto-fits; bold rule every 5 cells; clue area sized to the longest clue |
| SVG / PNG | Blank puzzle or solution | SVG built as a string; PNG by drawing that SVG to a canvas and calling `toBlob` (1x/2x/4x scale) |
| JSON project | Puzzle, crop rectangle, all settings, manual edits, title; optional embedded source image | Versioned schema (`version: 1`); reopening restores the creator exactly. The embedded image is a downscaled JPEG (≤ 512 px), toggle defaults to on |
| Shareable URL | Opens straight into play mode | Puzzle in the URL *fragment* (`#p=…`), so it never reaches a server log: format byte, width, height, solution packed 8 cells/byte, base64url. A 50x50 grid ≈ 420 characters. Clues are rebuilt on load. A light XOR scramble stops casual spoilers; it is not security |

Open question: whether the shareable URL should also carry a title (adds length; cap at 60 characters if yes).

## Play mode, devices, and creator extras

Play mode ships in a basic form first and gains comfort features one at a time. The creator is designed for desktop; play mode must work well on phones.

**Basic play (v1).**

- Canvas board with row and column clues; click fills, right-click marks X.
- Drag paints along the row or column where the drag started, so runs are one gesture.
- On touch: a Fill / X toggle button instead of relying on long-press, which is unreliable on phones.
- Undo and redo; a Check button that reports the number of wrong cells and can highlight them.
- Keyboard: arrow keys move, Space fills, X marks.

**Comfort features (later, each independent).** Completed clue runs grey out automatically; the row and column under the cursor are highlighted; timer; progress autosaved to `localStorage` keyed by a hash of the puzzle; win animation.

**Devices.** The creator targets ≥ 1024 px wide screens and stays usable, but not polished, below that. Play mode supports pinch-zoom and pan, required for boards above 25 cells on a phone; the print view and creator recommend ≤ 25 wide for phone players.

**Creator extras.**

- *Difficulty badge* from the solver trace (see Solvability).
- *Sample images:* 4–6 bundled images you own or that are public domain, chosen because they convert well, plus a tip: high-contrast subject, plain background, crop tight.
- *Compare view:* original crop and grid side by side, with a toggle that overlays the grid at 50% opacity on the photo.

## Out of scope for v1

These were considered and deferred; the architecture leaves room for each.

- **Color puzzles:** palette quantization, color clue runs (adjacent runs of different colors need no gap), and color in the solver. The data model and cell bitmasks are already shaped for this.
- **Solver hints in play mode:** reveal the next logical deduction and name the row or column that proves it.
- **Local puzzle library** and **batch mode** for puzzle books.
- **Adaptive threshold** and **edge/outline** conversion modes.
- **Pre-revealed hint cells** as a repair option.
- **.non and webpbn XML export** for other nonogram tools.
- **HEIC images** (iPhone default): most browsers can't decode them; show a clear error suggesting JPEG.
- **Any backend or accounts.**

## Milestones

Seventeen small milestones in build order; each ends in something you can run or test. The core logic and solver come first because they carry the most risk and can be tested without any UI. v1 is complete at M15; M16–M17 are polish.

### Phase 1 — Core logic (no UI)

- [x] **M1. Scaffold.** Vite + React + TS, Vitest, ESLint/Prettier, empty app deployed to your static host.
  - Done when: tests run in CI and the live URL loads.
- [ ] **M2. Grid and clues.** `Grid` type and clue generation from a grid.
  - Done when: tests pass for an empty row ("0"), a full row, 1x1, and 50x50 grids.
- [ ] **M3. Line solver.** Per-line DP, dirty-line queue, undetermined-cell list, trace.
  - Done when: it solves several known line-solvable puzzles, reports a 2x2 diagonal as stuck, and solves a 50x50 in < 50 ms.
- [ ] **M4. Image pipeline.** Decode, orientation, area-average downscale, grayscale, Otsu, invert, cleanup.
  - Done when: tests on synthetic images (a black square on white, a checkerboard) produce the expected grids.

### Phase 2 — Creator

- [ ] **M5. Minimal creator.** Upload, width slider, cutoff slider, invert, canvas preview with clues.
  - Done when: dropping in an image shows a live-updating grid.
- [ ] **M6. Worker and verdict.** Solver in a Web Worker with job ids and debouncing; verdict badge; undetermined-cell highlight.
  - Done when: dragging sliders on a 50x50 grid stays smooth and the badge updates.
- [ ] **M7. Crop and sizing.** Crop box, square lock, presets, height derivation and clamping, brightness/contrast.
  - Done when: the 5–50 limits hold for very wide and very tall crops.
- [ ] **M8. Manual editing.** Click and drag editing, override map, undo/redo in the creator.
  - Done when: edits survive cutoff changes and the verdict re-checks instantly.

### Phase 3 — Solvability and repair

- [ ] **M9. Deep check.** Search for a second solution with a timeout; all four verdicts, with differing cells shown for Ambiguous.
  - Done when: known ambiguous, guess-requiring, and valid test puzzles each get the right verdict.
- [ ] **M10. Suggest settings.** Background scan of cutoff and width with one-click apply.
  - Done when: a failing sample image gets at least one passing suggestion.
- [ ] **M11. Auto-fix.** Greedy flip loop with budget, progress, cancel, and revertible flipped-cell markers.
  - Done when: most failing sample images pass after a handful of flips.

### Phase 4 — Output

- [ ] **M12. SVG/PNG export and JSON project files.** Save and load round-trip.
  - Done when: a reloaded project matches the original exactly, including edits.
- [ ] **M13. Print view.** Puzzle and solution pages, paper size and orientation, 5-cell rules.
  - Done when: a 50x50 prints legibly on one Letter or A4 page (landscape allowed).

### Phase 5 — Play and sharing

- [ ] **M14. Basic play mode.** Fill, X, drag painting, undo/redo, Check, keyboard controls, Fill/X toggle on touch.
  - Done when: you can solve a 15x15 start to finish with mouse, keyboard, and on a phone.
- [ ] **M15. Shareable URL.** Encode the puzzle in the fragment; links open in play mode.
  - Done when: a 50x50 link is about 420 characters and opens correctly in a fresh browser. **v1 complete.**

### Phase 6 — Polish

- [ ] **M16. Creator extras.** Difficulty badge, sample images with tips, compare and overlay view.
  - Done when: ratings across the samples feel sensibly ordered.
- [ ] **M17. Comfort play.** Pinch-zoom and pan, greyed-out clues, row/column highlight, timer, autosave, win animation; ship each one separately.
  - Done when: a 50x50 is playable on a phone.

After M17, pick from Out of scope; color puzzles or solver hints are the natural next steps.
