# M19 Implementation Plan — Hints in Play Mode

Plan for a new user story (to add to `docs/user-stories.md` under a Phase 7 heading):

> As a player, I want a hint when I'm stuck that points to the next step logic allows, so that I can keep going and learn the technique instead of guessing or giving up.

From the spec's Out of scope list: "Solver hints in play mode: reveal the next logical deduction and name the row or column that proves it."

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| What a hint is | A deduction from **one line**, based only on the player's board. Each row and column becomes a line of solver masks: blank → `UNKNOWN`, filled → `FILLED`, X → `EMPTY`. Then `solveLine` runs on it. A line has a hint when it settles a cell the player hasn't marked yet | It's exactly the step the line solver takes, and a player can repeat it by reading one clue. It never draws on the stored solution, so the hint is something the player could have found |
| Which line | The line that settles the most cells. On a tie, rows come before columns, then the lower index | The biggest step forward, and predictable enough to test |
| Two presses | **First press:** tints the line amber and says "Row 7 (3 1 4) has cells you can work out." The button then reads "Show me". **Second press:** fills or X-marks every cell that line settles, as one undo step, and says "Row 7: 2 cells filled, 1 marked X." Any other move clears a pending hint, and the button goes back to "Hint" | A nudge first, so the player still does the thinking; the answer if they're still stuck. One undo step, so Undo takes the whole hint back |
| Mistakes first | Before looking for a line, the hint compares the board with the solution: filled cells that should be empty (`mistakes`), and X marks on cells that should be filled. If there are any, it says "Fix 3 wrong cells first (shown in red)." and tints them red, like Check | A wrong mark can make a line "prove" more wrong cells. Check ignores X marks on purpose, so a different correct answer still counts; a hint can't ignore them |
| Nothing to find | "No single row or column gives anything away from here — this puzzle needs a guess." This can only happen on a puzzle that isn't Valid; those can still be played and shared | Play and Share aren't limited to Valid puzzles, so this case is real |
| Solved board | The Hint button is disabled | Nothing left to hint |
| Where code lives | `nextHint(puzzle, board)` in `core/solver/hint.ts`, pure and tested in Node. `PlayView` adds the button, the pending-hint state and the messages. The tints use `Preview`'s existing `highlight` prop, so `Preview` doesn't change | Same split as M14 and M17: logic in `core`, wiring in `ui` |
| Two sets of names | `core/puzzle/board.ts` (0 empty, 1 filled, 255 X) and `core/solver/line.ts` (bitmasks 1, 2, 3) both export `EMPTY` and `FILLED` with different values. `hint.ts` imports the solver's set under aliases (`EMPTY as MASK_EMPTY`, and so on) | The one file that uses both sets must not mix them up |
| Line names | One-based, with the clue: "Row 7 (3 1 4)", "Column 12 (0)" | The numbers help the player find the line on a 50x50 board |

```ts
type Hint =
  | { kind: 'mistakes'; cells: number[] }
  | { kind: 'line'; axis: 'row' | 'column'; index: number; cells: number[]; values: CellValue[] } // FILLED or CROSS
  | { kind: 'none' };
```

## Files

```
src/core/solver/hint.ts          # nextHint
src/core/solver/hint.test.ts     # Node
src/ui/PlayView.tsx              # Hint / Show me button, pending state, messages, tints
src/ui/Creator.browser.test.tsx  # play cases
docs/user-stories.md, docs/project-spec.md  # the new story, M19 entry, ticks
```

## Steps

1. **`hint.ts`** with its Node tests.
2. **`PlayView`:** the button and both presses, the mistakes tint, the "none" message, disabled when solved.
3. **Docs:** the story in `user-stories.md`, M19 in the spec's milestone list, ticks.

## Tests

`hint.test.ts` (Node):

| Case | Expected |
| --- | --- |
| 5x5 with row 0 full and everything else empty, blank board | Row 0, five cells, all filled. Rows 1–4 also settle five cells each (all X), so this checks the tie rule |
| A board with one wrongly filled cell | `mistakes` with that cell |
| An X on a cell the solution fills | `mistakes` with that cell |
| A partly solved board | No cell in the hint is already marked, and every value matches the solution |
| The 2x2 diagonal (ambiguous), blank board | `none` |
| Random line-solvable grids (the `randomGrid` helper, 5x5 to 20x20): start blank and keep applying hints | The board ends solved, every hint is a `line` hint, and no applied value differs from the solution |

`Creator.browser.test.tsx`, in the play section (the 15x15 heart):

| Case | Expected |
| --- | --- |
| Hint on a blank board | Status names a line; a pixel in that line is tinted and one outside it isn't; the button reads "Show me" |
| Show me | Those cells are filled or X-marked; one Undo clears them all |
| Hint, then a move, then press again | The tint is gone and the button reads "Hint", so this is a new first press |
| A wrong X, then Hint | "Fix 1 wrong cell first"; the cell is tinted red |
| Solving the board | Hint is disabled |
| A shared link for an ambiguous puzzle, then Hint | The "needs a guess" message |

Production check (Playwright on the built app): open a 25x25 shared link, solve it using only Hint and Show me, and confirm it ends with "Solved — well done!".

## Acceptance criteria → how each is verified

Proposed criteria for the new story:

| Criterion | Verification |
| --- | --- |
| A hint names the row or column that proves it, before showing any cells | First-press test |
| Showing the hint fills and X-marks only cells that line proves, as one undo step | Show me and Undo test; random-grid Node test |
| Wrong marks are pointed out instead of a hint built on them | Mistakes tests |
| On a puzzle that needs guessing, the hint says so instead of guessing | Ambiguous Node and browser tests |
| A Valid puzzle can be solved from blank using hints alone | Random-grid Node test; production check |

## Out of scope for M19

A hint counter or a time penalty, deductions that need two lines at once (the line solver never makes them, so Valid puzzles don't need them), explaining the technique in words ("the 8 overlaps in the middle"), a keyboard shortcut, and hints in the creator.

## Risks

- **"Most cells" isn't "easiest":** a long overlap in a busy line settles many cells but may be harder to see than a short, simple line. If hints feel unhelpful in use, changing the order is one comparison in `nextHint`.
- **Ambiguous puzzles:** the mistakes check compares against the stored solution, so on a puzzle with two answers, a correct mark from the other answer is flagged as wrong. That only happens on non-Valid puzzles, which the creator already warns about.
- **Colour (M20):** `nextHint` turns board values into solver masks. M20 changes that mapping to one bit per colour; its plan covers the update.
