import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../puzzle/clues.ts';
import { createGrid } from '../puzzle/grid.ts';
import { randomGrid } from '../test-utils.ts';
import { difficulty, type Difficulty } from './difficulty.ts';
import { solve, type SolveResult } from './solve.ts';

/** A solved 10x10 result (side 10) with the given cells fixed per round. */
const solved10 = (deductions: number[]): SolveResult => ({
  status: 'solved',
  masks: new Uint8Array(100),
  undetermined: [],
  trace: { rounds: deductions.length, deductions },
});

const ORDER: Difficulty[] = ['Easy', 'Medium', 'Hard', 'Expert'];
const rank = (grid: Parameters<typeof makePuzzle>[0]) => {
  const result = solve(makePuzzle(grid));
  expect(result.status).toBe('solved');
  return ORDER.indexOf(difficulty(result)!);
};

/** A disc with an off-centre hole; line-solvable at every size used. */
const disc = (n: number) =>
  createGrid(
    n,
    n,
    Uint8Array.from({ length: n * n }, (_, i) => {
      const [x, y] = [i % n, Math.floor(i / n)];
      const outer = Math.hypot(x - n / 2, y - n / 2) < n * 0.42;
      const hole = Math.hypot(x - n * 0.62, y - n * 0.4) < n * 0.12;
      return outer && !hole ? 1 : 0;
    }),
  );

describe('difficulty', () => {
  it('is null unless the puzzle line-solves', () => {
    for (const status of ['stuck', 'contradiction'] as const) {
      expect(difficulty({ ...solved10([100]), status })).toBeNull();
    }
  });

  // score = side x average round: 10 x depth here
  it.each([
    [[1, 99], 'Easy'], // 19.9
    [[0, 100], 'Medium'], // 20
    [[1, 0, 49, 50], 'Medium'], // 34.8
    [[0, 0, 50, 50], 'Hard'], // 35
    [[1, 0, 0, 0, 49, 50], 'Hard'], // 54.6
    [[0, 0, 0, 0, 50, 50], 'Expert'], // 55
  ])('rates deductions %j as %s', (deductions, label) => {
    expect(difficulty(solved10(deductions))).toBe(label);
  });

  it('never falls as the same picture grows', () => {
    const ranks = [10, 15, 20, 25, 30, 40, 50].map((n) => rank(disc(n)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[0]).toBeLessThan(ranks.at(-1)!);
  });

  it('rates a grid needing several passes above a one-pass grid', () => {
    const onePass = createGrid(20, 20, new Uint8Array(400).fill(1));
    expect(rank(randomGrid(20, 20, 2, 0.6))).toBeGreaterThan(rank(onePass));
  });
});
