import { describe, expect, it } from 'vitest';
import { CROSS, FILLED, isSolved, mistakes } from './board.ts';
import { makePuzzle } from './clues.ts';
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
