# M16 Implementation Plan — Creator Extras

Plan for the sixteenth user story in `docs/user-stories.md`:

> As a creator, I want a difficulty estimate, good starting examples, and a way to compare the grid with the original, so that I can make puzzles that are both fun and faithful to the picture.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Difficulty score | `score = side × depth`. `side` is √(width × height). `depth` is the average round in which the line solver fixes a cell: Σ (round × cells fixed in that round) ÷ cells. 1.0 means every cell falls out on the first pass | The spec's "rounds needed, scaled by grid size". The raw round count jumps around: the cameraman needs 3, 5, 3 and 5 rounds at widths 20, 25, 30 and 40. Averaging over cells smooths that, because the last round often fixes only a cell or two |
| Labels | Easy below 20, Medium below 35, Hard below 55, Expert from 55. Tuned against the samples (see Prototype results) | Every sample's rating rises or stays level as its size grows. At the same size, the simpler pictures rate lower |
| Where it lives | `difficulty(result: SolveResult)` in `core/solver/difficulty.ts`. It returns `'Easy' \| 'Medium' \| 'Hard' \| 'Expert'`, or `null` unless the result is solved. The cell count comes from `result.masks.length` | The spec puts difficulty in `core/solver`. It's pure, and tested in Node |
| Badge | Next to the verdict, only while the puzzle is Valid: "Difficulty: Medium (estimate)" | The criterion: labelled as an estimate, and none for non-Valid puzzles |
| Print view | Page 1's heading becomes "Title · Medium difficulty (estimate)". The solution page is unchanged. With no Valid verdict, the heading has no difficulty | "Page 1: blank grid with clues, title, difficulty". The heading stays on one line, so the reserved heading height still fits |
| Project file | `serializeProject` writes `"difficulty": "Medium"` when the puzzle is Valid. `parseProject` ignores it, and the app recomputes it on load. `VERSION` stays 1 | It's for people and other tools reading the file. A stored value could disagree with the grid, so the app never trusts it. Old files without it still open |
| Samples | Five pictures, all Valid at the default width of 20: **horse** and **cameraman** are photos from scikit-image's sample data (CC0), and **cat**, **sailboat** and **skyline** are drawn for this project by a Pillow script kept beside them. Each is a JPEG of at most 600 px, 10–60 KB, about 220 KB in all | The network here can't reach Wikimedia or NASA. scikit-image documents each picture's licence, and only its silhouettes convert well: the rocket, coins, cat, coffee and astronaut photos all came out as noise (checked). The drawn ones are dark subjects on soft gradient skies, with grain and blur, so auto cutoff and cleanup have real work to do. They are owned by the project |
| Where samples live | `src/ui/samples/` with a `README.md` that gives each file's source, author, licence, and what was changed. `Creator` imports the files, so Vite fingerprints them, and tests import the same files | Same pattern as `core/image/fixtures`. The README isn't deployed |
| Sample picker | A "Try a sample" row of five thumbnail buttons (about 64 px tall, `alt` text such as "Horse") under the file inputs, always shown. Clicking one fetches the file and goes through the same `open()` as an upload, so it asks before clearing edits | One click from a fresh page, as the criterion asks. Keeping it visible lets you switch samples without reloading |
| Tips | Beside the samples: "Pictures that work best: a dark subject on a plain, light background; strong contrast; cropped tight around the subject. Use Invert for a light subject on a dark background." | Covers contrast, plain backgrounds and cropping tight |
| Compare view | A `<details>` "Compare with the photo" under the preview, shown when there's an image. Inside: two canvases of the same size, the crop of the photo and the grid (edits included) drawn as black cells on white, plus an "Overlay" checkbox. Overlay stacks the grid canvas on the photo at 50% opacity | The grid canvas covers exactly the crop rectangle, the same area `downscale` averages, so each cell sits on the pixels it came from. `<details>` needs no open/closed state of its own |
| Moved criteria (M10, M11) | A browser test runs every sample at widths 10, 15, 20, 25, 30, 40 and 50 through the creator's pipeline. In the prototype, 5 of 35 runs fail. At least one must get a passing suggestion, and most must pass after auto-fix with under 2% of cells flipped | The samples are Valid at the default width, so the failing cases come from other sizes |
| "Judged by solving them yourself" | I check the ordering in tests. **You** confirm the feel by playing three samples (suggested: cat at 15, Easy; cameraman at 25, Hard; horse at 50, Expert). I tick that box once you say they feel right | I can't judge how hard a puzzle feels to a person |

## Prototype results

