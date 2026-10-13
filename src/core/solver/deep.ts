import type { Puzzle } from '../puzzle/types.ts';
import { EMPTY, FILLED, UNKNOWN } from './line.ts';
import { propagate } from './solve.ts';

export type DeepResult =
  | { status: 'unique' }
  | { status: 'ambiguous'; differing: number[] } // cells where a second solution differs
  | { status: 'timeout' };

const TIMEOUT = Symbol('timeout');

/**
 * Searches for a solution that differs from `image`, the grid the clues were
 * made from. Exhaustive backtracking, so 'unique' is a proof; it gives up
 * with 'timeout' rather than guess an answer.
 */
export function deepCheck(
  puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>,
  image: Uint8Array,
  timeLimitMs = 3000,
): DeepResult {
  const { width, height } = puzzle;
  const deadline = performance.now() + timeLimitMs;
  const target = Uint8Array.from(image, (v) => (v ? FILLED : EMPTY));

  function search(masks: Uint8Array, dirty: Uint8Array): Uint8Array | null {
    if (performance.now() > deadline) throw TIMEOUT;
    if (!propagate(puzzle, masks, dirty)) return null;

    // Most constrained: the unknown cell with the fewest unknowns across its row and column.
    const rowUnknown = new Uint16Array(height);
    const colUnknown = new Uint16Array(width);
    masks.forEach((mask, i) => {
      if (mask !== UNKNOWN) return;
      rowUnknown[Math.floor(i / width)]!++;
      colUnknown[i % width]!++;
    });
    let cell = -1;
    let best = Infinity;
    masks.forEach((mask, i) => {
      const score = rowUnknown[Math.floor(i / width)]! + colUnknown[i % width]!;
      if (mask === UNKNOWN && score < best) [cell, best] = [i, score];
    });
    if (cell < 0) {
      return masks.some((mask, i) => mask !== target[i]) ? masks : null;
    }

    // The opposite of the image first: that is where a second solution would be.
    for (const value of [target[cell]! ^ UNKNOWN, target[cell]!]) {
      const next = masks.slice();
      next[cell] = value;
      const lines = new Uint8Array(height + width);
      lines[Math.floor(cell / width)] = 1;
      lines[height + (cell % width)] = 1;
      const found = search(next, lines);
      if (found) return found;
    }
    return null;
  }

  try {
    const other = search(
      new Uint8Array(width * height).fill(UNKNOWN),
      new Uint8Array(height + width).fill(1),
    );
    if (!other) return { status: 'unique' };
    const differing: number[] = [];
    other.forEach((mask, i) => {
      if (mask !== target[i]) differing.push(i);
    });
    return { status: 'ambiguous', differing };
  } catch (e) {
    if (e === TIMEOUT) return { status: 'timeout' };
    throw e;
  }
}
