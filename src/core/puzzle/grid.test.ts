import { describe, expect, it } from 'vitest';
import { createGrid, gridColumn, gridFromRows, gridRow } from './grid.ts';

describe('grid', () => {
  it('stores cells row-major in a Uint8Array', () => {
    const grid = gridFromRows(['000', '001']);
    expect(grid.cells).toBeInstanceOf(Uint8Array);
    expect(Array.from(grid.cells)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(grid.cells[1 * grid.width + 2]).toBe(1); // (x=2, y=1)
  });

  it('reads rows and columns of a non-square grid', () => {
    const grid = gridFromRows(['100', '011']);
    expect(Array.from(gridRow(grid, 1))).toEqual([0, 1, 1]);
    expect(Array.from(gridColumn(grid, 0))).toEqual([1, 0]);
    expect(Array.from(gridColumn(grid, 2))).toEqual([0, 1]);
  });

  it('creates an empty grid of the given size', () => {
    expect(createGrid(4, 3).cells).toEqual(new Uint8Array(12));
  });

  it('rejects bad sizes and cell counts', () => {
    expect(() => createGrid(0, 5)).toThrow(RangeError);
    expect(() => createGrid(2.5, 2)).toThrow(RangeError);
    expect(() => createGrid(2, 2, new Uint8Array(3))).toThrow(RangeError);
  });

  it('rejects empty, ragged, or non-digit rows', () => {
    expect(() => gridFromRows([])).toThrow(RangeError);
    expect(() => gridFromRows(['10', '1'])).toThrow(RangeError);
    expect(() => gridFromRows(['1x'])).toThrow(RangeError);
  });
});
