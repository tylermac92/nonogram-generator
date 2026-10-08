# M2 Implementation Plan — Grid and Clue Generation

Plan for the second user story in `docs/user-stories.md`:

> As a developer, I want a tested grid type and clue generator, so that every other module shares one correct model of a puzzle.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Types | Copy `CellValue`, `Grid`, `ClueRun`, `Puzzle` from the spec unchanged | Every later milestone codes against them; the spec already made them color-ready |
| Empty line | Data is `[]`; a separate `clueLabels()` turns `[]` into `['0']` | The solver (M3) wants the plain run list; only display needs the "0" |
| Run boundaries | A run ends when the cell value changes, not just at a 0 | Same cost in v1, and color (adjacent runs of different colors, no gap) works later without a rewrite |
| Size limits | Core accepts any positive integer size; the 5–50 limit is enforced in the UI (M5/M7) and on load (M12/M15) | The story requires 1x1, and loaders are the trust boundary |
| Column access | `gridRow` returns a `subarray` (no copy); `gridColumn` copies into a new `Uint8Array` | At most 50 cells; simple to read; the hot solver loop in M3 uses its own mask arrays anyway |
| Test oracle | Large and random grids are checked against an independent one-liner: `line.join('').split(/0+/).filter(Boolean).map(s => s.length)` | A second, obviously-correct implementation catches off-by-one bugs that hand-written expectations miss |

## Files

```
src/core/puzzle/
  types.ts        # CellValue, Grid, ClueRun, Puzzle — verbatim from the spec
  grid.ts         # createGrid, gridFromRows, gridRow, gridColumn
  grid.test.ts
  clues.ts        # lineClues, clueLabels, makePuzzle
  clues.test.ts
```

Delete the M1 placeholder `src/core/index.ts` and `src/core/index.test.ts`; the real tests replace them. Nothing imports `VERSION`.

## Steps

### 1. `types.ts`

Exactly the spec's block (`CellValue = number`, `Grid { width; height; cells: Uint8Array }` row-major, `ClueRun { length; color }`, `Puzzle { width; height; rows; cols; solution; palette }`), with the spec's comments.

### 2. `grid.ts`

- `createGrid(width, height, cells = new Uint8Array(width * height)): Grid` — throws `RangeError` if a size is not a positive integer or `cells.length !== width * height`. This is the one place a malformed grid can be caught before it corrupts clues or the solver.
- `gridFromRows(rows: string[]): Grid` — parses `['1101110', …]`. Throws if rows are empty, ragged, or contain characters other than digits. Used by tests here and by solver tests in M3, so it lives in the module rather than a test helper.
- `gridRow(grid, y)` → `grid.cells.subarray(y * width, (y + 1) * width)`.
- `gridColumn(grid, x)` → new `Uint8Array` of `height` cells at stride `width`.

### 3. `clues.ts`

- `lineClues(line: ArrayLike<number>): ClueRun[]` — single pass: track the current value and run length; close a run when the value changes or the line ends; skip runs of 0.
- `clueLabels(runs: ClueRun[]): string[]` — `runs.length ? runs.map(r => String(r.length)) : ['0']`.
- `makePuzzle(solution: Grid): Puzzle` — `rows` from `gridRow` for each y, `cols` from `gridColumn` for each x, `palette: ['#fff', '#000']`. The puzzle keeps the solution grid by reference; nothing mutates it.

### 4. Tests

`clues.test.ts`:

| Case | Input | Expected |
| --- | --- | --- |
| Empty row | `0000000` | `[]`, labels `['0']` |
| Full row | `1111111` | `[7]` |
| Story example | `1101110` | `[2, 3]` |
| Separated singles | `1010101` | `[1, 1, 1, 1]` |
| Runs touching both edges | `1100011` | `[2, 2]` |
| Single cell, middle | `0001000` | `[1]` |
| Colors kept apart | `[1, 1, 2, 2, 0, 1]` | `[{2,1}, {2,2}, {1,1}]` |
| 1x1 | `['1']` and `['0']` | rows/cols `[[1]]` and `[[]]` |
| 5x5 | A hand-drawn shape (e.g. a plus sign) | Hand-written row and column clues |
| 37x22 | Seeded random fill | `rows.length === 22`, `cols.length === 37`, every line matches the oracle |
| 50x50 | All filled, all empty, seeded random | `[50]` everywhere; `[]` everywhere; oracle match |

All runs in v1 tests have `color: 1` except the color case. Seeded random uses a tiny inline LCG so tests are deterministic with no new dependency.

`grid.test.ts`: row-major layout (`gridFromRows(['10', '00']).cells` is `[1, 0, 0, 0]`, and cell (x, y) is at `y * width + x`); `gridColumn` on a non-square grid; `createGrid` and `gridFromRows` reject bad input.

### 5. Run the checks

`npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`. The existing ESLint rule already fails the build if `src/core` imports React.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| An empty row produces the clue "0" | "Empty row" test: `lineClues` gives `[]`, `clueLabels` gives `['0']` |
| A fully filled row of width *w* produces *w* | "Full row" test plus the all-filled 50x50 case |
| `1101110` gives 2 3; separated, edge-adjacent, and single-cell runs covered | The first six rows of the test table |
| 1x1, 5x5, 37x22, and 50x50 generate correctly | The size tests; non-square checks both line counts and every line against the oracle |
| Row-major `Uint8Array`; no React imports | `grid.test.ts` layout test; the ESLint `no-restricted-imports` rule from M1 |

## Out of scope for M2

The edit overlay (M8), the line solver (M3), rendering clues on screen (M5), and validating the 5–50 size limit (M5, M7, M12, M15).
