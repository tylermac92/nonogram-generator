# M8 Implementation Plan — Manual Editing

Plan for the eighth user story in `docs/user-stories.md`:

> As a creator, I want to fix individual cells by hand, so that I can clean up details and resolve ambiguity myself.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Edit storage | `Edits = ReadonlyMap<number, CellValue>`: cell index → the value the creator chose. `applyEdits(grid, edits)` in `core/puzzle/grid.ts` copies the grid and writes each override; with no edits it returns the same grid object | The spec's sparse map, applied last. Returning the same object keeps the `puzzle` memo and the solver's result matching from M6 when nothing was edited. M12 saves it as `[...edits]` |
| Override meaning | An edit stores an absolute value, not a "flip". It stays in the map even if a later slider change makes the pipeline produce the same value | Edits survive cutoff, brightness, contrast and Invert exactly as the creator left them. An edited cell stays marked, so the creator can see which cells are theirs |
| Pipeline | `grid` (after Invert) → `edited = applyEdits(grid, edits)` → `puzzle`, each in its own `useMemo` | Slider changes re-run only up to `grid`; an edit re-runs only `applyEdits`, `makePuzzle` and the solver |
| Click and drag | On `pointerdown` over a grid cell, the new value is the opposite of what that cell shows now. Every cell the pointer then crosses gets that same value. Moves go through `window` listeners, as in the crop box. A move that skips cells (a fast flick) also paints the cells on the straight line between the last cell and the new one (`lineCells` in `layout.ts`). Moves outside the grid are ignored. The canvas gets `touch-action: none` | The story's rule, word for word. Line filling makes "every cell crossed" true even when the browser reports moves far apart |
| Pointer → cell | `cellAt(layout, x, y)` in `layout.ts` turns canvas coordinates into a cell index, or `null` over the clue areas or outside the grid. `Preview` computes the layout during render instead of only inside `draw`, so drawing and hit-testing use the same numbers | Pure and tested in Node; no second copy of the layout maths |
| Keyboard editing | The preview canvas is focusable. Arrow keys move a cell cursor (outlined in blue while the canvas has focus); Space or Enter toggles the cell under it | Editing must not be mouse-only. This is the smallest keyboard path; a full ARIA grid can come with play mode (M14) if needed |
| Undo history | `src/ui/history.ts`: `History<T> = { past, present, future }` with pure `record`, `undo` and `redo`. `record` keeps the last 100 past states. A whole stroke (pointer down to pointer up) is one step: the first cell calls `record`, later cells replace `present` | Snapshot history is the least code and can't drift out of sync. 100 maps of at most 2,500 entries is well under a megabyte |
| Undo and redo controls | A `keydown` listener on `window`: Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes. Undo and Redo buttons next to the verdict, disabled when there is nothing to undo or redo | The shortcuts are the story's; the buttons make the feature discoverable and testable without key combinations |
| Clearing edits | `confirmClear()` in `Creator`: with no edits it returns true; otherwise it asks `window.confirm("This clears your N edited cells. Continue?")`, and on OK empties the history and returns true. It guards the width slider, the presets, turning on Lock to square, and loading a new image. Cancel leaves everything as it was | Edits are stored by cell index, so they only mean something at one grid size and crop. Loading a new image is included because it would lose the edits just the same |
| Crop box and the prompt | `CropBox` gets an `onStart(): boolean` prop, called on `pointerdown` and on an arrow key. Creator passes "true if there are no edits; otherwise ask and return false". So after confirming, nothing moves until the next drag or key press | A modal dialog in the middle of a drag swallows the `pointerup`, which would leave the box stuck to the cursor. Asking before the drag starts avoids that |
| Edited-cell marker | `Preview` takes `edits` and draws a small blue square (a third of the cell) at the centre of each edited cell, after the undetermined tint | Blue shows on black, white and amber alike, and doesn't hide the cell's value |
| Hint | One line under the verdict: "Click or drag on the grid to edit cells, or use the arrow keys and Space. Ctrl+Z undoes." | Editing on a canvas isn't discoverable otherwise |

## Files

```
src/core/puzzle/
  grid.ts                  # Edits type, applyEdits
  grid.test.ts             # applyEdits cases
src/ui/
  history.ts               # record, undo, redo (pure)
  history.test.ts          # Node
  layout.ts                # cellAt, lineCells
  layout.test.ts           # cellAt, lineCells cases
  Preview.tsx              # pointer and keyboard editing, cursor, edited markers
  CropBox.tsx              # onStart prop
  Creator.tsx              # history state, applyEdits stage, confirmClear, shortcuts, buttons, hint
  app.css                  # touch-action and focus style on the preview canvas
  Creator.browser.test.tsx # editing cases
```

## Steps

### 1. `grid.ts`

```ts
export type Edits = ReadonlyMap<number, CellValue>;
export function applyEdits(grid: Grid, edits: Edits): Grid
```

### 2. `history.ts`

