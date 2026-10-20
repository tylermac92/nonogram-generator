import { describe, expect, it } from 'vitest';
import {
  completedClues,
  CROSS,
  EMPTY,
  FILLED,
  isSolved,
  mistakes,
} from './board.ts';
import { lineClues, makePuzzle } from './clues.ts';
import { random } from '../test-utils.ts';
import { gridFromRows } from './grid.ts';

const rows = ['11000', '01100', '00000', '10001', '11111'];
const puzzle = makePuzzle(gridFromRows(rows));
const solution = puzzle.solution.cells;

describe('mistakes', () => {
  it('finds nothing on an empty board', () => {
    expect(mistakes(puzzle, new Uint8Array(25))).toEqual([]);
    expect(isSolved(puzzle, new Uint8Array(25))).toBe(false);
  });

  it('counts wrongly filled cells, never X marks', () => {
    const board = new Uint8Array(25);
    board[2] = FILLED; // should be empty
    board[0] = board[1] = CROSS; // X on cells that should be filled
    board[10] = CROSS; // X on an empty cell
    expect(mistakes(puzzle, board)).toEqual([2]);
  });
});

describe('isSolved', () => {
  it('accepts the solution with X marks on the empty cells', () => {
    const board = solution.map((v) => (v ? FILLED : CROSS));
    expect(isSolved(puzzle, board)).toBe(true);
  });

  it('rejects a board one cell short', () => {
    const board = solution.slice();
    board[24] = 0;
    expect(isSolved(puzzle, board)).toBe(false);
  });

  it('rejects a board whose rows match but columns do not', () => {
    const diagonal = makePuzzle(gridFromRows(['10', '01']));
    expect(isSolved(diagonal, Uint8Array.from([1, 0, 1, 0]))).toBe(false);
  });

  it('accepts a different answer that matches every clue', () => {
    const diagonal = makePuzzle(gridFromRows(['10', '01']));
    expect(isSolved(diagonal, Uint8Array.from([0, 1, 1, 0]))).toBe(true);
  });
});

/** '#' filled, 'x' an X mark, '.' blank. */
const line = (text: string) =>
  Array.from(text, (c) => (c === '#' ? FILLED : c === 'x' ? CROSS : EMPTY));
const clue = (...lengths: number[]) =>
  lengths.map((length) => ({ length, color: 1 }));

describe('completedClues', () => {
  it.each([
    ['filled runs match, blanks unmarked', clue(2, 1), '.##..#.', [true, true]],
    ['a closed run from the left', clue(2, 1), 'x##x...', [true, false]],
    ['a closed run from the right', clue(2, 1), '.....x#', [false, true]],
    ['a closed run of the wrong length', clue(2, 1), '###x...', [false, false]],
    ['a run touching a blank cell', clue(2, 1), '##.....', [false, false]],
    ['a run after a blank cell', clue(2, 1), '.##x...', [false, false]],
    [
      'a grey run broken by one more cell',
      clue(2, 1),
      'x###...',
      [false, false],
    ],
    ['an empty clue on an empty line', clue(), '.x...', [true]],
    ['an empty clue with a filled cell', clue(), '..#..', [false]],
    [
      'both ends, middle unsettled',
      clue(1, 2, 1),
      '#x.....x#',
      [true, false, true],
    ],
  ])('%s', (_, runs, text, expected) => {
    expect(completedClues(runs, line(text))).toEqual(expected);
  });

  it('only greys runs already drawn, however the line is finished', () => {
    const next = random(17);
    let greyed = 0;
    for (let t = 0; t < 3000; t++) {
      const solution = Array.from({ length: 10 }, () => (next() < 0.5 ? 1 : 0));
      const runs = lineClues(solution);
      // Reveal some cells; blanks are the player's open cells.
      const board = solution.map((v) =>
        next() < 0.6 ? (v ? FILLED : CROSS) : EMPTY,
      );
      const done = completedClues(runs, board);
      if (!runs.length) continue;
      const open = board.flatMap((v, i) => (v === EMPTY ? [i] : []));
      for (let mask = 0; mask < 1 << open.length; mask++) {
        const filled: number[] = board.map((v) => (v === FILLED ? 1 : 0));
        open.forEach((i, b) => (filled[i] = (mask >> b) & 1));
        const found = lineClues(filled);
        if (
          found.length !== runs.length ||
          found.some((run, k) => run.length !== runs[k]!.length)
        ) {
          continue; // not a way to finish this line
        }
        // Where each run of this finished line sits.
        let k = -1;
        filled.forEach((v, i) => {
          if (v && !filled[i - 1]) k++;
          if (v && done[k]) expect(board[i], `${board} run ${k}`).toBe(FILLED);
        });
      }
      greyed += done.filter(Boolean).length;
    }
    expect(greyed).toBeGreaterThan(1000); // the check above saw real cases
  });
});
