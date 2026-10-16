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
