# M7 Implementation Plan — Crop and Sizing

Plan for the seventh user story in `docs/user-stories.md`:

> As a creator, I want to crop to my subject and choose the puzzle size, so that the picture stays recognizable at small grid sizes.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Settings state | One `Settings` object in `Creator`: `crop`, `square`, `width`, `cutoff`, `invert`, `brightness`, `contrast`, updated through a single `update(partial)` helper | The story says these get saved later. M12 serializes this one object instead of gathering seven `useState`s |
| New image | Resets every setting to its default (crop = whole image, square off, Auto cutoff, brightness and contrast 0, Invert off), except the width | A crop or cutoff from the last image means nothing for the new one; the width is a preference |
| Crop coordinates | Whole source pixels, as a `Rect` from M4 | `downscale` already takes a crop rectangle, so the pipeline needs no change |
| Crop display | The decoded image drawn once onto a `<canvas>` with `putImageData`, shown at most 480 × 360, with the display size set explicitly in pixels (CSS max sizes inside the flex layout left the frame wider than the image, which misplaced the box). The crop box is a `div` positioned in percentages of the image size, so it scales with the canvas for free. A large `box-shadow` darkens everything outside the box | Reuses the `RgbaImage` we already have; no object URLs to manage; one CSS line for the dimmed surround |
| Crop interaction | Drag inside the box to move it; drag one of four corner handles to resize it. On `pointerdown`, the component listens for `pointermove` and `pointerup` on `window` and removes the listeners on release. Each move applies the total pointer movement since the drag started to the crop as it was when the drag started | Window listeners keep the drag alive when the pointer leaves the box, and also work with synthetic test events (pointer capture rejects test pointer ids). Measuring from the drag start avoids rounding drift |
| Crop keyboard | The box is focusable. Arrow keys move it by 2% of the image's shorter side; Shift+arrows resize it from the bottom-right corner | Keeps the crop usable without a mouse. The box has an `aria-label` that names these keys |
| Crop geometry | Pure functions in `src/ui/crop.ts`: `moveCrop`, `resizeCrop` and `squareCrop`. They clamp to the image and keep each side at least 10 source pixels | All edge cases are tested in Node; the component only converts pointer pixels to source pixels |
| Square lock | Turning it on calls `squareCrop`: the side becomes the shorter of the crop's two sides, centered on the old center and moved back inside the image if needed. While locked, a corner drag sets the side from whichever axis moved further (so dragging inward shrinks it), limited by the room left inside the image | Keeps 1:1 at all times, and the crop never leaves the image |
| Presets | Buttons 10, 15, 20, 25, 30, 40, 50 set the width and turn the square lock on (squaring the crop) | Exactly as the story says |
| Height and width max | `gridSize(crop, width)` in `layout.ts` replaces M5's `gridHeight`. With `ratio = crop.height ÷ crop.width`: `maxWidth` = the largest width in 5–50 with `round(width × ratio) ≤ 50` (at least 5); the effective width = `min(width, maxWidth)`; `height = round(width × ratio)`, clamped to 5–50 | The width slider's `max` is `maxWidth`, and the stored width isn't changed, so it comes back once the crop gets less tall. Clamping still covers crops so extreme (taller than about 10:1, or wider than 10:1) that no width keeps the exact ratio |
| Brightness and contrast | Two sliders, −100 to 100, starting at 0. `adjust` runs after `downscale`. **Otsu runs on the values before adjustment**, and the cutoff is applied to the adjusted values | Brightness and contrast are monotonic, so if Otsu ran after them, Auto would move the cutoff right along with the values and both sliders would appear to do nothing. With Otsu before them, Auto picks the cutoff from the image, and the sliders push cells across it |
| Downscale cost | A crop drag re-runs `downscale` on every pointer move, on the main thread | Work is proportional to the cropped area (at most 4 megapixels), a few milliseconds on a laptop, and browsers already deliver pointer moves at most once per frame |

## Files

```
src/ui/
  crop.ts                  # moveCrop, resizeCrop, squareCrop (pure)
  crop.test.ts             # Node
  CropBox.tsx              # image canvas, crop box, handles, pointer and keyboard
  layout.ts                # gridSize replaces gridHeight
  layout.test.ts           # gridSize cases replace gridHeight cases
  Creator.tsx              # Settings object, crop panel, presets, square lock, brightness, contrast
  app.css                  # crop panel styles
  Creator.browser.test.tsx # crop, preset, square, brightness/contrast cases
```

## Steps

### 1. `crop.ts`

```ts
type Corner = 'nw' | 'ne' | 'sw' | 'se';
moveCrop(crop: Rect, dx: number, dy: number, imageWidth: number, imageHeight: number): Rect
resizeCrop(crop: Rect, corner: Corner, dx: number, dy: number, imageWidth: number, imageHeight: number, square: boolean): Rect
squareCrop(crop: Rect, imageWidth: number, imageHeight: number): Rect
```

