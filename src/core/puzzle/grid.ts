import type { Grid } from './types.ts';

export function createGrid(
  width: number,
  height: number,
  cells?: Uint8Array,
): Grid {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RangeError(
      `Grid size must be positive integers, got ${width}x${height}`,
    );
  }
  cells ??= new Uint8Array(width * height);
  if (cells.length !== width * height) {
    throw new RangeError(
      `Expected ${width * height} cells, got ${cells.length}`,
    );
  }
  return { width, height, cells };
}

/** Parses rows such as `['1101110', …]`; handy for tests and fixtures. */
export function gridFromRows(rows: string[]): Grid {
  const width = rows[0]?.length ?? 0;
  if (rows.some((row) => row.length !== width || !/^\d*$/.test(row))) {
    throw new RangeError('Rows must be equal-length strings of digits');
  }
  return createGrid(width, rows.length, Uint8Array.from(rows.join(''), Number));
}

/** A view into the grid, not a copy. */
export function gridRow(grid: Grid, y: number): Uint8Array {
  return grid.cells.subarray(y * grid.width, (y + 1) * grid.width);
}

export function gridColumn(grid: Grid, x: number): Uint8Array {
  return Uint8Array.from(
    { length: grid.height },
    (_, y) => grid.cells[y * grid.width + x]!,
  );
}
