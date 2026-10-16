import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../puzzle/clues.ts';
import { gridFromRows } from '../puzzle/grid.ts';
import { CELL, renderSvg } from './svg.ts';

// 10x10: row 0 is "1 1 3", row 9 is empty, column 0 is "1 1".
const rows = [
  '1010111000',
  '0000000000',
  '1000000000',
  '0000000000',
  '0000000000',
  '0000000000',
  '0000000000',
  '0000000000',
  '0000000000',
  '0000000000',
];
const puzzle = makePuzzle(gridFromRows(rows));
// Longest row clue has 3 numbers, longest column clue 2; 10 px padding.
const left = 10 + 3 * CELL;
const top = 10 + 2 * CELL;

const attrs = (svg: string, tag: string) =>
  [...svg.matchAll(new RegExp(`<${tag} ([^>]*)/?>`, 'g'))].map((m) =>
    Object.fromEntries(
      [...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    ),
  );
const texts = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);

describe('renderSvg', () => {
  it('sizes the drawing to the clue areas and grid', () => {
    const svg = renderSvg(puzzle);
    const size = left + 10 * CELL + 10;
    const height = top + 10 * CELL + 10;
    expect(svg).toMatch(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}" viewBox="0 0 ${size} ${height}">`,
    );
  });

  it('writes row clues, then column clues, in order, with 0 for empty lines', () => {
    const t = texts(renderSvg(puzzle));
    // Rows: "1 1 3", "0", "1", then seven "0"s.
    expect(t.slice(0, 6)).toEqual(['1', '1', '3', '0', '1', '0']);
    // Columns: "1 1", "0", "1", "0", "1", "1", "1", "0", "0", "0".
    expect(t.slice(12)).toEqual([
      '1',
      '1',
      '0',
      '1',
      '0',
      '1',
      '1',
      '1',
      '0',
      '0',
      '0',
    ]);
    // The first row's "3" sits in the slot next to the grid.
    const third = attrs(renderSvg(puzzle), 'text')[2]!;
    expect(Number(third.x)).toBe(left - CELL / 2);
  });

  it('draws bold lines every 5 cells and around the grid, thin lines elsewhere', () => {
    const svg = renderSvg(puzzle);
    const [thin, bold] = [...svg.matchAll(/<g stroke[^>]*>(.*?)<\/g>/g)].map(
      (m) => attrs(m[1]!, 'line'),
    );
    const vertical = (lines: Record<string, string>[]) =>
      lines.filter((l) => l.x1 === l.x2).map((l) => Number(l.x1));
    expect(vertical(bold!)).toEqual([0, 5, 10].map((k) => left + k * CELL));
    expect(vertical(thin!)).toEqual(
      [1, 2, 3, 4, 6, 7, 8, 9].map((k) => left + k * CELL + 0.5),
    );
    const horizontal = bold!.filter((l) => l.y1 === l.y2).map((l) => l.y1);
    expect(horizontal.map(Number)).toEqual(
      [0, 5, 10].map((k) => top + k * CELL),
    );
  });

  it('fills cells only in the solution variant', () => {
    const cellRects = (svg: string) =>
      attrs(svg, 'rect').filter((r) => r.width === String(CELL));
    expect(cellRects(renderSvg(puzzle))).toEqual([]);
    const filled = cellRects(renderSvg(puzzle, { solution: true }));
    expect(filled).toHaveLength(6);
    expect(filled[4]).toMatchObject({
      x: String(left + 6 * CELL),
      y: String(top),
    });
    expect(filled[5]).toMatchObject({
      x: String(left),
      y: String(top + 2 * CELL),
    });
  });
});
