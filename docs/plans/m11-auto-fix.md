# M11 Implementation Plan — Auto-fix

Plan for the eleventh user story in `docs/user-stories.md`:

> As a creator, I want a one-click fix that makes my puzzle valid with as few visible changes as possible, so that I don't have to hunt for the problem cells myself.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Algorithm | `autoFix(request, onProgress)` in `core/repair/autofix.ts`, the spec's greedy loop. Line-solve the grid. Candidates = undetermined cells and their four neighbours, minus locked cells, ranked by how close their adjusted value is to the cutoff, capped at 200. Flip each candidate in turn, line-solve, and score it by how many more cells are determined. Keep the best (ties go to the closer value), and repeat until the puzzle is solved, no flip scores above 0, or the budget (5% of cells, at least 1) is spent | The spec, step for step. Ranking by closeness to the cutoff flips the cells whose value was a near call, so the change is least visible |
| Locked cells | Cells the creator edited by hand (including earlier auto-fix flips) are never candidates | Hand edits are deliberate. Auto-fix shouldn't undo them |
| Request | `{ grid, values, cutoff, locked, budget? }`, with `grid` the current edited grid and `values` the adjusted cell values at the current width | Everything the loop needs; nothing about crops or images |
| Result | `{ flips: number[], undetermined: number, reason: 'solved' \| 'stuck' \| 'budget' }` | Enough for the report, and for turning the flips into edits |
| Progress | After each round the worker posts `{ id, progress: { flips, undetermined } }`; at the end, `{ id, fix }`. The client stays busy until the final message, so `cancel()` still works mid-run | Progress and cancel come for free from the M9 and M10 worker setup |
| Worker | A third client in its own hook, `useAutoFix`, started by the button. A puzzle change (any setting or edit) cancels a running fix | A fix computed for an older grid must never be applied to a new one |
| Cancel | Nothing is applied until the final message, so cancelling leaves the grid exactly as it was | "Cancelling leaves the grid unchanged" |
| Applying | The flips become edits: each flipped cell is set to the opposite of its current value, in **one** history step | One undo reverts the whole fix |
| Auto-fixed marker | The history entry becomes `{ edits, fixed }`, where `fixed` is the set of auto-fixed cells. `Preview` draws their marker in purple instead of blue | Undo and redo restore the markers together with the edits, because both live in the same snapshot |
| Reverting one flip | Painting an auto-fixed cell back to the pipeline's value **removes** its edit and its marker, instead of storing a hand edit. Painting it any other way turns it into an ordinary hand edit | "Each one can be reverted individually" with the existing click: one click on a purple cell puts back what the image gave |
| Button and report | An "Auto-fix" button in the suggestions panel, shown whenever the puzzle isn't Valid. While running: "Auto-fixing… N cells flipped, M undetermined" with Cancel. Afterwards, one line that stays until the next change: "Auto-fix flipped N cells." (solved); "Auto-fix flipped N cells; M are still undetermined. No single flip helps any more." (stuck); or "…The flip budget (5% of cells) ran out." (budget). Partial results are applied too | Matches the criteria. "Keeps the improvements" means a partial fix is still applied |
| Sample images | "Most failing sample images pass with fewer than 2% of cells flipped" **moves to M16**, with the M10 sample-image check | There are no sample images yet |

## Prototype results

A rough version of the loop, run in Node before planning:

| Grid | Result | Time |
| --- | --- | --- |
| 20 × 10 diagonal (ambiguous) | Valid after 1 flip | 70 ms |
| 10x10 needs-guessing fixture | Valid after 1 flip | 20 ms |
| Seeded 20x20 noise | Valid after 1 flip | 30 ms |
| Seeded 30x30 noise | Valid after 11 flips | 14 s |
| Smooth but repetitive 30–50 pattern (the line solver determines nothing) | 0 flips: no single flip helps | 0.2–0.5 s |

## Files

