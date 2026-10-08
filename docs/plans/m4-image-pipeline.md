# M4 Implementation Plan — Image Pipeline

Plan for the fourth user story in `docs/user-stories.md`:

> As a developer, I want a pure image-to-grid pipeline, so that any image becomes a grid predictably and can be tested without a browser UI.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Browser vs. pure code | Only `decodeImage` touches browser APIs. Every other step is a pure function on plain typed arrays and runs in Node | Matches the story; almost all logic is unit-tested without a browser |
| Grayscale before downscale | Convert full-resolution pixels to luminance once per image, then area-average the single channel | Luminance is a weighted sum, so averaging then converting equals converting then averaging. One channel is 3x less work, and the gray image is cached per image while only the downscale re-runs per crop and size |
| Transparency | Composited onto white in the grayscale step: `gray = lum × a + 255 × (1 − a)` (with `a` in 0–1) | Pure math, so it's testable in Node; the spec only says "flatten onto white" |
| Size cap | `decodeImage` resizes to at most 2048 px on the long side with `createImageBitmap`'s `resizeQuality: 'high'` | One browser call; the grid downscale still uses our own area averaging, as the spec requires |
| Crop parameter | `downscale` takes a source rectangle now; M4 passes the whole image | It's the same loop either way, and M7 then needs no signature change or test rewrite |
| Cell values | `Float32Array`, 0–255, one per grid cell | Keeps averages exact (a 1-px checkerboard gives exactly 127.5) |
| Brightness and contrast | Both range −100…100. `v' = (v − 128) × (100 + contrast) / 100 + 128 + brightness × 1.28`, clamped to 0–255. (0, 0) is the identity | Simple and predictable; contrast −100 flattens to mid-gray |
| Threshold | Filled when `value < cutoff`, and `invert` flips it (spec). `otsu` returns the cutoff that maximizes between-class variance over a 256-bin histogram. A single-tone input returns 128 | Spec's rule, with defined behavior on single-tone inputs |
| Cleanup | Computed from the input grid, not in place. A filled cell with no filled orthogonal neighbor becomes empty. An empty cell whose 4 neighbors are all inside the grid and filled becomes filled. Cells on the border are never holes | Deterministic and order-independent; matches "isolated cells and single-cell holes" exactly |
| Browser tests | Vitest browser mode (`@vitest/browser-playwright`, headless Chromium) for `*.browser.test.ts` only; everything else stays in Node | EXIF orientation and real PNG decoding can only be checked in a browser. CI gains one Chromium install step |

## Files

```
src/core/image/
  types.ts                  # RgbaImage, GrayImage, Rect
  pipeline.ts               # toGray, downscale, adjust, otsu, threshold, cleanup
  pipeline.test.ts          # Node tests on synthetic images
  decode.ts                 # decodeImage (browser only)
  decode.browser.test.ts    # Chromium tests with real image files
  fixtures/
    exif-rotated.jpg        # stored landscape, EXIF Orientation 6
    transparent.png         # black square on a transparent background
    README.md               # how the fixtures were made (Pillow one-liners)
```

## Steps

### 1. Types (`types.ts`)

- `RgbaImage { width; height; data: Uint8ClampedArray }`: the browser's `ImageData` fits this shape, and tests can build one in Node, which has no `ImageData`.
- `GrayImage { width; height; data: Uint8ClampedArray }`: full-resolution luminance.
- `Rect { x; y; width; height }`: in source pixels; fractional values are allowed.

