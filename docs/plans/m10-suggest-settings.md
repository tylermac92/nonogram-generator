# M10 Implementation Plan — Suggest Nearby Settings

Plan for the tenth user story in `docs/user-stories.md`:

> As a creator whose puzzle fails, I want the app to find nearby settings that pass, so that I can fix it in one click without guesswork.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Where the scan lives | `suggestSettings(request)` in `core/repair/suggest.ts` (the spec's `core/repair` module), run by the existing worker file | Pure and tested in Node; the worker stays a thin dispatcher |
| Shared pipeline step | `binarize(adjusted, width, height, cutoff, invert)` in `core/image/pipeline.ts`: threshold, cleanup, then invert. `Creator` uses it too, replacing its `cleaned` and `grid` stages | The scan must build exactly the grid the creator would build, or a suggestion could fail once applied. One function makes that true by construction |
| What is scanned | Cutoffs from the current cutoff −30 to +30 in steps of 2 (kept within 0–255), at each width from −3 to +3 that is allowed for the crop (5 to `maxWidth`). Brightness, contrast and Invert stay as they are. The current combination itself is skipped | The spec's ranges. The main thread works out the allowed sizes with `gridSize` and sends `{ width, height }` pairs, so `core` doesn't import the UI's sizing code |
| Edits during the scan | At the current width, the scan applies the creator's edits (they survive cutoff changes). At other widths it doesn't, because applying that suggestion clears them | Each suggestion is scanned exactly as it would look once applied |
| What counts as passing | The line solver finishes (Valid), **and** the grid is not nearly empty or full (the same 5% / 90% bounds as the existing warning, moved into one exported constant) | An empty grid line-solves trivially. Without this rule, an extreme cutoff would be "suggested" for most failing images |
| Closeness | `distance = |Δcutoff| ÷ 30 + |Δwidth| ÷ 3`, each change measured as a fraction of its scan range. Ties prefer the current width, then the smaller cutoff change. Up to three are returned, closest first | One number to sort by, with neither setting dominating. Preferring the current width keeps the creator's edits |
| Scan inputs | The request carries the gray image, crop, the sizes, the current cutoff (Auto resolved to its number), brightness, contrast, Invert, and edits. The gray image (at most 4 MB) is copied to the worker for each scan | A copy is a few milliseconds and keeps the worker stateless, which matters because cancelling replaces it |
| Scan cost | Up to 7 widths × 31 cutoffs = 217 line solves, each grid solved as is. Skipping repeated grids was tried and dropped: it saved about 30% on a noisy 30×30, while the worst case (a 50-wide grid where every cutoff gives a different grid) takes about 0.6 s either way | Fast enough in the worker without the extra code |
| Worker and client | The worker accepts a second request kind, `{ id, scan }`, and replies `{ id, suggestions }`. The client gains `scan(request, onDone)` and `cancel()`. `cancel()` replaces the worker if a job is running (the M9 mechanism, now also used by `check`). The creator runs **two clients**, one for checks and one for scans | Each can cancel without killing the other: the deep check and the scan run side by side |
| Trigger | `useSuggestions` starts a scan 500 ms after the line result says the current puzzle isn't solved, and cancels it when the puzzle changes or becomes Valid | "Settings still for about 500 ms, and the puzzle fails." The 150 ms solver debounce comes first, so a scan never starts mid-drag |
| Panel | Under the verdict, only while the puzzle isn't Valid: "Looking for nearby settings that pass…" with a Cancel button; then up to three buttons such as "Cutoff 112, width 20" (with "— clears your edits" when the width differs and there are edits); or "No nearby settings pass. Try auto-fix, or edit the highlighted cells by hand."; or "Search cancelled." | Matches the criteria. Auto-fix itself arrives in M11, which adds its button to this panel |
| Applying | A suggestion with the current width calls `update({ cutoff })`; one with a new width goes through `resize({ width, cutoff })`, so it asks before clearing edits, as in M8 | Reuses the M8 guard |
| Sample images | "At least one failing sample image gets a passing suggestion" **moves to M16**, where the sample images are added. Until then, synthetic test images stand in | There are no sample images yet |

## Files

```
src/core/image/pipeline.ts        # binarize
src/core/image/pipeline.test.ts   # binarize case
src/core/repair/suggest.ts        # suggestSettings, DULL bounds
src/core/repair/suggest.test.ts   # Node
src/workers/solver.worker.ts      # scan request kind
src/workers/solverClient.ts       # scan, cancel
src/workers/solverClient.browser.test.ts
src/ui/useSuggestions.ts          # 500 ms trigger, own client, cancel
src/ui/Creator.tsx                # binarize, DULL, suggestions panel
src/ui/app.css                    # panel spacing
src/ui/Creator.browser.test.tsx   # panel cases
docs/user-stories.md              # sample-image criterion moved from M10 to M16
```

## Steps

1. **`binarize`**, then switch `Creator` to it; all existing tests must still pass.
2. **`suggest.ts`:**

   ```ts
   export interface ScanRequest {
     gray: GrayImage; crop: Rect;
     sizes: { width: number; height: number }[]; // allowed widths, current first
     width: number; cutoff: number; brightness: number; contrast: number; invert: boolean;
     edits: Edits;
   }
   export interface Suggestion { width: number; cutoff: number }
   export function suggestSettings(request: ScanRequest): Suggestion[]
   ```

   For each size: downscale and adjust once, then binarize at each cutoff. Apply the edits at the current width. Skip dull grids, line-solve the rest, collect the solved ones, then sort by distance and keep three.
3. **Worker and client** as in the table. `check` becomes `cancel()` followed by posting the request.
4. **`useSuggestions(input | null)`** returns `{ state: 'idle' | 'scanning' | 'done' | 'cancelled', suggestions, cancel }`. `Creator` passes `null` while the puzzle is Valid or not checked yet.
5. **Panel** in `Creator`, as in the table.

## Tests

`pipeline.test.ts`: `binarize` gives the same grid as threshold → cleanup → complement, for Invert on and off.

`suggest.test.ts` (Node), with synthetic gray images built in the test:

| Case | Expected |
| --- | --- |
| A failing image that a slightly higher cutoff fixes (diagonal blocks plus a mid-grey patch that breaks the tie once it is filled; checked in the test to fail at the current cutoff) | At least one suggestion; each, rebuilt through `binarize` and solved, is Valid and not dull; the list is sorted by distance |
| The same image with edits | Suggestions at the current width include the edits when re-checked |
| An image where only the extreme cutoffs pass (by emptying the grid) | No suggestion |
| Seeded 30×30 noise drawn as blocks | No suggestion |
| Sizes outside the crop's limits | Never suggested (only the sizes sent are scanned) |
| The worst case: a 50x50 grid with 7 widths | Finishes in under 3 seconds; the measured time is noted in the PR |

`solverClient.browser.test.ts`: a scan through the real worker returns the same suggestions as calling `suggestSettings` directly; `cancel()` during a scan means its callback never runs.

`Creator.browser.test.tsx`:

| Case | Expected |
| --- | --- |
| The M5 square image (Valid) | No suggestions panel |
| The failing synthetic image | "Looking for nearby settings…", then suggestion buttons; clicking the first gives "Valid" and moves the cutoff slider to that value |
| A suggestion with a different width while edits exist, confirm stubbed false | Nothing changes |
| The noise image | "No nearby settings pass. Try auto-fix…" |
| Cancel during the scan | "Search cancelled."; moving a slider starts a new scan |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Suggestions appear only when the puzzle is not Valid | Valid image test (no panel); `useSuggestions` gets `null` while Valid |
| Each shows its cutoff and width; clicking applies them with a Valid result | Button text and the click-to-Valid test; Node test re-solves every suggestion |
| Ordered by closeness | Sorting assertion in Node |
| Nothing in range → says so and points to auto-fix | Noise image test |
| The scan can be cancelled and restarts when settings change | Cancel test in Chromium; client cancel test |
| A failing sample image gets a passing suggestion | Moved to M16 (see Decisions) |

## Out of scope for M10

Scanning brightness, contrast or Invert; a "scan again" button after cancelling; and showing a preview of each suggestion before applying it.

## Risks

- **Main-thread copy of the image** for each scan: a few milliseconds for a 4 MB image, once per idle pause, not per drag.
- **Real photos untested:** without sample images, how often the scan finds something on real photos is unknown until M16.