```ts
export interface History<T> { past: T[]; present: T; future: T[] }
export const historyOf = <T>(present: T): History<T>
export function record<T>(h: History<T>, next: T): History<T>  // past keeps the last 100
export function undo<T>(h: History<T>): History<T>             // no-op with an empty past
export function redo<T>(h: History<T>): History<T>             // no-op with an empty future
```

### 3. `layout.ts`

- `cellAt(layout, puzzle, x, y): number | null`, with `x` and `y` in CSS pixels from the canvas's top-left corner.
- `lineCells(from, to, width): number[]`: the cells on the straight line between two cell indexes, both ends included, stepping one cell at a time along the longer axis.

### 4. `Preview.tsx`

- New props: `edits?: Edits` and `onPaint?: (cells: number[], value: CellValue, start: boolean) => void`. Without `onPaint`, the preview is read-only, as before.
- `pointerdown` on a grid cell: `value = 1 - solution.cells[cell]`; call `onPaint([cell], value, true)`; then listen on `window` until `pointerup` or `pointercancel`. Each `pointermove` that lands on a different cell calls `onPaint(lineCells(last, cell, width), value, false)`.
- Keyboard: `tabIndex={0}`, a `cursor` state (starting at cell 0), arrow keys move it within the grid, Space and Enter call `onPaint([cursor], 1 - solution.cells[cursor], true)`. The cursor outline is drawn only while the canvas has focus.

### 5. `Creator.tsx`

```ts
const [history, setHistory] = useState(() => historyOf<Edits>(new Map()));
const edited = useMemo(() => grid && applyEdits(grid, history.present), [grid, history.present]);
const puzzle = useMemo(() => edited && makePuzzle(edited), [edited]);

function paint(cells: number[], value: CellValue, start: boolean) {
  setHistory((h) => {
    const next = new Map(h.present);
    for (const i of cells) next.set(i, value);
    return start ? record(h, next) : { ...h, present: next };
  });
}
```

- The fill warning keeps reading the edited grid, so it reflects what will be published.
- `confirmClear()` as described above, called at the top of the guarded handlers.
- A `useEffect` adds the window `keydown` listener for the undo and redo shortcuts and calls `preventDefault` on them.

## Tests

`grid.test.ts`, `history.test.ts` and `layout.test.ts` (Node):

| Case | Expected |
| --- | --- |
| `applyEdits` with no edits | The same grid object |
| `applyEdits` with {0 → 1, 5 → 0} on a 3×2 grid | Those two cells changed, the input grid untouched |
| `record` 150 times, then `undo` 150 times | 100 undos change the state; the rest are no-ops; the oldest reachable state is number 50 |
| `undo` then `redo` | Back to the same state; a `record` after an `undo` clears the future |
| `cellAt` on a 50x50 checkerboard layout | The top-left grid cell, the bottom-right cell, and `null` over the clue areas and past the edges |
| `lineCells` across a row, down a column, along a diagonal, and from a cell to itself | The expected cell lists, both ends included |

`Creator.browser.test.tsx` additions (the M5 square image unless noted):

| Case | Expected |
| --- | --- |
| Click an empty cell | It turns black and shows the blue marker; the verdict reads "Checking…" and then a fresh verdict |
| Drag along row 0 from an empty cell, with one move that jumps four cells | Every cell crossed is black, including the skipped ones |
| Drag along a row starting on a filled cell | Every cell crossed becomes empty, including the empty cells it crosses |
| Edit two cells, then change the cutoff, brightness, contrast, and Invert in turn | Both edited cells keep their values each time, while Invert flips the cells around them |
| Ctrl+Z, then Shift+Ctrl+Z, after one click and one drag | The drag is undone as one step, then redone |
| Width change with edits; `window.confirm` stubbed to return false, then true | False: the width and the edits stay. True: the width changes and the markers are gone |
| Crop drag with edits, confirm stubbed true | The first drag only clears the edits; the second drag moves the crop |
| Space on the focused preview, then ArrowRight and Space | Cells 0 and 1 are toggled |
| The M6 diagonal image (200 undetermined), then click one cell of the top-left block | The verdict changes from "200 cells undetermined" to a different verdict |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Click toggles a cell; dragging paints every crossed cell with the first cell's new value | Click and both drag tests, including the skipped-cell jump; `lineCells` cases |
| Edits survive cutoff, brightness, contrast and Invert | The slider and Invert test |
| Changing the grid size or crop asks before clearing edits | Width and crop tests with `window.confirm` stubbed |
| Undo and redo with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, at least 100 steps | The shortcut test in Chromium; the 150-step `history` test in Node |
| The verdict and tint update after each edit; edited cells are marked | The click and diagonal-image tests (verdict text and the blue marker pixel) |

## Out of scope for M8

Keeping edits when the size changes (by rescaling them), a "Clear edits" button, saving edits (M12), screen-reader announcements of the cursor's cell, and undo for slider changes.

## Risks

- **Prompt after a crop press:** after confirming, the creator has to start the drag again. Documented above as the price of not getting stuck mid-drag.
- **Undo shortcuts on the whole page:** Ctrl+Z is taken over everywhere on the creator. There are no text fields yet; when M12 adds a title field, the listener must skip key presses inside it.
