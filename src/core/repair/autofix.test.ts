import { describe, expect, it } from 'vitest';
import { adjust, binarize, downscale } from '../image/pipeline.ts';
import { makePuzzle } from '../puzzle/clues.ts';
import { createGrid, gridFromRows } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import { solve } from '../solver/solve.ts';
import { needsGuessing, randomGrid, wavesImage } from '../test-utils.ts';
import { autoFix, type FixRequest } from './autofix.ts';

const diagonal = gridFromRows(
  Array.from({ length: 10 }, (_, y) =>
    y < 5 ? '1'.repeat(10) + '0'.repeat(10) : '0'.repeat(10) + '1'.repeat(10),
  ),
);
/** Values far from the cutoff everywhere: black 0, white 255. */
const flat = (grid: Grid) =>
  Float32Array.from(grid.cells, (v) => (v ? 0 : 255));
const request = (grid: Grid, extra: Partial<FixRequest> = {}): FixRequest => ({
  grid,
  values: flat(grid),
  cutoff: 128,
  locked: [],
  ...extra,
});
const flipped = (grid: Grid, flips: number[]) => {
  const cells = grid.cells.slice();
  for (const i of flips) cells[i] = 1 - cells[i]!;
  return createGrid(grid.width, grid.height, cells);
};
const solves = (grid: Grid) => solve(makePuzzle(grid)).status === 'solved';
/** Cells whose single flip makes the diagonal line-solvable. */
const oneFlipFixes = Array.from(diagonal.cells.keys()).filter((i) =>
  solves(flipped(diagonal, [i])),
);

describe('autoFix', () => {
  it.each([
    ['diagonal', diagonal],
    ['needs-guessing fixture', needsGuessing],
  ])('makes the %s line-solvable', (_, grid) => {
    const result = autoFix(request(grid));
    expect(result.reason).toBe('solved');
    expect(result.undetermined).toBe(0);
    expect(result.flips.length).toBeLessThanOrEqual(grid.cells.length * 0.05);
    expect(solves(flipped(grid, result.flips))).toBe(true);
  });

  it('prefers the flip whose value is closest to the cutoff', () => {
    expect(oneFlipFixes.length).toBeGreaterThan(1);
    for (const near of oneFlipFixes.slice(0, 2)) {
      const values = flat(diagonal);
      values[near] = 120;
      expect(autoFix(request(diagonal, { values })).flips).toEqual([near]);
    }
  });

  it('never flips a locked cell', () => {
    const [near, other] = oneFlipFixes;
    const values = flat(diagonal);
    values[near!] = 120;
    values[other!] = 100;
    const result = autoFix(request(diagonal, { values, locked: [near!] }));
    expect(result.flips).toEqual([other]);
  });

  it('stops when no single flip helps', () => {
    const image = wavesImage();
    const crop = { x: 0, y: 0, width: image.width, height: image.height };
    const values = adjust(downscale(image, crop, 30, 30), 0, 0);
    const grid = binarize(values, 30, 30, 128, false);
    expect(solve(makePuzzle(grid)).undetermined).toHaveLength(900);
    expect(autoFix({ grid, values, cutoff: 128, locked: [] })).toEqual({
      flips: [],
      undetermined: 900,
      reason: 'stuck',
    });
  });

  it('stops at the budget, keeping its progress, and reports each round', () => {
    // Needs two flips; seed found with a seeded search.
    const grid = randomGrid(15, 15, 7, 0.5);
    const before = solve(makePuzzle(grid)).undetermined.length;
    const progress: number[] = [];
    const result = autoFix(request(grid, { budget: 1 }), (p) =>
      progress.push(p.undetermined),
    );
    expect(result.reason).toBe('budget');
    expect(result.flips).toHaveLength(1);
    expect(result.undetermined).toBeLessThan(before);
    expect(progress).toEqual([result.undetermined]);

    const full: number[] = [];
    const fixed = autoFix(request(grid), (p) => full.push(p.undetermined));
    expect(fixed.reason).toBe('solved');
    expect(full).toHaveLength(fixed.flips.length);
    expect(full).toEqual([...full].sort((a, b) => b - a));
    expect(full.at(-1)).toBe(0);
  });
});
