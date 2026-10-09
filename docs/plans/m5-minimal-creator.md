# M5 Implementation Plan — Minimal Creator

Plan for the fifth user story in `docs/user-stories.md`:

> As a creator, I want to drop in an image and immediately see it as a nonogram grid, so that I can judge whether the image will make a good puzzle.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Pipeline wiring | One `Creator` component. Each pipeline stage is a `useMemo` keyed on its own inputs: `gray` on the image; `values` on gray and width; the grid on values, cutoff, and invert; the puzzle on the grid | This is the spec's "only re-run what changed" with no extra code. A cutoff drag never re-runs the downscale, and a new image never re-decodes |
| Where it runs | Main thread. A width change re-runs one downscale of at most 2048 × 2048 pixels; a cutoff change touches at most 2,500 cells | Fast enough to keep up with a slider drag. The worker arrives in M6, for the solver only |
| Height | `round(width × image height ÷ image width)`, clamped to 5–50 | The whole image is used in M5. M7 replaces this with crop-based sizing and a shrinking width maximum; until then, extreme aspect ratios get stretched |
| Width | Slider 5–50, starting at 20 | 20 gives a recognizable first preview and is quick to solve |
| Cutoff | State is `number \| null`; `null` means Auto. The slider shows `cutoff ?? otsu(values)`; moving it stores a number; the Auto button sets it back to `null` | Auto keeps following Otsu as the width changes, and a manual value stays put |
| Cleanup | Always on (the spec's default); no toggle yet. Runs *before* invert: threshold without invert, cleanup, then complement the grid if Invert is on | No milestone asks for the toggle. Cleaning first makes Invert an exact swap; the spec's order (invert, then cleanup) could differ by a few border cells, because a border speck is removed but a border hole is never filled |
| Fill warning | When more than 90% or less than 5% of cells are filled, show "Nearly all cells are filled/empty — the puzzle will be dull" | The spec asks for it, and the M4 plan deferred it to M5; one line of JSX |
| Preview | One `<canvas>` sized to the clue areas plus the grid, scaled by `devicePixelRatio` so text stays crisp. Bold rule every 5 cells | The spec says canvas, not 2,500 DOM cells. The 5-cell rules make 50x50 grids countable |
| Clue sizing | The left clue area is as wide as the longest row clue and the top area as tall as the longest column clue, one cell per number. Cell size = largest that fits the available width, never below 14 px; below that, the preview scrolls sideways | Readable at 50x50: 14 px cells with a 9 px font fit two-digit clues. The creator targets ≥ 1024 px screens (spec) |
| Accessibility | The canvas gets `role="img"` and an `aria-label` such as "Puzzle preview, 20 by 15". The controls are native `<input type="file">`, `<input type="range">`, `<input type="checkbox">` and `<button>`, each with a visible label | Native controls are keyboard- and screen-reader-ready for free |
| Input | A visible file input plus a drop zone around the whole creator. `dragover` calls `preventDefault` so a drop outside the preview doesn't navigate away from the page | One drop handler covers the whole screen |
| Stale decodes | A ref counter: each new file takes the next id, and a decode that finishes after a newer one started is ignored | Dropping two images quickly can't show the older one |
| Unsupported files | If `decodeImage` rejects, show "Couldn't read this file. Try a JPEG or PNG." and keep the previous image | One message covers HEIC, PDF and corrupt files; whatever the browser can decode is accepted (spec) |
| UI tests | Vitest browser mode (already set up in M4). Render with `react-dom/client`'s `createRoot` and use `page`, `userEvent` and `expect.element` from `vitest/browser`. No new dependency | Real file upload, decode and layout need a real browser; jsdom has no `createImageBitmap` |

## Files

```
src/main.tsx                     # also imports ui/app.css
src/ui/
  App.tsx                        # heading + <Creator />
  Creator.tsx                    # state, file input, drop zone, sliders, messages
  Preview.tsx                    # <canvas> that draws a Puzzle
  layout.ts                      # pure: gridHeight, previewLayout
  layout.test.ts                 # Node
  app.css                        # minimal layout and control styles
  Creator.browser.test.tsx       # Chromium, end to end
vite.config.ts                   # browser project includes *.browser.test.tsx
```

## Steps

### 1. `layout.ts` (pure, Node-tested)

- `gridHeight(imageWidth, imageHeight, width): number`: the height rule above.
- `previewLayout(puzzle, availableWidth): { cell, clueCols, clueRows, width, height }`:
  - `clueCols` = the longest row clue (number of runs, with a minimum of 1 for "0");
  - `clueRows` = the same for the columns;
  - `cell` = `max(14, floor(availableWidth / (puzzle.width + clueCols)))`, capped at 32 so tiny grids don't become huge;
  - `width` and `height` are the canvas size in CSS pixels.

### 2. `Preview.tsx`

- Props: `puzzle`. It measures its container's width once on mount and on window resize, so the cell size follows the window.
- In a `useEffect`, set the canvas size to the layout × `devicePixelRatio`, `ctx.scale(dpr, dpr)`, then draw:
  1. a white background;
  2. filled cells in black;
  3. thin grey grid lines, a darker line every 5 cells, and a black outer border;
  4. clues from `clueLabels`, right-aligned in the left area and bottom-aligned in the top area, in a font of `0.6 × cell` px.
- `role="img"` and the `aria-label` from the table above.

### 3. `Creator.tsx`

State: `image: RgbaImage | null`, `width` (20), `cutoff: number | null` (null), `invert` (false), `error: string | null`.

```ts
const gray = useMemo(() => image && toGray(image), [image]);
const height = gray ? gridHeight(gray.width, gray.height, width) : 0;
const values = useMemo(() => gray && downscale(gray, wholeImage(gray), width, height), [gray, width, height]);
const auto = useMemo(() => values && otsu(values), [values]);
const cleaned = useMemo(() => values && cleanup(threshold(values, width, height, cutoff ?? auto!, false)), [values, cutoff, auto, width, height]);
const grid = useMemo(() => cleaned && (invert ? complement(cleaned) : cleaned), [cleaned, invert]);
const puzzle = useMemo(() => grid && makePuzzle(grid), [grid]);
```

- **File handling:** `onFile(file)` takes the next decode id, calls `decodeImage`, and on success, if the id is still current, sets `image`, clears `error`, and resets `cutoff` to `null`, since a manual cutoff from the last image means nothing for the new one. On failure it sets the error message.
- **Controls**, in this order:
  - the file picker (`accept="image/*"`) with the hint "or drop an image anywhere";
  - Width, a range input from 5 to 50, labelled with its value, for example "Width 20 (height 15)";
  - Cutoff, a range input from 0 to 255, labelled with its value and "(auto)" while it is `null`, with the Auto button next to it;
  - the Invert checkbox.

  The sliders and Invert are disabled until an image loads.
- **Messages:** the error message and the fill warning, both in a `role="status"` element so screen readers announce them.
- **Before the first image:** a dashed drop-zone box saying "Drop an image here or choose a file".

### 4. Styling (`app.css`)

System font, a column of controls above the preview, `max-width: 1200px` centered, and `overflow-x: auto` on the preview wrapper. Nothing else.

### 5. Test config

In `vite.config.ts`, the browser project includes `src/**/*.browser.test.{ts,tsx}`, and the unit project excludes the same pattern.

## Tests

`layout.test.ts` (Node):

| Case | Expected |
| --- | --- |
| `gridHeight` on 200×100, 400×400 and 100×300 images at width 20 | 10, 20, 50 (clamped from 60) |
| `gridHeight` at width 5 on a 1000×100 image | 5 (clamped from 1) |
| `previewLayout` on a 50x50 checkerboard (25 clues per line) at 1200 px and at 900 px | `clueCols = clueRows = 25`; `cell = 16` (1200 ÷ 75) and `cell = 14` (900 ÷ 75 = 12, raised to the minimum) |
| `previewLayout` on an all-empty 5x5 puzzle | `clueCols = clueRows = 1` (room for the "0") and `cell = 32` (capped) |

`Creator.browser.test.tsx` (Chromium). Each test renders `<App />` into a fresh container. The test image is a PNG drawn with `OffscreenCanvas`: a 200×100 white image with a black 100×60 rectangle centered in it, so its edges line up with cell edges at width 20.

| Case | Expected |
| --- | --- |
| Upload the PNG | The preview appears with the label "Puzzle preview, 20 by 10" in under 1 second, measured with `performance.now()` |
| Press End on the width slider | The label becomes "Puzzle preview, 50 by 25" |
| Cutoff starts on Auto | The cutoff slider's value equals what `otsu` returns for the same downscaled values (computed in the test from the same blob). After moving the slider to 10 and pressing Auto, it's back to that value |
| Invert | Read the canvas pixels: the center of a cell inside the rectangle is black before Invert and white after, and the reverse for a cell outside it. |
| Fill warning | With the cutoff at 255 every cell is filled, so the "Nearly all cells are filled" message appears |
| Unsupported file | Uploading a text blob named `photo.heic` shows the "Try a JPEG or PNG" message, and no preview appears |

To pass the 1-second check by a wide margin, a separate manual check uses a 12 MP phone photo on the deployed site. This is noted in the PR rather than automated, because a large binary fixture isn't worth adding to the repo.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Dropping or choosing an image shows a grid preview within 1 second | Upload test with timing; manual phone-photo check on the deployed site, including one drag-and-drop |
| Moving the width or cutoff slider updates the preview while dragging, without visible lag | Range inputs update on every `input` event, and the `useMemo` stages keep cutoff drags off the downscale. Checked by hand on a 50x50 grid of a large photo |
| Cutoff starts at Otsu, and Auto restores it | Cutoff test |
| Invert swaps filled and empty cells in the preview and the clues | Invert pixel test. The clues are generated from the same grid by `makePuzzle`, which M2 already tests |
| Clues readable at 50x50, with clue areas sized to the longest clue | `previewLayout` tests (minimum 14 px cells; areas sized by the longest clue), plus a look at a 50x50 preview |
| An unsupported file shows a clear message suggesting JPEG or PNG | Unsupported-file test |

## Out of scope for M5

The solver and verdict (M6); crop, square lock, presets, the shrinking width maximum, and brightness and contrast (M7); manual edits (M8); a cleanup toggle; and the phone layout for the creator.

## Risks

- **Large images on slow machines:** each width step re-runs a downscale of up to 4 million pixels, which takes a few milliseconds on a laptop but could stutter on a low-end machine. If it does, cache `values` per width in a small map, or move the downscale into the M6 worker.
