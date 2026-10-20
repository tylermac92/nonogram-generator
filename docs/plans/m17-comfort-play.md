# M17 Implementation Plan — Comfort Play

Plan for the seventeenth user story in `docs/user-stories.md`:

> As a player, I want the conveniences of a real puzzle app, so that large puzzles are pleasant to solve, especially on a phone.

Six independent features, built and committed one at a time in this order: zoom and pan, clue grey-out, highlight, timer, autosave, win animation.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Zoom and pan | **The browser's own pinch-zoom.** In play mode the board's canvas gets `touch-action: pinch-zoom` instead of `none`. One finger still paints; two fingers zoom and pan the page, as on any website | Checked in mobile-emulated Chromium: a one-finger drag reaches the board as normal pointer events. When a second finger lands, the browser cancels both pointers and zooms (scale 1 → 1.48 in the test). Writing gesture handling ourselves would duplicate that, worse |
| Fitting the board | In play mode, cells may shrink to 4 px (the creator keeps its 14 px minimum), so any board fits the phone's width. A 50x50 with 10 clue numbers is about 6 px a cell on a 375 px phone; the browser's 5× maximum zoom brings it to about 28 px | Today a 50x50 overflows sideways inside a scroll box, and with painting on one finger there's no way to scroll it. Pinch-zoom can only reach what's laid out on the page |
| Sharp when zoomed | The canvas redraws at device pixels × the zoom (`visualViewport.scale`, on its `resize` event), capped at 16 million pixels | Without it the zoomed board is a blurry, magnified bitmap. The cap is iOS Safari's canvas limit; past it the board gets slightly soft instead of blank |
| Strokes cut short by a pinch | A stroke ends on `pointercancel` like on `pointerup`, but `Preview` then calls a new `onCancel`. Play mode drops the stroke without leaving it in Redo. Pointer-downs from a second finger (`isPrimary` false) are ignored | The first finger has often painted a cell or two before the second lands; a pinch must leave the board as it was |
| Clue grey-out | `completedClues(runs, line)` in `core/puzzle/board.ts` returns one flag per clue number. **Every number** greys when the line's filled runs match the clue exactly. Otherwise, numbers grey from each end inward: walking from the left, a filled run is counted when it is closed on both sides (by the edge or an X) and everything before it is X or counted runs; it greys clue *k* if its length matches. The walk stops at the first blank cell or a mismatch. The same runs from the right, against the clue reversed | A run can only be tied to its clue number when everything between it and the edge is settled; a blank cell could still hide another run. Recomputed from the board on every move, so breaking a run un-greys it at once |
| Drawing grey-outs | `Preview` takes `done?: { rows: boolean[][]; cols: boolean[][] }` and draws those numbers in grey (#aaa) | The canvas already draws every clue; this only changes one colour |
| Highlight | `Preview` takes `crosshair` (play only). The row and column of the cell under the mouse, or of the keyboard cursor while the board has focus, get a light blue tint across the grid and its clues. The mouse wins when both exist. On touch, the tint follows the finger during a stroke | "Under the cursor or keyboard focus". Tinting the clues too makes it easy to read the numbers for the line you're on |
| Timer | Shown as `m:ss` (`h:mm:ss` from an hour) in the play controls. Starts on the first move, runs only while the tab is visible (`visibilitychange`), stops when solved. It ticks every 250 ms while running, so the display never skips a second | The criterion. `performance.now()` differences are added to a saved total, so a paused period never counts |
| Autosave | Saved in `localStorage` under `nonogram-progress:<hash>`, where the hash is FNV-1a (32-bit, hex) of the puzzle's share payload. The value is `{ "board": "0102…", "elapsed": ms }`, one digit per cell (0 empty, 1 filled, 2 X). Written after each move and each timer second once play has started. On opening, a stored board of the right length with only those digits is restored; anything else is ignored. Every `localStorage` call is in a `try`, so private browsing just doesn't save | Works for shared links and for "Play this puzzle" alike, since both have the solution. Undo history isn't saved; reopening starts a fresh history from the saved board |
| Reset | A "Reset" button, after a confirm ("Clear your progress on this puzzle?"), empties the board, zeroes the timer and deletes the saved entry | The criterion's Reset option |
| Win animation | When the board becomes solved during play (not when a solved board is restored), a "Solved!" banner pops over the board and fades out over about 2.5 s. It plays once per opening. Clicking it, or its being a focusable button, skips it. Under `prefers-reduced-motion: reduce` it isn't shown at all; the existing "Solved — well done!" message is enough | Plays once, skippable, and respects reduced motion. Restored solved boards shouldn't celebrate again |
| Where code lives | `core/puzzle/board.ts` gets `completedClues`. `src/ui/progress.ts` has the hash, load, save and clear helpers. The timer is a small hook, `useTimer`, in `src/ui/useTimer.ts`. Everything else goes in `PlayView` and `Preview` | Pure logic in `core` and tested in Node; browser-only pieces stay in `ui` |

## Files

```
src/ui/layout.ts                 # previewLayout(…, minCell)
src/ui/Preview.tsx               # pinch-friendly touch, zoom-sharp drawing, onCancel, done, crosshair
src/core/puzzle/board.ts         # completedClues
src/core/puzzle/board.test.ts    # Node
src/ui/useTimer.ts               # elapsed time, paused while hidden
src/ui/progress.ts               # autosave key, load, save, clear
src/ui/PlayView.tsx              # wires all six features
src/ui/app.css                   # pinch-zoom touch-action, timer, win banner, reduced motion
src/ui/Creator.browser.test.tsx  # play cases
docs/user-stories.md, docs/project-spec.md  # ticks
```

## Steps (one commit each)

1. **Zoom and pan:** the `minCell` option, `touch-action: pinch-zoom` in play, the zoom-aware redraw, `onCancel` and the `isPrimary` guard.
2. **Clue grey-out:** `completedClues` with its tests, then the `done` prop.
3. **Highlight:** the `crosshair` prop, and pointer hover tracking on the canvas.
4. **Timer:** `useTimer`, and its display in the controls.
5. **Autosave:** `progress.ts`, the restore on open, saving, and Reset.
6. **Win animation:** the banner, its CSS and the reduced-motion rule.

## Tests

`board.test.ts` (Node), for `completedClues`:

| Case | Expected |
| --- | --- |
| A line whose filled runs equal the clue, with blanks left unmarked | All numbers grey |
| `X ■■ X _ _ _` with clue 2 1 | First number grey, second not |
| `_ _ X ■` with clue 2 1, from the right | Second grey, first not |
| A closed run of the wrong length at the left | Nothing grey |
| A run touching a blank cell (not closed) | Not grey |
| The same line with one more filled cell next to a grey run | That number un-greys |
| An empty clue (0) on an empty line | Grey |
| Random boards against random clues | Never greys a number when the line's filled runs, taken in order, can't place that run at that clue position (checked against brute force on 10-cell lines) |

`Creator.browser.test.tsx`, in the play section:

| Case | Expected |
| --- | --- |
| Board layout at a narrow width (container 343 px, 50x50) | Cells under 14 px; the canvas is no wider than the container |
| `touch-action` on the play board | `pinch-zoom`; still `none` in the creator |
| A stroke that ends in `pointercancel` | The board is unchanged and Redo stays disabled |
| A second pointer's `pointerdown` | Paints nothing |
| Completing row 0 of the heart | Row 0's clue text is grey; breaking the run turns it black again |
| Mouse over a cell | A pixel in the same row, far away, is tinted; a pixel in neither line is not. Keyboard cursor moved the same way |
| Timer | Shows 0:00 before the first move; after a move and about 1.1 s, 0:01. Stops after solving. Hidden tab (stubbed `visibilityState` + event) pauses it |
| Autosave | Make moves, unmount, open the same link again: the same board and a time at least as large. Reset after confirm empties it and removes the stored entry. A corrupted stored value is ignored |
| Win banner | Solving shows the banner; clicking it removes it. A restored solved board doesn't show it |

Production check (Playwright with phone emulation on the built app, 375×700, touch): open a 50x50 link; a two-finger pinch zooms the page; tap cells while zoomed and check the right ones fill; a one-finger drag paints a run. With `reducedMotion: 'reduce'`, solving shows no banner.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Zoom and pan: pinch-zoom and two-finger pan work, one-finger drags paint, 50x50 playable on a phone | Production phone check; cancel and second-pointer tests; layout test. **Please also try it on your phone**: emulation isn't a real device |
| Clue grey-out | Node tests; grey-out browser test |
| Highlight | Highlight tests |
| Timer | Timer tests |
| Autosave with Reset | Autosave tests |
| Win animation: once, skippable, reduced motion | Banner tests; production reduced-motion check |

## Out of scope for M17

Clues that stay on screen while zoomed in (sticky clue bars), a custom zoom control or buttons, saving undo history, a list of saved puzzles, and timer pause or hide buttons.

## Risks

- **Clues off-screen when zoomed in:** with the browser zoom, the row clues scroll away as you pan right. The highlight helps you find your line, but sticky clues would be better; they need our own pan and zoom, a much bigger change.
- **Whole-page zoom:** the buttons zoom with the board, so you pinch out to reach Undo or Check. It's the familiar mobile web behaviour.
- **iOS differences:** `touch-action: pinch-zoom` and `visualViewport` are supported on current iOS Safari, but I can only test Chromium here.
- **Storage:** each puzzle you play leaves a few KB in `localStorage` until reset; nothing expires them.
