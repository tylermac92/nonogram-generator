import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { createGrid } from '../core/puzzle/grid.ts';
import { random } from '../core/test-utils.ts';
import {
  alongAxis,
  axisOf,
  cellAt,
  gridSize,
  lineCells,
  previewLayout,
} from './layout.ts';

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

  it('finds the grid cell under a point', () => {
    const layout = previewLayout(checkerboard, 1200); // 16 px cells, 25 clue cells
    const at = (x: number, y: number) => cellAt(layout, checkerboard, x, y);
    expect(at(400, 400)).toBe(0);
    expect(at(1199, 1199)).toBe(2499);
    expect(at(416, 432)).toBe(2 * 50 + 1);
    expect(at(399, 500)).toBeNull(); // row clues
    expect(at(500, 399)).toBeNull(); // column clues
    expect(at(1200, 500)).toBeNull();
    expect(at(500, 1200)).toBeNull();
  });
});

describe('lineCells', () => {
  it('lists every cell between two cells', () => {
    expect(lineCells(0, 4, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(lineCells(4, 0, 10)).toEqual([4, 3, 2, 1, 0]);
    expect(lineCells(3, 33, 10)).toEqual([3, 13, 23, 33]);
    expect(lineCells(0, 33, 10)).toEqual([0, 11, 22, 33]);
    expect(lineCells(0, 12, 10)).toEqual([0, 11, 12]);
    expect(lineCells(7, 7, 10)).toEqual([7]);
  });
});

describe('alongAxis', () => {
  // 10 wide; start at (2, 3) = 32.
  it('keeps a diagonal drift on the start row', () => {
    expect(axisOf(32, 55, 10)).toBe('row'); // (5, 5): further across than down
    expect(alongAxis(32, 55, 10, 'row')).toBe(35);
    expect(alongAxis(32, 99, 10, 'row')).toBe(39);
  });

  it('keeps a diagonal drift on the start column', () => {
    expect(axisOf(32, 63, 10)).toBe('column'); // (3, 6): further down than across
    expect(alongAxis(32, 63, 10, 'column')).toBe(62);
    expect(alongAxis(32, 9, 10, 'column')).toBe(2);
  });
});
