import type { ClueRun, Puzzle } from '../puzzle/types.ts';
import { EMPTY, FILLED, solveLine, UNKNOWN } from './line.ts';

/**
 * Start cell of each run in the leftmost placement that agrees with `line`,
 * or null if none does. `after[j][i]`: runs j… fit in cells i…, so the greedy
 * walk never commits to a start that strands a later run.
 */
function leftmost(runs: ClueRun[], line: Uint8Array): number[] | null {
  const n = line.length;
  const k = runs.length;
  const canEmpty = (i: number) => i >= n || (line[i]! & EMPTY) !== 0;
  const fits = (j: number, i: number) => {
    const end = i + runs[j]!.length;
    if (end > n || !canEmpty(end)) return false;
    for (let c = i; c < end; c++) {
      if (!(line[c]! & FILLED)) return false;
    }
    return true;
  };
  const next = (j: number, i: number) => Math.min(n, i + runs[j]!.length + 1);
  const after = Array.from({ length: k + 1 }, () => new Uint8Array(n + 1));
  after[k]![n] = 1;
  for (let i = n - 1; i >= 0; i--) {
    after[k]![i] = canEmpty(i) ? after[k]![i + 1]! : 0;
  }
  for (let j = k - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const skip = canEmpty(i) && after[j]![i + 1] === 1;
      const place = fits(j, i) && after[j + 1]![next(j, i)] === 1;
      after[j]![i] = skip || place ? 1 : 0;
    }
  }
  if (!after[0]![0]) return null;
  const starts: number[] = [];
  let i = 0;
  for (let j = 0; j < k; j++) {
    // after[j][i] holds here, so any cell this skips can be empty.
    while (!(fits(j, i) && after[j + 1]![next(j, i)])) i++;
    starts.push(i);
    i = next(j, i);
  }
  return starts;
}

/**
 * The left–right overlap people learn first: slide every run as far left and
 * as far right as the line allows. Cells a run covers in both are filled;
 * cells no run can reach are empty. Weaker than `solveLine`. Returns false
 * when the line can't be completed.
 */
export function overlapLine(runs: ClueRun[], line: Uint8Array): boolean {
  const n = line.length;
  const left = leftmost(runs, line);
  const right = leftmost([...runs].reverse(), line.slice().reverse());
  if (!left || !right) return false;
  const k = runs.length;
  const reach = new Uint8Array(n);
  runs.forEach(({ length }, j) => {
    const lo = left[j]!;
    const hi = n - right[k - 1 - j]! - length; // rightmost start, mapped back
    for (let c = hi; c < lo + length; c++) line[c] = FILLED;
    for (let c = lo; c < hi + length; c++) reach[c] = 1;
  });
  for (let c = 0; c < n; c++) {
    if (!reach[c]) line[c] = EMPTY;
  }
  return true;
}

export interface PlayResult {
  solved: boolean;
  reads: number; // lines looked at
  hard: number; // times overlap ran dry and a line needed full logic
}

/**
 * A model of a person solving: sweep the lines whose crossings changed,
 * using only `overlapLine`; when a whole sweep finds nothing, look for one
 * line that full line logic can advance, then go back to sweeping.
 */
export function play({ width, height, rows, cols }: Puzzle): PlayResult {
  const masks = new Uint8Array(width * height).fill(UNKNOWN);
  const lines = height + width;
  const cellsOf = (l: number) =>
    l < height
      ? Array.from({ length: width }, (_, x) => l * width + x)
      : Array.from({ length: height }, (_, y) => y * width + (l - height));
  const runsOf = (l: number) => (l < height ? rows[l]! : cols[l - height]!);
  let unknown = masks.length;
  let reads = 0;
  let hard = 0;

  /** Runs `logic` on line l; marks crossing lines of changed cells in `dirty`. */
  const visit = (
    l: number,
    logic: (runs: ClueRun[], line: Uint8Array) => boolean,
    dirty: Uint8Array,
  ) => {
    const cells = cellsOf(l);
    const line = Uint8Array.from(cells, (c) => masks[c]!);
    if (!logic(runsOf(l), line)) throw new Error('clues contradict');
    let changed = false;
    cells.forEach((c, i) => {
      if (line[i] === masks[c]) return;
      masks[c] = line[i]!;
      unknown--;
      changed = true;
      dirty[l < height ? height + i : i] = 1;
    });
    return changed;
  };

  let dirty = new Uint8Array(lines).fill(1);
  while (unknown > 0) {
    const next = new Uint8Array(lines);
    let progress = false;
    for (let l = 0; l < lines; l++) {
      if (!dirty[l]) continue;
      reads++;
      if (visit(l, overlapLine, next)) progress = true;
    }
    if (!progress) {
      let found = false;
      for (let l = 0; l < lines && !found; l++) {
        found = visit(l, solveLine, next);
      }
      if (!found) return { solved: false, reads, hard };
      hard++;
    }
    dirty = next;
  }
  return { solved: true, reads, hard };
}
