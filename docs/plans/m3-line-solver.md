# M3 Implementation Plan — Line Solver

Plan for the third user story in `docs/user-stories.md`:

> As a developer, I want a fast line solver that reports exactly which cells it can't determine, so that the app can judge puzzles and point creators at problem areas.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Cell state | `Uint8Array` of masks, one per cell: bit 0 = can be empty, bit 1 = can be filled (`EMPTY = 1`, `FILLED = 2`, `UNKNOWN = 3`) | Spec's representation; extends to N colors later without changing shapes |
| Solver input | `Pick<Puzzle, 'width' \| 'height' \| 'rows' \| 'cols'>` — clues only, never the solution | The solver must not be able to peek; the contradiction tests need clues that have no solution |
| Colors | v1 treats every run as "filled" and ignores `run.color` | Color in the solver is out of scope for v1 (spec); the mask layout already leaves room |
| Line algorithm | Forward/backward reachability DP over (cell, run), O(length × runs) per line | Spec's algorithm; finds *every* deduction a single line allows, not just overlap tricks |
| Round definition | Round 1 = every row, then every column. Round *r*+1 = every line crossing a cell fixed in round *r*. Stop when solved or a round fixes nothing | Deterministic and easy to explain; "rounds needed" is what the M16 difficulty rating uses |
| Starting state | Always all-unknown for now | M9 (deep check) and M11 (auto-fix) need to start from a partial state; they add an optional `masks` argument then, a non-breaking change |
| Benchmark | A normal Vitest test timing with `performance.now()` | Runs in CI with everything else; no separate `vitest bench` setup |

## Files

```
src/core/solver/
  line.ts         # EMPTY/FILLED/UNKNOWN, solveLine
  line.test.ts    # hand cases + brute-force oracle
  solve.ts        # solve(), SolveResult
  solve.test.ts   # puzzles, stuck, contradiction, trace, soundness, benchmark
src/core/test-utils.ts   # randomGrid(width, height, seed, density = 0.5), moved out of clues.test.ts
```

## Steps

### 1. `line.ts` — `solveLine(runs: ClueRun[], line: Uint8Array): boolean`

Narrows `line` in place to the values possible in at least one valid placement of the runs. Returns `false` when no placement exists (contradiction).

Let *n* = line length and *k* = number of runs. Treat each run as "its filled cells plus one empty cell after it", and pad the line with one virtual always-empty cell at index *n*, so the last run needs no special case.

1. **Prefix sums** of "cell can't be filled" (bit 1 clear), so "can cells *i*..*i*+len−1 all be filled?" is O(1).
2. **Forward** `F[i][j]` (Uint8Array of (n+2) × (k+1)): the first *i* cells can hold exactly the first *j* runs. `F[0][0] = 1`. From each reachable `F[i][j]`:
   - empty step: if cell *i* can be empty → `F[i+1][j]`;
   - run step: if run *j* fits at *i* (all its cells can be filled and cell *i*+len can be empty) → `F[i+len+1][j+1]`.
3. If `F[n+1][k]` is unreachable → return `false`.
4. **Backward** `B[i][j]`: cells *i*..*n* can hold runs *j*..*k*−1. Same two steps, mirrored, from `B[n+1][k] = 1`.
5. **Collect possibilities.** For each `(i, j)` with `F[i][j]`:
   - the empty step is valid (cell *i* can be empty and `B[i+1][j]`) → cell *i* can be empty;
   - the run step is valid (`B[i+len+1][j+1]`) → cells *i*..*i*+len−1 can be filled (marked with a difference array, so it stays O(n × k)) and cell *i*+len can be empty.
6. Write the new masks back: `(canEmpty ? EMPTY : 0) | (canFill ? FILLED : 0)`. Masks only ever lose bits.

An empty clue (`[]`) needs no special case: only empty steps exist, so every cell becomes `EMPTY`.

### 2. `solve.ts` — `solve(puzzle): SolveResult`

```ts
type SolveStatus = 'solved' | 'stuck' | 'contradiction';
interface SolveResult {
  status: SolveStatus;
  masks: Uint8Array;        // final state, row-major
  undetermined: number[];   // row-major indices of cells still UNKNOWN
  trace: { rounds: number; deductions: number[] };  // deductions[r] = cells fixed in round r
}
```

