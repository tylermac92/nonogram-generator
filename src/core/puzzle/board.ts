import { lineClues } from './clues.ts';
import type { ClueRun, Puzzle } from './types.ts';

/** A player's board: one byte per cell. 255 keeps 1…N free for palette colours. */
export const EMPTY = 0;
export const FILLED = 1;
export const CROSS = 255;

/** Filled cells that are empty in the solution. X marks never count. */
export function mistakes(puzzle: Puzzle, board: Uint8Array): number[] {
  const wrong: number[] = [];
  board.forEach((v, i) => {
    if (v === FILLED && puzzle.solution.cells[i] === 0) wrong.push(i);
  });
  return wrong;
}

/** Every row and column's filled runs match its clue, so a different correct answer counts too. */
export function isSolved(
  { width, height, rows, cols }: Puzzle,
  board: Uint8Array,
) {
  const filled = board.map((v) => (v === FILLED ? 1 : 0));
  const same = (a: ClueRun[], b: ClueRun[]) =>
    a.length === b.length && a.every((run, i) => run.length === b[i]!.length);
  return (
    rows.every((runs, y) =>
      same(runs, lineClues(filled.subarray(y * width, (y + 1) * width))),
    ) &&
    cols.every((runs, x) =>
      same(
        runs,
        lineClues(
          Array.from({ length: height }, (_, y) => filled[y * width + x]!),
        ),
      ),
    )
  );
}

/**
 * Which of a line's clue numbers to grey out, one flag per number shown (an
 * empty clue shows a single 0). All of them when the filled runs match the
 * clue. Otherwise, walking in from each end through X marks, each closed run
 * (bounded by the edge or an X) that matches the next clue number; the walk
 * stops at a blank cell, since it could still hide another run.
 */
export function completedClues(
  runs: ClueRun[],
  line: ArrayLike<number>,
): boolean[] {
  const filled = Array.from(line, (v) => (v === FILLED ? 1 : 0));
  const found = lineClues(filled);
  if (
    found.length === runs.length &&
    found.every((run, i) => run.length === runs[i]!.length)
  ) {
    return runs.length ? runs.map(() => true) : [true];
  }
  const done = runs.length ? runs.map(() => false) : [false];
  const walk = (
    cells: number[],
    lengths: number[],
    mark: (k: number) => void,
  ) => {
    let i = 0;
    for (let k = 0; k < lengths.length; k++) {
      while (cells[i] === CROSS) i++;
      if (cells[i] !== FILLED) return; // a blank cell, or the end
      let j = i;
      while (cells[j] === FILLED) j++;
      if (j < cells.length && cells[j] !== CROSS) return; // not closed yet
      if (j - i !== lengths[k]) return;
      mark(k);
      i = j;
    }
  };
  const cells = Array.from(line);
  const lengths = runs.map((run) => run.length);
  walk(cells, lengths, (k) => (done[k] = true));
  walk(
    cells.reverse(),
    lengths.reverse(),
    (k) => (done[runs.length - 1 - k] = true),
  );
  return done;
}
