import type { Puzzle } from '../puzzle/types.ts';
import { solveLine, UNKNOWN } from './line.ts';

export type SolveStatus = 'solved' | 'stuck' | 'contradiction';

export interface SolveResult {
  status: SolveStatus;
  masks: Uint8Array; // final state, row-major
  undetermined: number[]; // row-major indices of cells still UNKNOWN
  trace: { rounds: number; deductions: number[] }; // deductions[r] = cells fixed in round r
}

/**
 * Line-solves from a blank grid. Round 1 visits every row, then every
 * column; each later round revisits only lines crossing a cell fixed in the
 * round before. Keep this order fixed: difficulty ratings depend on it.
 */
export function solve(
  puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>,
): SolveResult {
  const { width, height, rows, cols } = puzzle;
  const masks = new Uint8Array(width * height).fill(UNKNOWN);
  const scratch = new Uint8Array(Math.max(width, height));
  const deductions: number[] = [];
  let unknown = width * height;
  let contradiction = false;
  // Lines 0..height-1 are rows; height..height+width-1 are columns.
  let dirty = new Uint8Array(height + width).fill(1);

  while (!contradiction) {
    // Once every cell is known, one more pass checks the lines changed last;
    // it deduces nothing, so it isn't counted as a round.
    const checkOnly = unknown === 0;
    const next = new Uint8Array(height + width);
    let fixed = 0;
    for (let l = 0; l < height + width; l++) {
      if (!dirty[l]) continue;
      const isRow = l < height;
      const length = isRow ? width : height;
      const start = isRow ? l * width : l - height;
      const step = isRow ? 1 : width;
      const line = scratch.subarray(0, length);
      for (let i = 0; i < length; i++) line[i] = masks[start + i * step]!;

      if (!solveLine(isRow ? rows[l]! : cols[l - height]!, line)) {
        contradiction = true;
        break;
      }
      for (let i = 0; i < length; i++) {
        const cell = start + i * step;
        // Masks only lose bits, so any change is UNKNOWN -> one value.
        if (line[i] === masks[cell]) continue;
        masks[cell] = line[i]!;
        fixed++;
        unknown--;
        next[isRow ? height + i : i] = 1; // the crossing line
      }
    }
    if (!checkOnly) deductions.push(fixed);
    if (fixed === 0) break;
    dirty = next;
  }

  const undetermined: number[] = [];
  masks.forEach((mask, i) => {
    if (mask === UNKNOWN) undetermined.push(i);
  });
  return {
    status: contradiction
      ? 'contradiction'
      : unknown === 0
        ? 'solved'
        : 'stuck',
    masks,
    undetermined,
    trace: { rounds: deductions.length, deductions },
  };
}
