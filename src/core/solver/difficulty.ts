import type { SolveResult } from './solve.ts';

export type Difficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

/** Upper score bounds, tuned against the bundled samples (see docs/plans/m16). */
export const THRESHOLDS = { Easy: 20, Medium: 35, Hard: 55 };

/**
 * An estimate from the line solver's trace: the grid's side length times the
 * average round in which a cell got fixed. Null unless the puzzle line-solves.
 */
export function difficulty({
  status,
  masks,
  trace,
}: SolveResult): Difficulty | null {
  if (status !== 'solved') return null;
  const cells = masks.length;
  const depth =
    trace.deductions.reduce((sum, n, round) => sum + n * (round + 1), 0) /
    cells;
  const score = Math.sqrt(cells) * depth;
  return score < THRESHOLDS.Easy
    ? 'Easy'
    : score < THRESHOLDS.Medium
      ? 'Medium'
      : score < THRESHOLDS.Hard
        ? 'Hard'
        : 'Expert';
}