- `moveCrop` keeps the size and clamps the position inside the image.
- `resizeCrop` keeps the opposite corner fixed. It moves the dragged corner by (dx, dy), clamps it inside the image, and keeps each side at least 10 pixels (the corner can't cross over the fixed one). When `square` is on, the side comes from the axis that moved further, then limited by the room from the fixed corner to the image edges in the drag direction.
- `squareCrop` is described in the table above.
- All results are rounded to whole pixels.

### 2. `layout.ts`

`gridSize(crop: Rect, width: number): { width, height, maxWidth }` as described in the table. `previewLayout` is unchanged.

### 3. `CropBox.tsx`

- Props: `image`, `crop`, `square`, `onChange(crop)`.
- A `useEffect` on `image` draws it onto the canvas.
- Box style: `left`, `top`, `width` and `height` as percentages of the image size.
- Each handle carries its corner name; the box itself means "move".
- Scale from screen to source pixels = `image.width ÷ canvas.getBoundingClientRect().width`, read when a drag starts.

### 4. `Creator.tsx`

The pipeline becomes:

```
gray → values = downscale(gray, crop, size.width, size.height)
     → auto = otsu(values)
     → adjusted = adjust(values, brightness, contrast)
     → cleaned → grid → puzzle
```

Each stage keeps its own `useMemo` so a brightness drag never re-runs the downscale.

New controls:
- the crop panel, to the left of the sliders;
- the "Lock to square" checkbox;
- the preset buttons;
- Brightness and Contrast sliders, each labelled with its value.

The width slider's `max` becomes `size.maxWidth`, and its label shows the effective width.

## Tests

`crop.test.ts` (Node), using a 200×100 image:

| Case | Expected |
| --- | --- |
| Move past each edge | Clamped flush with that edge, size unchanged |
| Resize each corner by (+10, +10) and (−10, −10) | The opposite corner stays put; sides change by 10 |
| Shrink past the minimum, or drag across the fixed corner | Side stays 10 |
| Resize the `se` corner far past the image | Clamped at the image edge |
| Square resize with (dx, dy) = (30, 5) | Both sides grow by 30; with too little room, the side is limited by the nearer image edge and stays square |
| `squareCrop` on a 100×40 crop at the left edge | 40×40, centered on the old center |
| `squareCrop` on the whole 200×100 image | 100×100, centered horizontally |

`layout.test.ts` (Node):

| Case | Expected |
| --- | --- |
| Square crop | `height === width`, `maxWidth === 50` |
| 200×100 crop at width 20 | height 10 (M5's case still holds) |
| 100×300 crop | `maxWidth` 16 (16 × 3 = 48, 17 × 3 = 51); width 30 → width 16, height 48 |
| 10×1000 crop (ratio 100) | `maxWidth` 5, height clamped to 50 |
| 1000×10 crop at width 50 | height clamped to 5 |
| Property: 1,000 seeded random crops (1–2048 px per side) and widths 5–50 | `5 ≤ height ≤ 50` and `5 ≤ width ≤ maxWidth ≤ 50` every time |

`Creator.browser.test.tsx` additions (synthetic 200×100 PNGs, as before):

| Case | Expected |
| --- | --- |
| Drag the crop box's `nw` handle right until the crop is 10 px wide | The width slider's `max` becomes 5 and the label reads "Width 5 (height 50)"; the preview is "5 by 50" |
| Drag the `se` handle up until the crop is 10 px tall | The preview is "20 by 5" (round(20 × 10 ÷ 200) = 1, clamped to 5) |
| Drag the box (after shrinking it) | The preview changes as the drag moves (checked mid-drag, before `pointerup`) |
| Arrow and Shift+arrow keys on the focused crop box | The crop moves, then resizes; the preview label follows |
| "Lock to square" | The preview becomes N by N, and stays square after a corner drag |
| Preset 30 | Width 30, lock checked, preview "30 by 30" |
| Brightness −100 in Auto mode | Every cell is filled (white becomes 127, below the cutoff of 128), so the "Nearly all cells are filled" warning shows |
| Contrast −100 | Every cell becomes 128, so the grid is uniform and a "Nearly all cells are …" warning shows |

The drags dispatch `PointerEvent`s with screen coordinates computed from the canvas's bounding box.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Dragging or resizing the crop box updates the preview live | Mid-drag check in the drag test, plus the handle tests |
| Height = round(width × crop height ÷ crop width), always 5–50 | `gridSize` cases and the 1,000-case property test |
| For a very tall crop, the width max drops so height ≤ 50; for a very wide crop, height ≥ 5 | 100×300 and 10×1000 cases in Node; the tall and wide handle-drag tests in Chromium |
| Lock to square keeps 1:1; each preset sets the width and turns the lock on | `squareCrop` and square-resize tests; square and preset browser tests |
| Brightness and contrast change the preview and are part of the saved settings | Brightness and contrast browser tests; both are fields of the `Settings` object that M12 will save |

## Out of scope for M7

Edge handles (only corners for now), touch pinch-to-crop, a reset-crop button, and saving the settings (M12). Changing the grid size doesn't need a confirmation yet: the manual edits it would clear arrive in M8.

## Risks

- **Crop drags on large photos** re-run the downscale on the main thread with every move. If that stutters on slow machines, move the downscale into the M6 worker.
- **Otsu before adjustment** is a deliberate departure from a literal reading of the spec's step order. It is a one-line change to swap back if you'd rather have Auto follow the adjusted values.