### 2. `decodeImage(file: Blob): Promise<RgbaImage>` (`decode.ts`)

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` decodes with EXIF rotation applied.
2. If the long side is over 2048 px, decode again from the first bitmap with `resizeWidth`/`resizeHeight` and `resizeQuality: 'high'`.
3. Draw it onto an `OffscreenCanvas`, call `getImageData`, then close the bitmaps.
4. If the browser can't decode the file (HEIC, PDF, …), the promise rejects. M5 turns that into the "use JPEG or PNG" message.

### 3. Pure steps (`pipeline.ts`)

| Function | Does |
| --- | --- |
| `toGray(image: RgbaImage): GrayImage` | Luminance `0.2126 R + 0.7152 G + 0.0722 B`, composited onto white by alpha |
| `downscale(gray, crop: Rect, gridWidth, gridHeight): Float32Array` | Area average. Each cell covers `crop.width / gridWidth` by `crop.height / gridHeight` source pixels, and pixels the cell only partly covers count by the covered fraction. Done in two separable passes (rows, then columns), so the cost is about one read per source pixel. It works for enlargement too: a cell inside one pixel gets that pixel's value |
| `adjust(values, brightness, contrast): Float32Array` | The formula above |
| `otsu(values): number` | The Otsu cutoff |
| `threshold(values, width, height, cutoff, invert): Grid` | Builds a `Grid` with M2's `createGrid` |
| `cleanup(grid): Grid` | The speck and hole rule above |

Each function returns a new array and never mutates its input, so M5 can cache any stage.

### 4. Browser test setup

- `npm i -D @vitest/browser-playwright playwright`.
- `vite.config.ts` gets two `test.projects`:
  - `unit` (Node): every `*.test.ts` except `*.browser.test.ts`;
  - `browser` (Chromium, headless): `*.browser.test.ts`.
- `npm test` runs both. CI adds `npx playwright install --with-deps chromium` before the tests.
- Locally, this container already has Chromium in `/opt/pw-browsers`. If its version doesn't match the installed `playwright`, point the browser project's `launchOptions.executablePath` at it through an environment variable, rather than downloading another copy.

### 5. Fixtures

Make both with Pillow (already in the dev container), and record the exact commands in `fixtures/README.md`:

- `exif-rotated.jpg`: 40x20 stored pixels, left half black and right half white, with EXIF Orientation 6 (display rotated 90° clockwise). Displayed, it's 20x40 with the top half black.
- `transparent.png`: 20x20, fully transparent except a black 10x10 square in the middle.

## Tests

`pipeline.test.ts` (Node, synthetic images built in the test):

| Case | Expected |
| --- | --- |
| Black 100x100 square centered on a white 200x200 image; grid widths 4, 8, 20, 40 (cell edges line up with the square) | Exactly the cells inside the square are filled, e.g. columns and rows 5–14 at width 20 |
| 256x256 1-px checkerboard downscaled to 8x8 | Every cell is exactly 127.5 (sampling would give 0 or 255) |
| 3-px checkerboard to a size that doesn't divide evenly (e.g. 300 → 7) | Every cell lies within 100–155, with no 0/255 aliasing |
| Upscale: 2x2 image to a 4x4 grid | Each source pixel's value fills its 2x2 block |
| Crop rectangle | Downscaling a sub-rectangle matches downscaling an image cut to that rectangle |
| `toGray` | Pure red/green/blue give 54/182/18 (rounded to whole numbers); alpha 0 → 255; black at alpha 128 → 127 |
| Two-tone values (clusters around 40 and 200, with noise) | `otsu` returns a cutoff between the clusters; single-tone input → 128 |
| `adjust` | (0, 0) is the identity; brightness moves values up and down and clamps; contrast −100 → all 128 |
| Invert | For random values and cutoffs, the inverted grid is the exact complement |
| Cleanup | An isolated cell is removed; a single-cell hole is filled; 2-cell runs (horizontal and vertical) and 2-cell holes are unchanged; an empty border cell next to filled cells is unchanged |

`decode.browser.test.ts` (Chromium):

| Case | Expected |
| --- | --- |
| `exif-rotated.jpg` | Decodes as 20x40; through `toGray` → `downscale` to 2x4 → `otsu` → `threshold`, the top two rows are filled and the bottom two empty |
| `transparent.png` | Corner pixels read 255 after `toGray`; the middle square reads near 0 |
| A 3000x1000 PNG made in the test with `OffscreenCanvas` | Decodes as 2048x683 |
| A non-image blob (text bytes) | The promise rejects |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| A black square centered on white converts to a filled block of the expected size at several widths | Black-square test at 4 widths |
| A large checkerboard downscales to mid-gray, not aliasing | Both checkerboard tests |
| Otsu picks a cutoff between the two peaks | Two-tone test |
| Invert gives the exact complement | Invert property test |
| Cleanup removes isolated cells and fills single-cell holes, and leaves 2-cell runs alone | Cleanup tests |
| A transparent PNG converts as if on white; a rotated phone photo converts upright | `toGray` alpha tests in Node, plus both fixture tests in Chromium |

## Out of scope for M4

Crop UI and height derivation (M7), manual edits (M8), the "nearly all filled or empty" warning (M5), and caching or re-running only the steps whose inputs changed (M5).

## Risks

- **CI time:** installing Chromium adds roughly a minute to each CI run. If that becomes a bother, cache `~/.cache/ms-playwright` keyed on the Playwright version.
- **Browser differences:** the tests run only in Chromium. Safari's and Firefox's EXIF and decode behavior isn't covered until we test manually in M5.
