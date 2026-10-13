# M9 Implementation Plan — Deep Check

Plan for the ninth user story in `docs/user-stories.md`:

> As a creator, I want to know _why_ a puzzle failed — truly ambiguous, or unique but requiring guesses — so that I can decide whether to fix it or accept it.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Search | `deepCheck(puzzle, image, timeLimitMs = 3000)` in `core/solver/deep.ts`. A depth-first search from the blank grid: propagate with the line solver; on a contradiction, back up; when every cell is known, report it only if it differs from the image; otherwise pick the most-constrained unknown cell, try the **opposite** of the image's value first, then the image's value | The spec's algorithm. Trying both values at every branch makes the search exhaustive, so "nothing found" really means unique. Trying the opposite first reaches a second solution as early as possible |
| Most-constrained cell | The unknown cell with the fewest unknown cells in its row and column combined | A short line is the most likely to settle or contradict after one guess. It costs one pass over the grid per search step, which is small next to the propagation |
| Propagation | The loop inside `solve` moves into an exported `propagate(puzzle, masks, dirty)` that narrows `masks` in place and returns the per-round deductions, or `null` on a contradiction. `solve` calls it with every line dirty; the search calls it with only the guessed cell's row and column dirty | One copy of the line-solving loop; the trace and its tests stay exactly as they are |
| Result | `DeepResult = { status: 'unique' } \| { status: 'ambiguous'; differing: number[] } \| { status: 'timeout' }`. `differing` lists the cells where the second solution differs from the image | Exactly what the verdicts and the highlight need. The second solution itself isn't kept: nothing displays it yet |
| Time limit | Checked with `performance.now()` at every search step. On timeout the search stops and reports `timeout`; it never guesses an answer | "Inconclusive rather than a wrong answer." The limit is a parameter, as the spec asks, so tests can use 0 ms |
| Worker protocol | The request gains `solution` (the image's cells), which only the deep check reads. The worker posts the line result first; if the status is `stuck`, it then runs `deepCheck` and posts `{ id, deep }` | The creator sees the undetermined count within the M6 budget while the deep check is still running |
| Cancelling | The worker can't read messages while it searches, so the client cancels by **terminating the worker and starting a new one**: when `check` is called while the previous job hasn't sent its final message (the deep result, or a line result that isn't `stuck`), the worker is replaced before the new request is posted | No shared memory needed (GitHub Pages can't send the headers `SharedArrayBuffer` requires). A new worker loads from the cache in a few milliseconds; replacing it only happens while a job is still running |
| Hook | `useSolver` returns `{ result, deep }` for the current puzzle, with `deep` undefined until it arrives | The same stale-result rule as M6 covers both messages |
| Verdicts | `solved` → **Valid — unique, solvable by logic** (green). Stuck, deep pending → **Not line-solvable — N cells undetermined. Checking further…** (grey). `unique` → **Needs guessing — unique, but N cells need trial and error** (amber). `ambiguous` → **Ambiguous — N cells differ in a second solution** (red). `timeout` → **Inconclusive — couldn't prove either way** (grey) | The spec's four verdicts and colours. The text carries the meaning, not only the colour |
| Highlight | `Preview`'s `undetermined` prop becomes `highlight: { cells, color }`. Ambiguous highlights the differing cells in translucent red; Needs guessing, Inconclusive and the pending state keep the amber undetermined tint | One prop instead of one per kind of highlight |
| Export warning | **Moved to M12**, where export is built. M9 has nothing to put a warning on; the criterion is moved to M12's list in `docs/user-stories.md` | Keeps each criterion in the milestone that can actually meet it |

## Files

```
src/core/solver/
  solve.ts                       # propagate extracted; solve unchanged in behaviour
  deep.ts                        # deepCheck, DeepResult
  deep.test.ts                   # Node: fixtures, oracle, timeout
src/workers/
  solver.worker.ts               # solution in the request; second message with the deep result
  solverClient.ts                # replace a busy worker on a new check
  solverClient.browser.test.ts   # deep result, cancel, timeout
src/ui/
  useSolver.ts                   # { result, deep }
  Preview.tsx                    # highlight prop
  Creator.tsx                    # five verdict states
  app.css                        # amber and grey verdict styles
  Creator.browser.test.tsx       # verdict cases
docs/user-stories.md             # export-warning criterion moved from M9 to M12
```

## Steps

### 1. `solve.ts`

Extract the loop body into `propagate(puzzle, masks, dirty): number[] | null`. `solve` builds the blank masks, calls it with every line dirty, and builds the same `SolveResult` as today.

### 2. `deep.ts`

```ts
export function deepCheck(
  puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>,
  image: Uint8Array,
  timeLimitMs = 3000,
): DeepResult
```

A recursive `search(masks, dirty)` that copies the masks for each branch (at most 2,500 bytes per step), as described in the table. The timeout unwinds the recursion with a thrown sentinel, caught once at the top.

### 3. Worker and client

```ts
addEventListener('message', (e: MessageEvent<SolveRequest>) => {
  const { id, puzzle, solution } = e.data;
  const result = solve(puzzle);
  postMessage({ id, result }, { transfer: [result.masks.buffer] });
  if (result.status === 'stuck') postMessage({ id, deep: deepCheck(puzzle, solution) });
});
```

`createSolverClient().check(puzzle, onUpdate)` sends the clues and `puzzle.solution.cells`. `onUpdate` receives `{ result }` or `{ deep }`. A `busy` flag is set on `check` and cleared by the final message; `check` replaces the worker while `busy` is set.

### 4. UI

`Creator` derives the verdict text, class and highlight from `{ result, deep }` in one small function next to the component. `.verdict.guess` is amber, `.verdict.pending` and `.verdict.unknown` grey.

## Tests

`deep.test.ts` (Node):

| Case | Expected |
| --- | --- |
| 2x2 diagonal, and the 20 × 10 scaled diagonal from the M6 tests | `ambiguous`; `differing` is every cell |
| The 10x10 fixture found with a seeded search (cleanup-stable, line solver leaves 75 cells unknown) | `unique` |
| Oracle: 300 seeded random 5x5 grids that the line solver can't finish | `unique` exactly when brute force finds one solution, and every `ambiguous` result's `differing` matches a real second solution. Brute force lists every row that fits each row clue and checks each combination against the columns |
| The seeded 30×30 noise grid with a 0 ms limit | `timeout` |
| `solve` tests from M3 | Unchanged and still passing after the `propagate` extraction |

`solverClient.browser.test.ts` (Chromium, real worker):

| Case | Expected |
| --- | --- |
| The 10x10 fixture | First update: `stuck` with 75 undetermined; second update: `unique` |
| The seeded 30×30 noise grid | `timeout` after about 3 seconds (this test waits up to 4 s) |
| Check the 30×30 noise grid, then the 5x5 plus sign 50 ms later | The plus sign's result arrives within 500 ms, which proves the 3-second search was cancelled; no update for the 30×30 grid ever arrives |

`Creator.browser.test.tsx` (synthetic PNGs as before):

| Case | Expected |
| --- | --- |
| The M6 diagonal image | "Ambiguous — 200 cells differ in a second solution", with a red-tinted cell |
| The 10x10 fixture drawn as 10 px blocks on a 100×100 image, preset 10 | "Needs guessing — unique, but 75 cells need trial and error", with an amber cell |
| The M5 square image | Still "Valid", with no "Checking further" step |
| A width change while the deep check is pending on the 30×30 noise image | The new grid's verdict appears without waiting for the old search to time out |

The M6 and M8 tests that wait for "Not line-solvable — 200 cells undetermined" are updated to the final verdict.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| The deep check runs only when the line solver is stuck, and never blocks the UI | The worker only calls `deepCheck` on `stuck`; the Valid test sees no "Checking further"; the search runs in the worker, as in M6 |
| A known ambiguous puzzle shows Ambiguous with the differing cells highlighted | Diagonal tests in Node and Chromium (verdict text and a red pixel) |
| A known unique, non-line-solvable puzzle shows Needs guessing | The 10x10 fixture in Node, the worker, and Chromium; the oracle test for correctness in general |
| A timed-out search shows Inconclusive | 0 ms test in Node; the real 3-second timeout through the worker |
| Changing a setting mid-search cancels it | The client cancel test and the width-change test in Chromium |
| Non-Valid verdicts warn on export | Moved to M12 (see Decisions) |

## Out of scope for M9

Showing the second solution itself, a user-facing time-limit setting, and a progress indicator during the search.

## Risks

- **Noise-like images time out.** In the prototype, every random 30x30 to 50x50 noise grid hit the 3-second limit. Photos give smoother grids, but large, busy photos will often end up Inconclusive. M10 and M11 give the creator ways out of that.
- **Each cancel restarts the worker**, which reloads its script. That should be a few milliseconds from the browser cache; it is measured once on the built site.
