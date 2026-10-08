import type { ClueRun } from '../puzzle/types.ts';

// Per-cell bitmask of still-possible values.
export const EMPTY = 1;
export const FILLED = 2;
export const UNKNOWN = EMPTY | FILLED;

/**
 * Narrows `line` in place to the values used by at least one placement of
 * `runs` that agrees with it. Returns false when no placement exists.
 *
 * Forward/backward reachability over (cell, run), O(length × runs). Each run
 * is treated as its filled cells plus one empty cell after it; index n is a
 * virtual always-empty cell so the last run needs no special case.
 */
export function solveLine(runs: ClueRun[], line: Uint8Array): boolean {
  const n = line.length;
  const k = runs.length;
  const w = k + 1;
  const at = (i: number, j: number) => i * w + j;

  // blocked[i] = cells before i that can't be filled.
  const blocked = new Uint16Array(n + 1);
  for (let i = 0; i < n; i++) {
    blocked[i + 1] = blocked[i]! + (line[i]! & FILLED ? 0 : 1);
  }
  const canEmpty = (i: number) => i === n || (line[i]! & EMPTY) !== 0;
  // Run j can occupy cells i..end-1, followed by an empty cell at end.
  const fits = (j: number, i: number) => {
    const end = i + runs[j]!.length;
    return end <= n && blocked[end] === blocked[i] && canEmpty(end);
  };

  const forward = new Uint8Array((n + 2) * w);
  forward[at(0, 0)] = 1;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!forward[at(i, j)]) continue;
      if (canEmpty(i)) forward[at(i + 1, j)] = 1;
      if (j < k && fits(j, i)) forward[at(i + runs[j]!.length + 1, j + 1)] = 1;
    }
  }
  if (!forward[at(n + 1, k)]) return false;

  const backward = new Uint8Array((n + 2) * w);
  backward[at(n + 1, k)] = 1;
  for (let i = n; i >= 0; i--) {
    for (let j = k; j >= 0; j--) {
      if (
        (canEmpty(i) && backward[at(i + 1, j)]) ||
        (j < k && fits(j, i) && backward[at(i + runs[j]!.length + 1, j + 1)])
      ) {
        backward[at(i, j)] = 1;
      }
    }
  }

  // Steps that lie on a complete placement: reachable from the start and able to reach the end.
  const canBeEmpty = new Uint8Array(n + 1);
  const fillDiff = new Int16Array(n + 1);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!forward[at(i, j)]) continue;
      if (canEmpty(i) && backward[at(i + 1, j)]) canBeEmpty[i] = 1;
      if (j < k && fits(j, i)) {
        const end = i + runs[j]!.length;
        if (backward[at(end + 1, j + 1)]) {
          fillDiff[i]!++;
          fillDiff[end]!--;
          canBeEmpty[end] = 1;
        }
      }
    }
  }

  let filling = 0;
  for (let i = 0; i < n; i++) {
    filling += fillDiff[i]!;
    line[i] = (canBeEmpty[i] ? EMPTY : 0) | (filling > 0 ? FILLED : 0);
  }
  return true;
}
