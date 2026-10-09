import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { createGrid } from '../core/puzzle/grid.ts';
import { gridHeight, previewLayout } from './layout.ts';

describe('gridHeight', () => {
  it('keeps the image proportions', () => {
    expect(gridHeight(200, 100, 20)).toBe(10);
    expect(gridHeight(400, 400, 20)).toBe(20);
  });

  it('clamps to 5–50', () => {
    expect(gridHeight(100, 300, 20)).toBe(50);
    expect(gridHeight(1000, 100, 5)).toBe(5);
  });
});

describe('previewLayout', () => {
  const checkerboard = makePuzzle(
    createGrid(
      50,
      50,
      Uint8Array.from({ length: 2500 }, (_, i) => (i + Math.floor(i / 50)) % 2),
    ),
  );

  it('sizes clue areas to the longest clue', () => {
    const layout = previewLayout(checkerboard, 1200);
    expect([layout.clueCols, layout.clueRows, layout.cell]).toEqual([
      25, 25, 16,
    ]);
    expect([layout.width, layout.height]).toEqual([1200, 1200]);
  });

  it('never makes cells smaller than 14 px', () => {
    expect(previewLayout(checkerboard, 900).cell).toBe(14);
  });

  it('leaves room for "0" and caps cell size on small grids', () => {
    const layout = previewLayout(makePuzzle(createGrid(5, 5)), 1200);
    expect([layout.clueCols, layout.clueRows, layout.cell]).toEqual([1, 1, 32]);
  });
});
