# M20 Implementation Plan — Colour Puzzles

Plan for a new user story (to add to `docs/user-stories.md` under a Phase 7 heading):

> As a creator, I want to turn a colour picture into a colour nonogram, so that pictures that only make sense in colour still become good puzzles.

From the spec's Out of scope list: "Color puzzles: palette quantization, color clue runs (adjacent runs of different colors need no gap), and color in the solver. The data model and cell bitmasks are already shaped for this."

This is the largest milestone so far: it touches every layer. Steps 2–5 change only `core` and can ship on their own. If the milestone needs splitting, split it after step 5.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Colour count | A "Colours" select in the creator: 2, 3, 4 or 5, counting the background. **2 is today's black-and-white mode, unchanged**: cutoff, Invert, cleanup, suggestions, links and files all work exactly as now. 3–5 turns on colour mode | Existing puzzles, links and tests stay as they are. Four ink colours keeps the clues readable and the links short, and most published colour nonograms use two to four |
| Cell values | 0 is the background (drawn white), and 1…N are palette indices, as the spec's data model already says. `Puzzle.palette` is `['#fff', ink1, …]`. `makePuzzle(solution, palette = ['#fff', '#000'])` | No shape changes, as the spec promised |
| Colour pipeline | Each RGB channel is downscaled with the existing `downscale` (a new `toChannels` splits the image into three `GrayImage` planes, composited onto white like `toGray`). Brightness and contrast apply to each channel with `adjust`. Then `quantize` runs k-means on the cells' colours with k = the colour count, seeded deterministically (farthest point from the mean colour, then the next farthest), for at most 20 iterations | Reuses the area-average downscale, so cells match the crop exactly as in black-and-white. A deterministic seed means the same image always gives the same grid, which tests and saved projects rely on |
| Colour space | Decided by the prototype (step 1): k-means in RGB vs CIELAB on the samples. Pick Lab only if it gives visibly cleaner grids on at least two samples | Lab matches how people see colour better, but costs a conversion. Evidence first |
| Background | The cluster that covers the most border cells; on a tie, the lightest. Clicking a palette swatch and choosing "Make background" overrides it | A plain border is usually the background; the override handles the photos where it isn't |
| Ink colours | Each ink is drawn as its cluster's mean colour. Cutoff and Invert are hidden in colour mode | The cluster mean is what the cells looked like. Cutoff and Invert only make sense with two tones |
| Cleanup | Generalised: a cell with no orthogonal neighbour of its own colour takes its neighbours' most common colour (ties go to the background), and a background cell whose four neighbours all share one ink becomes that ink. With two colours this is exactly today's rule | Same speck removal, and the black-and-white grids stay byte-identical |
| Solver masks | Bit v means "value v is still possible". `EMPTY` (1) and `FILLED` (2) keep their values, so black-and-white masks don't change. The full mask is `(1 << colours) - 1`, where `colours` comes from the clues (1 + the highest run colour). Masks stay one byte | Already the spec's design. Taking the count from the clues means `solve`'s signature doesn't change |
| Line solver | In `solveLine`, a run needs an empty cell after it only when the next run has the **same** colour. Otherwise the next run may start right after it. `blocked` becomes one prefix count per colour (cells that can't be that colour). The output sets the bit of each run colour that can cover a cell. With one colour, every step is the same as today | Adjacent runs of different colours need no gap, the one rule that makes colour nonograms different. The per-colour prefix keeps it O(length × runs × colours) |
| Propagation | `propagate` counts a cell as fixed when its mask drops to one bit. Any change to a mask marks the crossing line dirty, even when the cell isn't fixed yet | With colour, a mask can lose a bit without being settled. In black-and-white every change already fixes the cell, so traces and difficulty ratings don't change |
| Deep check | Branches over each value still possible in the cell, trying values other than the image's first | Same idea as today's "opposite first", with more branches |
| Clue display | Each clue number sits on a cell-sized square of its run's colour, with black or white digits, whichever contrasts more. Greyed-out clues (M17) draw at 35% opacity. Black-and-white puzzles keep plain black digits | Coloured digits on white are unreadable for light inks. The layout keeps one cell per number, so clue areas stay the same size |
| Creator editing | In colour mode, a swatch row picks the paint colour. A click paints that colour, or clears to background if the cell already has it. Edits already store a value per cell | The black-and-white toggle (`1 - value`) doesn't extend to more colours |
| Auto-fix | `FixRequest` swaps `values` and `cutoff` for `closeness` (lower means a closer call) and `alternate` (the value a flip sets). Black-and-white passes `|value − cutoff|` and `1 − cell`. Colour passes the ratio of each cell's distance to its nearest and second-nearest palette colour, and the second-nearest colour | One greedy loop for both modes; only the caller in `useAutoFix` changes |
| Suggestions | In colour mode, the scan tries widths ±3 and colour counts ±1 (within 3–5) instead of cutoffs | There is no cutoff to vary |
| Play | A swatch per ink colour plus X replaces the Fill / X toggle. A left click paints the selected ink, a right click marks X, and keys 1…N pick an ink. `mistakes`, `isSolved` and `completedClues` in `board.ts` compare run colours as well as lengths | The board format (0, 1…N, 255 for X) was already chosen to leave room for colours in M14 |
| Hints (M19) | `nextHint` maps an ink v to mask bit v and treats an X on any ink cell as a mistake; a hint's values become inks or X | Keeps hints working; a small change once M19 exists |
| Share link | **Format 2:** format byte, width, height, colour count, 3 RGB bytes per ink, then cells packed at 2 bits (3–4 colours) or 3 bits (5 colours), scrambled, then the checksum. Black-and-white puzzles still write format 1, and format 1 still decodes | Old links keep working and black-and-white links stay about 420 characters. A 50x50 is about 850 characters with four colours and about 1,270 with five, still fine in a URL fragment |
| Project file | `VERSION` becomes 2: it adds `settings.colours` and `palette`, and allows grid digits and edit values up to `colours − 1`. Version 1 files still open, as two colours. The app always writes version 2 | The schema is versioned for this. There's no older app still running to read new files, because the site redeploys |
| SVG, PNG and print | `renderSvg` fills cells and clue squares from the palette. The print view shows "Colour puzzle — print in colour" under the heading | One renderer, as now. A greyscale printout of a colour puzzle loses the information players need |
| Difficulty | Same formula and thresholds; the badge still says "estimate" | Run colours give players extra information, so colour puzzles may rate harder than they feel. Tune with evidence later, as in M18 |
| Samples | `draw.py` draws two colour samples (for example a parrot on a branch and a lighthouse with a red band), shown in the samples row when Colours is 3 or more | The current samples are all close to two tones |

## Files

```
src/core/image/pipeline.ts         # toChannels, quantize, colour cleanup
src/core/image/pipeline.test.ts
src/core/puzzle/clues.ts           # makePuzzle(solution, palette)
src/core/puzzle/board.ts           # colour-aware mistakes, isSolved, completedClues
src/core/puzzle/board.test.ts
src/core/solver/line.ts            # per-colour runs and gaps
src/core/solver/solve.ts           # fixed = single bit; dirty on any change
src/core/solver/deep.ts            # branch over remaining values
src/core/solver/*.test.ts
src/core/solver/hint.ts            # colour mapping (if M19 has landed)
src/core/repair/autofix.ts         # closeness and alternate
src/core/repair/suggest.ts         # scan colour count in colour mode
src/core/io/share.ts               # format 2
src/core/io/project.ts             # version 2
src/core/io/svg.ts                 # palette fills, clue squares
src/core/io/*.test.ts
src/ui/Creator.tsx                 # Colours select, palette swatches, edit colour, background override
src/ui/useAutoFix.ts               # builds closeness and alternate
src/ui/Preview.tsx                 # palette cells, clue squares
src/ui/Compare.tsx                 # palette cells
src/ui/PlayView.tsx                # ink swatches, keys 1…N
src/ui/PrintView.tsx               # colour note
src/ui/samples/draw.py, *.jpg, README.md  # two colour samples
src/ui/Creator.browser.test.tsx, samples.browser.test.ts
docs/user-stories.md, docs/project-spec.md  # the new story, M20 entry, ticks
```

## Steps (one commit each)

1. **Prototype (not committed):** quantize the samples and two colour test images at widths 15–40, in RGB and in Lab. Record which colour space wins and how many results are Valid in a "Prototype results" section in this plan.
2. **Solver:** masks, `solveLine`, `propagate`, `deepCheck`, with the black-and-white regression and brute-force tests below.
3. **Puzzle:** `makePuzzle` with a palette, and the colour-aware `board.ts` functions.
4. **Image:** `toChannels`, `quantize`, colour cleanup.
5. **Formats:** share format 2, project version 2, `renderSvg` with palette and clue squares.
6. **Creator:** Colours select, pipeline switch, palette swatches with "Make background", edit colour, auto-fix and suggestion changes, print note.
7. **Play:** ink swatches, keys, hint mapping.
8. **Samples:** the two colour samples, the README entries, and the samples-row filter.

## Tests

Node:

| Case | Expected |
| --- | --- |
| Every existing solver, deep-check, difficulty, auto-fix and suggest test | Passes unchanged |
| Random black-and-white grids, 5x5 to 50x50 | Identical `SolveResult` (masks and trace) to the version before this milestone, saved as fixtures in step 2 |
| `solveLine` on random lines of up to 10 cells, 2–4 colours, random partial masks | Matches brute force: every placement of the runs is listed, and each cell keeps exactly the values some placement uses |
| `[2 red, 1 blue]` on 3 cells | Solved with no gap: R R B |
| `[1 red, 1 red]` on 3 cells | R _ R |
| A colour grid that needs a guess, and one with two solutions | `deepCheck` gives unique and ambiguous with the differing cells |
| `quantize` on a synthetic image of three flat colour blocks | Three clusters at the block colours; the same result on every run |
| Background choice on a red square in a blue border | Blue is the background |
| Colour cleanup with two colours | The same grid as `cleanup` |
| Share format 2 round-trip, 5x5 to 50x50, 3–5 colours, odd sizes | Exact; format 1 links still decode; bad colour counts or lengths throw |
| Project version 2 round-trip; a version 1 file | Exact; opens as two colours |
| `renderSvg` on a colour puzzle | Ink fills and clue squares in palette colours; light inks get black digits |
| `isSolved` with the right lengths but the wrong colours | Not solved |

Browser:

| Case | Expected |
| --- | --- |
| Colours 2 on a sample | The same grid and verdict as before this milestone |
| Colours 3 on a three-block test image | Three palette swatches; Valid; clue squares in the block colours |
| "Make background" on another swatch | That colour's cells become empty and the clues change |
| Paint with a picked edit colour, then click the same cell again | Painted, then cleared |
| Auto-fix on a failing colour grid | Valid after a few flips, each flip landing on its second-nearest colour |
| Play a colour puzzle with swatches, then with keys 1…N | Solved message both times |
| A colour share link in a fresh context | Opens in play with the palette |

Production check (Playwright on the built app): load each colour sample at Colours 4, share it, open the link in a fresh context, and take screenshots of the creator and the play board.

## Acceptance criteria → how each is verified

Proposed criteria for the new story:

| Criterion | Verification |
| --- | --- |
| Choosing 3–5 colours turns a colour image into a colour grid, with background and inks picked automatically and the background changeable | Quantize and background tests; Colours 3 and Make background browser tests |
| Clues show each run's colour, and adjacent runs of different colours need no gap | Clue square tests; `solveLine` no-gap tests |
| Verdicts, deep check, auto-fix and suggestions work in colour | Solver, deep-check and auto-fix tests |
| Colour puzzles export, print, save, reopen and share | Format round-trip tests; fresh-context link test |
| Colour puzzles can be played with mouse, keyboard and touch | Play tests; production check |
| Black-and-white puzzles, links and files are unchanged | Regression fixtures; format 1 and version 1 tests; the full existing suite |

## Out of scope for M20

Choosing ink colours by hand or with an eyedropper, more than five colours, a background that isn't white, dithering, palettes adjusted for colour blindness, colour in `.non` or webpbn exports, and new difficulty thresholds for colour.

## Risks

- **Colour blindness:** players who can't tell two inks apart can't solve the puzzle. Picking clearly different inks helps but isn't a guarantee. A pattern per colour, or a check that warns about close inks, would be a follow-up.
- **Photos quantize poorly:** shading turns into blotches of several colours. Flat artwork and logos work best; the tips panel should say so in colour mode.
- **Speed:** colour lines do more work per line, and deep checks branch wider. The M3 target (50x50 in under 50 ms) is for black-and-white; colour gets its own benchmark in step 2, and if it's slow the creator's debounce absorbs it.
- **Size of the change:** it touches every layer. Keeping two colours byte-identical, with regression fixtures, is what makes it safe to land in steps.
