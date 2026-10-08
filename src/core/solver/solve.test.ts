import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../puzzle/clues.ts';
import { createGrid, gridFromRows } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import { randomGrid } from '../test-utils.ts';
import { EMPTY, FILLED, UNKNOWN } from './line.ts';
import { solve } from './solve.ts';

const runs = (...lengths: number[]) =>
  lengths.map((length) => ({ length, color: 1 }));
const expectedMasks = (grid: Grid) =>
  Uint8Array.from(grid.cells, (v) => (v ? FILLED : EMPTY));

const plus = gridFromRows(['00100', '00100', '11111', '00100', '00100']);
const hollowSquare = gridFromRows(
  Array.from({ length: 10 }, (_, y) =>
    y === 0 || y === 9 ? '1'.repeat(10) : '1' + '0'.repeat(8) + '1',
  ),
);
// Seeds chosen because they line-solve; the oracle and soundness tests prove the steps.
const random20 = randomGrid(20, 20, 2, 0.6);
const random50 = randomGrid(50, 50, 20, 0.6);

describe('solve', () => {
  it.each([
    ['1x1 filled', gridFromRows(['1'])],
    ['5x5 empty', createGrid(5, 5)],
    ['5x5 plus sign', plus],
    ['10x10 hollow square', hollowSquare],
    ['20x20 random', random20],
    ['50x50 random', random50],
  ])('solves %s', (_, grid) => {
    const result = solve(makePuzzle(grid));
    expect(result.status).toBe('solved');
    expect(result.undetermined).toEqual([]);
    expect(result.masks).toEqual(expectedMasks(grid));
    const total = result.trace.deductions.reduce((a, b) => a + b, 0);
    expect(total).toBe(grid.width * grid.height);
    expect(result.trace.rounds).toBe(result.trace.deductions.length);
  });

  it('records the trace round by round', () => {
    // Round 1, rows: the middle row fills 5 cells. Columns: each fixes its 4 others.
    expect(solve(makePuzzle(plus)).trace).toEqual({
      rounds: 1,
      deductions: [25],
    });
    // Seeded 20x20: deductions spread over several rounds.
    expect(solve(makePuzzle(random20)).trace.rounds).toBe(10);
  });

  it('reports a 2x2 diagonal as stuck', () => {
    const result = solve(makePuzzle(gridFromRows(['10', '01'])));
    expect(result.status).toBe('stuck');
    expect(result.undetermined).toEqual([0, 1, 2, 3]);
    expect(Array.from(result.masks)).toEqual([
      UNKNOWN,
      UNKNOWN,
      UNKNOWN,
      UNKNOWN,
    ]);
    expect(result.trace).toEqual({ rounds: 1, deductions: [0] });
  });

  it.each([
    ['row needs two cells, columns allow none', 2, 2, [runs(2), []], [[], []]],
    ['3-wide row clued 2 2', 3, 1, [runs(2, 2)], [runs(1), runs(1), runs(1)]],
  ])('reports a contradiction: %s', (_, width, height, rows, cols) => {
    expect(solve({ width, height, rows, cols }).status).toBe('contradiction');
  });

  it('only makes deductions that match the source image', () => {
    const sizes = [
      [5, 5],
      [10, 10],
      [25, 25],
      [37, 22],
      [50, 50],
    ];
    for (const [width, height] of sizes) {
      for (const density of [0.3, 0.5, 0.7]) {
        for (let seed = 1; seed <= 5; seed++) {
          const grid = randomGrid(width!, height!, seed, density);
          const expected = expectedMasks(grid);
          const result = solve(makePuzzle(grid));
          const label = `${width}x${height} d=${density} seed=${seed}`;
          expect(result.status, label).not.toBe('contradiction');
          result.masks.forEach((mask, i) => {
            if (mask !== UNKNOWN)
              expect(mask, `${label} cell ${i}`).toBe(expected[i]);
          });
        }
      }
    }
  });

  it('solves a 50x50 in under 50 ms', () => {
    const puzzle = makePuzzle(random50);
    for (let i = 0; i < 5; i++) solve(puzzle);
    const times = Array.from({ length: 20 }, () => {
      const start = performance.now();
      solve(puzzle);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    const median = times[10]!;
    expect(median).toBeLessThan(50);
  });
});
