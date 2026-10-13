import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../puzzle/clues.ts';
import { gridFromRows } from '../puzzle/grid.ts';
import type { ClueRun, Grid } from '../puzzle/types.ts';
import { lineClues } from '../puzzle/clues.ts';
import { needsGuessing, randomGrid } from '../test-utils.ts';
import { deepCheck } from './deep.ts';
import { solve } from './solve.ts';

const check = (grid: Grid, limit?: number) =>
  deepCheck(makePuzzle(grid), grid.cells, limit);

/** Every solution of a small puzzle: each row that fits its clue, combined, then checked against the columns. */
function bruteForce(grid: Grid): Uint8Array[] {
  const { width, height } = grid;
  const { rows, cols } = makePuzzle(grid);
  const same = (a: ClueRun[], b: ClueRun[]) =>
    a.length === b.length && a.every((run, i) => run.length === b[i]!.length);
  const fitting = rows.map((clue) =>
    Array.from({ length: 2 ** width }, (_, bits) =>
      Uint8Array.from({ length: width }, (_, x) => (bits >> x) & 1),
    ).filter((row) => same(lineClues(row), clue)),
  );
  const solutions: Uint8Array[] = [];
  const pick = (y: number, cells: Uint8Array) => {
    if (y === height) {
      const ok = cols.every((clue, x) =>
        same(
          lineClues(
            Uint8Array.from(
              { length: height },
              (_, r) => cells[r * width + x]!,
            ),
          ),
          clue,
        ),
      );
      if (ok) solutions.push(cells.slice());
      return;
    }
    for (const row of fitting[y]!) {
      cells.set(row, y * width);
      pick(y + 1, cells);
    }
  };
  pick(0, new Uint8Array(width * height));
  return solutions;
}

describe('deepCheck', () => {
  it.each([
    ['2x2 diagonal', gridFromRows(['10', '01'])],
    [
      '20x10 scaled diagonal',
      gridFromRows(
        Array.from({ length: 10 }, (_, y) =>
          y < 5
            ? '1'.repeat(10) + '0'.repeat(10)
            : '0'.repeat(10) + '1'.repeat(10),
        ),
      ),
    ],
  ])('finds a second solution for the %s', (_, grid) => {
    expect(check(grid)).toEqual({
      status: 'ambiguous',
      differing: Array.from(grid.cells.keys()),
    });
  });

  it('proves a puzzle that needs guessing unique', () => {
    expect(solve(makePuzzle(needsGuessing)).undetermined).toHaveLength(75);
    expect(check(needsGuessing)).toEqual({ status: 'unique' });
  });

  it('agrees with brute force on small puzzles', () => {
    let tested = 0;
    let unique = 0;
    for (let seed = 1; tested < 300; seed++) {
      const grid = randomGrid(5, 5, seed, 0.5);
      if (solve(makePuzzle(grid)).status === 'solved') continue;
      tested++;
      const solutions = bruteForce(grid);
      const result = check(grid);
      const label = `seed ${seed}`;
      if (solutions.length === 1) {
        unique++;
        expect(result, label).toEqual({ status: 'unique' });
        continue;
      }
      expect(result.status, label).toBe('ambiguous');
      const differing = result.status === 'ambiguous' ? result.differing : [];
      // Some real second solution differs from the image in exactly these cells.
      const matches = solutions.some((cells) =>
        cells.every((v, i) => (v !== grid.cells[i]) === differing.includes(i)),
      );
      expect(matches, label).toBe(true);
    }
    // Both kinds must be exercised: 9 unique and 291 ambiguous at the time of writing.
    expect(unique).toBeGreaterThan(0);
    expect(unique).toBeLessThan(tested);
  });

  it('times out instead of guessing', () => {
    expect(check(randomGrid(30, 30, 1, 0.5), 0)).toEqual({ status: 'timeout' });
  });
});
