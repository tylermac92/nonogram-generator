# M14 Implementation Plan — Basic Play Mode

Plan for the fourteenth user story in `docs/user-stories.md`:

> As a player, I want to solve a puzzle right in the browser with mouse, keyboard, or touch, so that I don't need to print it.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Where play lives | A "Play this puzzle" button in the creator opens `PlayView` in place of the creator, the same way the print view does: the creator stays mounted but hidden, and "Back to editor" returns to it. `PlayView` takes only a `Puzzle` and a title, so M15's shared links can open it on their own | Reuses M13's pattern; nothing in play depends on the creator |
| Board canvas | The creator's `Preview` becomes the shared grid canvas instead of a second copy. New props: `cells` (what to draw; defaults to the solution), `paintValue(cell, mark)` (the value a stroke paints, given the first cell and whether it is a mark; `null` ignores it), `lockAxis`, and `label` (the accessible name). Without these props the creator works exactly as now | Layout, hit-testing, line filling, the keyboard cursor, clues and grid lines are already written and tested; play needs different cell drawing and painting rules, not another canvas |
| Cell states | A board is a `Uint8Array`: 0 empty, 1 filled, 255 X. An X is drawn as a grey cross | 255 keeps 1…N free for palette colours later, at no extra cost |
| Mouse | Left button: fill, or clear if the first cell is already filled. Right button: X, or clear if the first cell is already X. The whole stroke paints the first cell's result. The context menu is suppressed on the board | "Left-click fills, right-click marks X, clicking again clears" |
| Axis lock | With `lockAxis`, the first move away from the starting cell picks the row or the column (whichever the pointer moved further along). Later moves are projected onto that line, so diagonal drift still paints along it. The projection is a pure `alongAxis` in `layout.ts` | "Paints along the row or column where the drag started, even if the pointer drifts diagonally" |
| Touch | A Fill / X toggle above the board (two buttons with `aria-pressed`). With X selected, a tap or drag marks X, whatever the input. The canvas already has `touch-action: none`, so the page doesn't scroll or zoom while painting | The spec's toggle; long-press is unreliable on phones |
| Keyboard | The existing cursor: arrow keys move it, Space fills or clears, X marks or clears. Each key press is one undo step | The criterion, using the cursor the creator already has |
| Undo and redo | M8's `history.ts` with board snapshots: one step per stroke or key press. Undo and Redo buttons, plus Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z. The creator's own shortcut listener does nothing while play or print is open | Same pattern and limit (100 steps) as the creator. Without the guard, Ctrl+Z in play would also undo hidden creator edits |
| Check | `mistakes(puzzle, board)` returns the filled cells that are empty in the solution. X marks and empty cells never count. Check shows "2 cells are filled wrongly (shown in red)." or "No mistakes so far.", and tints those cells red until the next move | Reports the count and highlights the cells, as the criterion asks |
| Solved | `isSolved(puzzle, board)`: every row's and column's filled runs match their clues. It is checked after every move and shows "Solved — well done!" | Matching the clues, not the stored solution, also accepts a different correct answer to a puzzle that isn't unique |
| Pure logic | `mistakes`, `isSolved` and the cell-state constants go in `core/puzzle/board.ts`, tested in Node | Core stays free of React, as the spec requires |

## Files

```
src/core/puzzle/board.ts          # EMPTY/FILLED/CROSS, mistakes, isSolved
src/core/puzzle/board.test.ts     # Node
src/ui/layout.ts                  # alongAxis
src/ui/layout.test.ts             # alongAxis cases
src/ui/Preview.tsx                # cells, paintValue, lockAxis, label; X drawing; right button; X key
src/ui/PlayView.tsx               # board state, history, toolbar, Check, solved message
src/ui/Creator.tsx                # Play this puzzle; shortcut guard while away
src/ui/app.css                    # toolbar spacing, pressed toggle
src/ui/Creator.browser.test.tsx   # play cases
```

## Steps

1. **`board.ts`** with Node tests.
2. **`alongAxis(start, cell, width, axis)`** with tests.
3. **`Preview`:** add the props with defaults that keep the creator unchanged, and run the full existing suite.
4. **`PlayView`:** state, toolbar, status line, keyboard shortcuts.
5. **`Creator`:** button, `playing` state, hidden `<main>`, shortcut guard.

## Tests

`board.test.ts` (Node):

| Case | Expected |
| --- | --- |
| Empty board | Not solved; no mistakes |
| A filled cell that should be empty, plus X marks on cells that should be filled | 1 mistake; the X marks don't count |
| The solution with X marks on every empty cell | Solved |
| A different board that matches every clue (the ambiguous diagonal, swapped) | Solved |

`layout.test.ts`: `alongAxis` keeps a diagonal drift on the start row (axis "row") or column (axis "column").

`Creator.browser.test.tsx` (play, on a 15×15 heart drawn as a grid image):

| Case | Expected |
| --- | --- |
| Left-click, right-click, then click again | Filled, X, then cleared (pixel checks) |
| Drag from (0,0) that drifts diagonally to (5,2) | Only row 0, cells 0–5, are filled |
| X mode, then a touch-type stroke | The cells get X marks; the page didn't scroll |
| Arrow keys plus Space and X | The cursor moves; Space fills, X marks |
| A stroke, then Undo, then Redo | The whole stroke goes away and comes back in one step each |
| Fill two wrong cells and mark an X on an empty cell, then Check | "2 cells are filled wrongly"; both are tinted red |
| Solve the whole 15×15 with mouse strokes, once more with the keyboard only, once more with touch strokes in Fill mode | "Solved — well done!" each time |
| Ctrl+Z in play, then Back to editor | The creator's edits are untouched |

Production check (Playwright on the built app, emulating a phone at 390 × 844 with touch): solve the 15×15 using only taps and touch drags, toggling X mode along the way. It must show the solved message, and the page's scroll position must not change.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Left fills, right marks X, clicking again clears | Click test |
| Drag locked to the start row or column | Drift test; `alongAxis` Node test |
| Touch uses the Fill/X mode; no scroll or zoom while painting | Touch stroke test; `touch-action: none`; phone check |
| Arrow keys, Space, X | Keyboard test |
| Undo/redo per move, strokes as one step | Undo test |
| Check counts wrong filled cells, can highlight; X never wrong | Check test; `mistakes` Node test |
| Solved message | Full-solve tests; `isSolved` Node tests |
| 15×15 solvable with mouse, keyboard, and on a phone | Three full-solve tests; phone check |

## Out of scope for M14

Pinch-zoom and pan for big boards on phones, greying out completed clues, row and column highlighting, a timer, autosaved progress and a win animation (all comfort features for later), and reaching play without the creator (M15).

## Risks

- **Small cells on phones:** cells shrink to fit but never below 14 px. A 15×15 fits a 390 px phone at about 18 px per cell. Above about 20 cells wide the board scrolls sideways until pinch-zoom exists.
- **Right-click in the creator:** the shared canvas now ignores the right button in the creator (its `paintValue` has no X), which used to toggle a cell like the left button.
