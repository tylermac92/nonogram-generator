# M6 Implementation Plan — Solver Worker and Verdict

Plan for the sixth user story in `docs/user-stories.md`:

> As a creator, I want to see at a glance whether my grid is a valid puzzle, and where it's ambiguous, so that I know whether I can publish it or need to fix it.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Worker | `src/workers/solver.worker.ts`, created with Vite's `new Worker(new URL('…', import.meta.url), { type: 'module' })`. It calls the existing `solve` and posts the result back | Vite bundles this form with no plugin or config. The worker file is a few lines; all logic stays in `core/solver` |
| Messages | Request `{ id, puzzle }` where `puzzle` holds only `width`, `height`, `rows` and `cols`. Response `{ id, result }`, with `result.masks`' buffer transferred instead of copied | The solver never needs the solution, as in M3. Clue arrays are tiny to clone |
| Job ids and stale results | `createSolverClient()` in `src/workers/solverClient.ts` owns the worker and a counter. `check(puzzle, onResult)` posts the next id; a response whose id isn't the latest is dropped. `dispose()` terminates the worker | Framework-free, so stale handling is tested directly without React. The worker still finishes stale jobs, but each takes ≤ 50 ms, so cancelling them isn't worth the code |
| Debounce | A `useSolver(puzzle)` hook waits 150 ms after the last puzzle change, then calls `check`. Each new puzzle clears the pending timer | 150 ms of debounce + ≤ 50 ms of solving + a render stays inside the 300 ms target |
| Result matching | The hook stores `{ puzzle, result }`. The UI shows the verdict and tint only when `stored.puzzle === puzzle`; otherwise it shows "Checking…" and no tint | A result for an older grid (different size or cells) is never drawn on the current one. The `useMemo` stages from M5 keep `puzzle` stable when nothing changed, so identity comparison is enough |
| Verdicts | `solved` → **Valid**, "Unique, solvable by logic" (green). `stuck` → **Not line-solvable** (red), with "N cells undetermined". `contradiction` can't happen for clues made from a real grid, so it shows as Not line-solvable too | The spec's four verdicts come with the deep check in M9; this milestone has only the line solver's answer |
| Badge | One element with `role="status"` and the verdict as text, plus a background color | Text carries the meaning, so color isn't the only signal, and screen readers announce changes |
| Tint | `Preview` takes an optional `undetermined: number[]`. Those cells get a translucent amber fill (`rgba(255, 160, 0, 0.6)`), drawn after the black cells and before the grid lines | Amber stays visible over both black and white cells, and the grid lines remain crisp on top |
| Worker lifetime | One worker per `Creator` mount, created in the hook's effect and disposed on unmount | Under React's StrictMode the effect runs twice in development; dispose-and-recreate handles that with no special case |

## Files

```
src/workers/
  solver.worker.ts              # onmessage → solve → postMessage (replaces .gitkeep)
  solverClient.ts               # createSolverClient: job ids, stale-drop, dispose
  solverClient.browser.test.ts  # Chromium: real worker
src/ui/
  useSolver.ts                  # debounce + client → { puzzle, result } | null
  Creator.tsx                   # verdict badge, count, passes undetermined to Preview
  Preview.tsx                   # optional undetermined tint
  app.css                       # badge colors
  Creator.browser.test.tsx      # verdict and tint cases added
```

## Steps

### 1. `solver.worker.ts`

```ts
addEventListener('message', (e: MessageEvent<SolveRequest>) => {
  const result = solve(e.data.puzzle);
  postMessage({ id: e.data.id, result }, { transfer: [result.masks.buffer] });
});
```

`SolveRequest` and `SolveResponse` types are exported from this file and imported with `import type` by the client.

### 2. `solverClient.ts`

```ts
export function createSolverClient() {
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  let latest = 0;
  let onResult: (result: SolveResult) => void = () => {};
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    if (e.data.id === latest) onResult(e.data.result);
  };
  return {
    check(puzzle, callback) { onResult = callback; worker.postMessage({ id: ++latest, puzzle: { width, height, rows, cols } }); },
    dispose: () => worker.terminate(),
  };
}
```

### 3. `useSolver.ts`

- Creates the client in a `useEffect` with no dependencies and disposes it on cleanup.
- A second `useEffect` on `puzzle`: if there's a puzzle, start a 150 ms timer that calls `check(puzzle, result => setChecked({ puzzle, result }))`; the cleanup clears the timer.
- Returns `checked && checked.puzzle === puzzle ? checked.result : null`.

### 4. `Creator.tsx` and `Preview.tsx`

- `const result = useSolver(puzzle);`
- Under the controls, while there is a puzzle:
  - no result yet → "Checking…";
  - `solved` → "Valid — unique, solvable by logic";
  - otherwise → "Not line-solvable — 37 cells undetermined" (with "1 cell" for one).
- `<Preview puzzle={puzzle} undetermined={result?.undetermined} />`. Preview draws the tint when the prop is set and adds it to its effect's dependencies.

### 5. Clean up

Delete `src/workers/.gitkeep`.

## Tests

`solverClient.browser.test.ts` (Chromium, real worker):

| Case | Expected |
| --- | --- |
| Check the 10x10 hollow square puzzle | Callback gets `status: 'solved'` and masks matching the source grid |
| Check a seeded random 50x50, then immediately a 5x5 plus sign, with the same callback | The callback runs exactly once, with the 5x5 result; wait 500 ms after it to be sure the 50x50 result was dropped |
| `dispose()` then `check` | No callback (the worker is gone); the test just waits 200 ms |

`Creator.browser.test.tsx` additions (same synthetic PNG approach as M5):

| Case | Expected |
| --- | --- |
| The M5 square image | The badge shows "Valid" within 1 second of the preview appearing, and no cell is tinted |
| A 200×100 image with the top-left and bottom-right quarters black (a scaled-up 2x2 diagonal: at 20 × 10, every row is [10] and every column is [5], which has two solutions) | The badge shows "Not line-solvable — 200 cells undetermined"; a cell's pixel is amber-tinted, not pure black or white |
| Press End on the width slider, then read the badge immediately | It says "Checking…", then "Valid" again for the 50 × 25 grid. This shows a slider change clears the old verdict instead of showing it on the new grid |

Timing of "updates within about 300 ms" is checked with `performance.now()` from the last slider key press to the badge changing, with a 600 ms limit in the test (half the margin is for slow CI machines); the real figure is noted in the PR.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| The verdict badge updates within about 300 ms after the user stops moving a slider | Timed slider test; the debounce (150 ms) + solve (≤ 50 ms) budget |
| Dragging sliders on a 50x50 grid never freezes the page; the solver runs off the main thread | `solve` is only imported by the worker (checked with a grep in review); a by-hand drag on a 50x50 grid of a large photo |
| A result from an older job never overwrites a newer one | The client's stale-result test, plus the result-matching rule in the hook |
| Undetermined cells are tinted, with a count such as "37 cells undetermined" | Ambiguous-image test (badge text and a tinted pixel) |
| A known line-solvable image shows Valid; a known ambiguous one shows the tinted region | The square and diagonal image tests |

## Out of scope for M6

The deep check and the other verdicts (M9); running repair or settings scans in the worker (M10, M11); moving the image downscale into the worker; cancelling a job that's already running.

## Risks

- **Large photos:** a width drag still re-runs the downscale on the main thread (M5). That is a few milliseconds on a laptop, but if it stutters on slow machines, move the downscale into this worker too.
- **Worker in tests and production:** Vite bundles `new URL(…, import.meta.url)` workers in both dev and build, but the production bundle isn't covered by the browser tests. Check the deployed site's badge once after merging.
