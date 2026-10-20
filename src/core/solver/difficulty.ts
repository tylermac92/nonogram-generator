import type { SolveResult } from './solve.ts';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

/** Upper score bounds, fitted to a simulated player on the samples (see docs/plans/m18). */
export const THRESHOLDS = { Easy: 17.6, Medium: 36, Hard: 54 };

/**
 * The grid's side length times the average round in which a cell got fixed.
 * Only meaningful for a solved result.
 */
export function score({ masks, trace }: SolveResult): number {
  const cells = masks.length;
  const depth =
    trace.deductions.reduce((sum, n, round) => sum + n * (round + 1), 0) /
    cells;
  return Math.sqrt(cells) * depth;
}

/** An estimate from the line solver's trace. Null unless the puzzle line-solves. */
export function difficulty(result: SolveResult): Difficulty | null {
  if (result.status !== 'solved') return null;
  const s = score(result);
  return s < THRESHOLDS.Easy
    ? 'Easy'
    : s < THRESHOLDS.Medium
      ? 'Medium'
      : s < THRESHOLDS.Hard
        ? 'Hard'
        : 'Expert';
}
