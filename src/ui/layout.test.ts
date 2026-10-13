import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { createGrid } from '../core/puzzle/grid.ts';
import { random } from '../core/test-utils.ts';
import { gridSize, previewLayout } from './layout.ts';

describe('gridSize', () => {
  const crop = (width: number, height: number) => ({
    x: 0,
    y: 0,
    width,
    height,
  });

  it('keeps the crop proportions', () => {
    expect(gridSize(crop(400, 400), 20)).toEqual({
      width: 20,
      height: 20,
      maxWidth: 50,
    });
    expect(gridSize(crop(200, 100), 20).height).toBe(10);
  });

  it('lowers the width maximum for tall crops', () => {
    expect(gridSize(crop(100, 300), 30)).toEqual({
      width: 16,
      height: 48,
      maxWidth: 16,
    });
  });

  it('clamps crops too extreme for any width', () => {
    expect(gridSize(crop(10, 1000), 20)).toEqual({
      width: 5,
      height: 50,
      maxWidth: 5,
    });
    expect(gridSize(crop(1000, 10), 50).height).toBe(5);
  });

  it('always stays within 5–50', () => {
    const next = random(3);
    for (let i = 0; i < 1000; i++) {
      const c = crop(
        1 + Math.floor(next() * 2048),
        1 + Math.floor(next() * 2048),
      );
      const size = gridSize(c, 5 + Math.floor(next() * 46));
      expect(size.height).toBeGreaterThanOrEqual(5);
      expect(size.height).toBeLessThanOrEqual(50);
      expect(size.width).toBeGreaterThanOrEqual(5);
      expect(size.width).toBeLessThanOrEqual(size.maxWidth);
      expect(size.maxWidth).toBeLessThanOrEqual(50);
    }
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