The real pipeline, run in Node on the five samples (decoded with ImageMagick; the browser's decode may shift a few cells). These are the default settings: full crop, Auto cutoff.

| Sample | 10 | 15 | 20 | 25 | 30 | 40 | 50 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| skyline | Easy | Easy | Easy | Medium | Medium | Medium | Hard |
| cat | Easy | Easy | Easy | Medium | Medium | Hard | Hard |
| sailboat | Easy | Easy | Medium | Medium | Medium | Hard | Expert |
| cameraman | Easy | Medium | Medium | Hard | Hard | Expert | fails |
| horse | fails | Medium | Medium | fails | fails | fails | Expert |

- Every failing run (5 of 35) is Ambiguous with 4–21 cells undetermined. Each gets three passing suggestions, and auto-fix solves each with 1–2 flips: at most 1.3% of cells (horse at 10x8), and 0.2% or less on the others.
- Valid random grids reach a depth of 3.8 at 10x10 (Hard) and 21 at 30x30 (Expert). Photos stay between 1.0 and 2.1.

## Files

```
src/core/solver/difficulty.ts       # difficulty(result)
src/core/solver/difficulty.test.ts  # Node
src/core/io/project.ts              # optional difficulty, written only
src/core/io/project.test.ts         # written when given; ignored on parse
src/ui/samples/*.jpg                # five samples
src/ui/samples/README.md            # sources and licences
src/ui/samples/draw.py              # draws cat, sailboat, skyline
src/ui/samples.browser.test.ts      # moved M10/M11 criteria, rating order
src/ui/Compare.tsx                  # photo and grid canvases, overlay
src/ui/Creator.tsx                  # badge, samples and tips, compare, save, print prop
src/ui/PrintView.tsx                # difficulty in page 1's heading
src/ui/app.css                      # samples row, compare layout and overlay
src/ui/Creator.browser.test.tsx     # badge, samples, compare, print, save cases
docs/user-stories.md, docs/project-spec.md  # ticks; decided formula
```

## Steps

1. **`difficulty.ts`:** the score and labels as in the table, exporting the thresholds for the tests.
2. **Samples:** copy the two scikit-image pictures in, resized and saved as JPEGs, and run `draw.py` for the other three. Write the README.
3. **Creator:** add the badge (from `check.result`), the samples row and tips, `Compare`, `difficulty` in `save()`, and the `difficulty` prop on `PrintView`.
4. **`Compare.tsx`:** the photo canvas draws the crop with `drawImage` from a canvas holding the image. The grid canvas is drawn at the same pixel size. Both redraw when the image, crop or grid changes.

## Tests

`difficulty.test.ts` (Node):

| Case | Expected |
| --- | --- |
| A result that is stuck or a contradiction | `null` |
| Hand-made solved results just under and at 20, 35 and 55 | Easy / Medium, Medium / Hard, Hard / Expert |
| The same picture scaled from 10x10 to 50x50 (a ring) | Ratings never fall as the size grows |
| At one size, a picture that solves in one pass vs. a random Valid grid needing several | The second rates at least as high |

`project.test.ts`: `difficulty` appears in the JSON when given and not otherwise; a file with or without it parses to the same project.

`samples.browser.test.ts` (Chromium, the real decoder):

| Case | Expected |
| --- | --- |
| Each sample at width 20, default settings | Valid, and fill between the dull bounds |
| Each sample across widths 10–50 | Ratings of the Valid runs never fall as the width grows |
| The failing runs | At least one exists. At least one gets a suggestion, which re-checked is Valid. More than half pass after auto-fix with under 2% flipped |

`Creator.browser.test.tsx`:

| Case | Expected |
| --- | --- |
| Square image (Valid) | "Difficulty: Easy (estimate)" next to the verdict |
| Failing image | No difficulty text |
| Fresh page, click the Horse sample | The crop box and a Valid verdict appear |
| Sample click with edits, confirm refused | Nothing changes |
| Tips | Mention contrast, plain backgrounds and cropping tight |
| Compare on an image with a black square | A pixel inside a filled cell is dark on both canvases, and one in an empty cell is light on both. With Overlay on, the grid canvas has opacity 0.5 and the same box as the photo |
| Print view | Page 1's heading includes the difficulty; the solution page's doesn't |
| Save on a Valid puzzle | The JSON has `"difficulty"` |

Production check (Playwright on the built app): in a fresh context, click each sample, check the verdict and badge, and take a screenshot of the samples row and of the compare view with Overlay on.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| A badge labelled as an estimate on every Valid puzzle, none otherwise | Badge tests |
| Ratings rise with size and complexity across the samples; thresholds tuned | Sample rating-order test, prototype table, and your play check |
| Difficulty in the print view and the JSON | Print and save tests; project test |
| A first-time visitor sees the samples and loads one in one click | Sample click test; production check in a fresh context |
| Tips cover contrast, plain backgrounds, cropping tight | Tips test |
| Compare: side by side, and the overlay at 50% aligned with the photo | Compare pixel and overlay tests; screenshot |
| Bundled images are owned or public domain, with sources noted | `src/ui/samples/README.md` |
| A failing sample gets a passing suggestion (from M10) | Samples test |
| Most failing samples pass after auto-fix with < 2% flipped (from M11) | Samples test |

## Out of scope for M16

Dragging or zooming in the compare view; a difficulty rating for non-Valid puzzles; sample titles filled in automatically (a title could give the picture away when shared on paper); and more samples or categories.

## Risks

- **A heuristic:** the score knows nothing about which line deductions people find hard. Your play check is the real test, and the thresholds are one line to change.
- **Few photos:** only two samples are photographs. If you have photos of your own (yours to share), they can replace the drawn ones; the tests run against whatever is in the folder.
- **First-visit weight:** the five thumbnails are the full files, about 220 KB, downloaded on every visit.
