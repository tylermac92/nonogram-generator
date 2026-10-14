import { makePuzzle } from '../puzzle/clues.ts';
import { createGrid } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import { solve } from '../solver/solve.ts';

export interface FixRequest {
  grid: Grid; // the grid as the creator shows it, edits included
  values: Float32Array; // adjusted cell values, for ranking by closeness to the cutoff
  cutoff: number;
  locked: number[]; // hand-edited cells, never flipped
  budget?: number; // most flips allowed; 5% of cells by default
}

export interface FixResult {
  flips: number[];
  undetermined: number;
  reason: 'solved' | 'stuck' | 'budget';
}

export interface FixProgress {
  flips: number;
  undetermined: number;
}

const MAX_CANDIDATES = 200;

/**
 * Greedy repair: each round flips the one cell that lets the line solver
 * determine the most extra cells, trying the cells whose value was the
 * nearest call first, until the puzzle line-solves, no flip helps, or the
 * budget is spent.
 */
export function autoFix(
  { grid, values, cutoff, locked, budget }: FixRequest,
  onProgress: (progress: FixProgress) => void = () => {},
): FixResult {
  const { width, height } = grid;
  const limit = budget ?? Math.max(1, Math.floor(grid.cells.length * 0.05));
  const cells = grid.cells.slice();
  const undeterminedIn = () =>
    solve(makePuzzle(createGrid(width, height, cells))).undetermined;
  const skip = new Set(locked);
  const flips: number[] = [];
  let undetermined = undeterminedIn();

  while (undetermined.length > 0) {
    if (flips.length === limit) {
      return { flips, undetermined: undetermined.length, reason: 'budget' };
    }
    const candidates = new Set<number>();
    for (const i of undetermined) {
      const x = i % width;
      for (const c of [
        i,
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        i - width,
        i + width,
      ]) {
        if (c >= 0 && c < cells.length && !skip.has(c)) candidates.add(c);
      }
    }
    const ranked = [...candidates]
      .sort(
        (a, b) => Math.abs(values[a]! - cutoff) - Math.abs(values[b]! - cutoff),
      )
      .slice(0, MAX_CANDIDATES);

    let best = -1;
    let bestLeft = undetermined;
    for (const i of ranked) {
      cells[i] = 1 - cells[i]!;
      const left = undeterminedIn();
      cells[i] = 1 - cells[i]!;
      if (left.length < bestLeft.length) [best, bestLeft] = [i, left];
    }
    if (best < 0) {
      return { flips, undetermined: undetermined.length, reason: 'stuck' };
    }
    cells[best] = 1 - cells[best]!;
    flips.push(best);
    skip.add(best);
    undetermined = bestLeft;
    onProgress({ flips: flips.length, undetermined: undetermined.length });
  }
  return { flips, undetermined: 0, reason: 'solved' };
}