```
src/core/repair/autofix.ts         # autoFix, FixRequest, FixResult
src/core/repair/autofix.test.ts    # Node
src/workers/solver.worker.ts       # fix job: progress messages, then the result
src/workers/solverClient.ts        # busy until the final message; fix()
src/workers/solverClient.browser.test.ts
src/ui/useAutoFix.ts               # own client, start, cancel, progress
src/ui/Creator.tsx                 # { edits, fixed } history, button, report, revert rule
src/ui/Preview.tsx                 # purple marker for fixed cells
src/ui/Creator.browser.test.tsx
docs/user-stories.md               # sample-image criterion moved from M11 to M16
```

## Steps

1. **`autofix.ts`** as in the table. `onProgress` is called after each kept flip.
2. **Worker:** `{ fix: FixRequest }` jobs call `autoFix` with a progress callback that posts messages. The client treats `result` (when stuck) and `progress` as non-final.
3. **History shape:** `History<{ edits: Edits; fixed: ReadonlySet<number> }>`. `paint` removes edits and `fixed` entries per the revert rule; everything else reads `history.present.edits`.
4. **`useAutoFix(puzzle)`** returns `{ state, start(request), cancel }`. Its state is `running` with progress, or `done` with the result, and it resets when the puzzle changes.
5. **`Creator`:** on `done`, record one history step with the flips as edits and add them to `fixed`. The report is tied to that history entry, so it disappears on the next change or on undo.

## Tests

`autofix.test.ts` (Node):

| Case | Expected |
| --- | --- |
| The diagonal and the needs-guessing fixture | `reason: 'solved'`; the flipped grid line-solves; flips ≤ 5% of cells |
| Ranking | Of two flips that each solve the diagonal, the one whose value is closer to the cutoff is chosen |
| Locked cells | Never flipped, even when locking the best candidate means a worse flip is chosen |
| A grid where the line solver determines nothing and no flip helps | `reason: 'stuck'`, no flips |
| A grid that needs more flips than a budget of 1 allows | `reason: 'budget'`, exactly 1 flip, and fewer undetermined cells than before |
| Progress | `onProgress` is called once per kept flip with falling undetermined counts |

`solverClient.browser.test.ts`: a fix through the worker sends progress and then the same result as `autoFix` in Node; `cancel()` mid-run means no final message.

`Creator.browser.test.tsx`:

| Case | Expected |
| --- | --- |
| The diagonal image, then Auto-fix | Verdict becomes Valid; "Auto-fix flipped 1 cell."; the flipped cell shows the purple marker |
| Then click the purple cell | The edit is gone (no marker), and the verdict is back to Ambiguous |
| Auto-fix, then Ctrl+Z | The whole fix is undone at once; Redo brings it back, purple markers included |
| Cancel during a slow fix (the 30x30 noise image) | "Auto-fixing…" disappears, nothing changes, and Undo stays disabled |
| A grid that auto-fix can't help | The "No single flip helps" report, with any flips kept |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Progress shown; cancel leaves the grid unchanged | Cancel test in Chromium; client cancel test |
| On success the verdict becomes Valid and the flip count is reported | Diagonal image test |
| Flipped cells are marked and can be reverted one by one | Purple-marker and click-to-revert tests |
| One undo step reverts the whole auto-fix | Undo/redo test |
| Budget or no helpful flip → partial progress reported and kept | Node `stuck` and `budget` cases; the "can't help" Creator test |
| Most failing sample images pass with < 2% flipped | Moved to M16 (see Decisions) |

## Out of scope for M11

Flipping more than one cell per round, smarter scoring for grids where nothing is determined, a time limit for the fix, and a "stop and keep what you have" button.

## Risks

- **Slow on noisy grids:** each round line-solves up to 200 candidates, so a busy 50x50 can take minutes. Progress and Cancel cover it; if real photos are slow too, the next step is fewer candidates per round.
- **Fully stuck grids:** when the line solver determines nothing, no single flip scores above 0, so auto-fix gives up at once. The suggestions panel and hand edits remain the way out.