- Start with every mask `UNKNOWN`, and every row then every column dirty.
- For each dirty line: copy its masks into a scratch `Uint8Array` (row via `subarray`, column by stride), run `solveLine`, and compare to the old masks. For each cell that changed: write it back, count a deduction, and mark the crossing line dirty for the next round.
- `solveLine` returning `false` → stop with `contradiction`. A contradiction always means the clues have no solution, because masks only lose bits that no valid placement uses.
- Keep a count of cells still unknown; exit at 0 with `solved` (no trailing empty round). If a round ends with nothing dirty → `stuck`.
- Every round adds one entry to `deductions`, so `rounds === deductions.length`. A stuck puzzle's last entry is 0.

### 3. Shared test helper

Move `randomGrid` from `clues.test.ts` to `src/core/test-utils.ts`, add a `density` parameter (0.5 by default, so existing tests are unchanged), and import it from both test files. The ESLint React ban already covers it.

### 4. Tests

`line.test.ts`:

| Case | Line, clue | Expected |
| --- | --- | --- |
| Overlap | `?????`, [3] | `??■??` |
| Tight fit | `?????`, [2, 2] | `■■□■■` |
| Empty clue | `?????`, [] | all empty |
| Uses known cells | `?■???`, [1] | `□■□□□` |
| No room | `???`, [2, 2] | returns `false` |
| Conflicts with known | `■■■`, [1] | returns `false` |

**Brute-force oracle:** for a few thousand seeded random cases (length 1–12, random clue, some cells already known), enumerate all 2^n fillings, keep the ones that match both the clue (via `lineClues` from M2) and the known cells, and OR them into the expected masks. `solveLine` must match exactly, including returning `false` when no filling survives. This proves the DP finds every deduction and only true ones, which is the main risk in this milestone.

`solve.test.ts`:

| Case | Expected |
| --- | --- |
| Line-solvable fixtures: 1x1 filled; 5x5 all empty; 5x5 plus sign (rows and columns `1,1,5,1,1`); 10x10 hollow square; seeded dense random 20x20; seeded dense random 50x50 | `solved`, no undetermined cells, every mask matches the source grid |
| 2x2 diagonal (`10` / `01`) | `stuck`, `undetermined` is `[0, 1, 2, 3]`, trace `{ rounds: 1, deductions: [0] }` |
| Contradictions: rows `[2],[]` with columns `[],[]`; a 3-wide row clued `[2, 2]` | `contradiction`; returns without hanging |
| Trace on the plus sign | Exact `rounds` and `deductions` worked out by hand; for every solved fixture, `deductions` sums to width × height |
| Soundness | For many seeded random grids (sizes 5–50, densities 0.3–0.7, solvable or not), every determined cell equals the source grid. The source is always a valid solution, so any wrong deduction is a bug |
| Benchmark | Warm up, then time the 50x50 fixture over 20 runs; the median must be < 50 ms |

The two random fixtures are pinned by seed. When writing them, pick seeds the solver solves. The oracle and soundness tests are what prove those solves are right, so this doesn't rely on the solver being trusted.

### 5. Run the checks

`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`. Then tick M3 in `docs/user-stories.md` and `docs/project-spec.md`.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| At least five known line-solvable puzzles (including a 50x50) solve and match | Six fixtures in `solve.test.ts`, including the seeded 50x50 |
| A 2x2 diagonal is stuck with all four cells undetermined | The 2x2 diagonal test |
| Clues with no solution return a contradiction instead of crashing or looping | The two contradiction tests, plus the `false` cases in the line oracle |
| A 50x50 solves in < 50 ms, measured in a benchmark test | The benchmark test, run in CI |
| The trace records rounds and deductions per round | The plus-sign trace test and the "sums to width × height" check |

## Out of scope for M3

Starting from a partial state (M9/M11), the Web Worker (M6), deep check (M9), difficulty rating (M16), and colors in the solver (after v1).

## Risks

- **CI timing:** GitHub runners are slower than a laptop. A 50x50 solve should take a few milliseconds, so the 50 ms limit leaves a wide margin. If the test ever flakes, speed up the solver; don't raise the limit.
- **Round counts depend on line order** (rows before columns). That's fine for a difficulty estimate, but the order must stay fixed once M16 tunes thresholds against it.
