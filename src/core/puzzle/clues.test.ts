import { describe, expect, it } from 'vitest';
import { clueLabels, lineClues, makePuzzle } from './clues.ts';
import { createGrid, gridColumn, gridFromRows, gridRow } from './grid.ts';
import { randomGrid } from '../test-utils.ts';
import type { Puzzle } from './types.ts';

const runs = (...lengths: number[]) =>
  lengths.map((length) => ({ length, color: 1 }));
const line = (s: string) => Uint8Array.from(s, Number);

// Independent, obviously-correct clue calculation for black-and-white lines.
const oracle = (cells: ArrayLike<number>) =>
  runs(
    ...Array.from(cells)
      .join('')
      .split(/0+/)
      .filter(Boolean)
      .map((s) => s.length),
  );

function expectMatchesOracle(puzzle: Puzzle) {
  const { solution } = puzzle;
  expect(puzzle.rows).toHaveLength(solution.height);
  expect(puzzle.cols).toHaveLength(solution.width);
  puzzle.rows.forEach((clue, y) =>
    expect(clue).toEqual(oracle(gridRow(solution, y))),
  );
  puzzle.cols.forEach((clue, x) =>
    expect(clue).toEqual(oracle(gridColumn(solution, x))),
  );
}

describe('lineClues', () => {
  it.each([
    ['0000000', []],
    ['1111111', [7]],
    ['1101110', [2, 3]],
    ['1010101', [1, 1, 1, 1]],
    ['1100011', [2, 2]],
    ['0001000', [1]],
  ])('%s gives %j', (cells, expected) => {
    expect(lineClues(line(cells))).toEqual(runs(...expected));
  });

  it('keeps adjacent runs of different colors apart', () => {
    expect(lineClues([1, 1, 2, 2, 0, 1])).toEqual([
      { length: 2, color: 1 },
      { length: 2, color: 2 },
      { length: 1, color: 1 },
    ]);
  });
});

describe('clueLabels', () => {
  it('shows an empty line as "0"', () => {
    expect(clueLabels(lineClues(line('0000000')))).toEqual(['0']);
  });

  it('shows run lengths in order', () => {
    expect(clueLabels(lineClues(line('1101110')))).toEqual(['2', '3']);
  });
});

describe('makePuzzle', () => {
  it('handles 1x1 grids', () => {
    expect(makePuzzle(gridFromRows(['1']))).toMatchObject({
      rows: [runs(1)],
      cols: [runs(1)],
    });
    expect(makePuzzle(gridFromRows(['0']))).toMatchObject({
      rows: [[]],
      cols: [[]],
    });
  });

  it('builds row and column clues for a 5x5 grid', () => {
    const solution = gridFromRows([
      '11100',
      '00100',
      '00111',
      '00001',
      '10001',
    ]);
    expect(makePuzzle(solution)).toEqual({
      width: 5,
      height: 5,
      rows: [runs(3), runs(1), runs(3), runs(1), runs(1, 1)],
      cols: [runs(1, 1), runs(1), runs(3), runs(1), runs(3)],
      solution,
      palette: ['#fff', '#000'],
    });
  });

  it('handles a non-square 37x22 grid', () => {
    const puzzle = makePuzzle(randomGrid(37, 22, 1));
    expect(puzzle).toMatchObject({ width: 37, height: 22 });
    expectMatchesOracle(puzzle);
  });

  it('handles 50x50 grids', () => {
    const full = makePuzzle(createGrid(50, 50, new Uint8Array(2500).fill(1)));
    expect(
      full.rows.every((clue) => clue.length === 1 && clue[0]!.length === 50),
    ).toBe(true);
    expect(
      full.cols.every((clue) => clue.length === 1 && clue[0]!.length === 50),
    ).toBe(true);

    const empty = makePuzzle(createGrid(50, 50));
    expect(
      [...empty.rows, ...empty.cols].every((clue) => clue.length === 0),
    ).toBe(true);

    expectMatchesOracle(makePuzzle(randomGrid(50, 50, 42)));
  });
});
