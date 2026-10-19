import type { Rect } from '../core/image/types.ts';
import type { Puzzle } from '../core/puzzle/types.ts';

const MIN_SIZE = 5;
const MAX_SIZE = 50;
const MIN_CELL = 14;
const MAX_CELL = 32;

/**
 * Grid size for a crop: height = round(width × crop height ÷ crop width),
 * clamped to 5–50. For tall crops the width's maximum shrinks so the height
 * fits; only crops beyond about 10:1 still need the clamp.
 */
export function gridSize(crop: Rect, width: number) {
  const ratio = crop.height / crop.width;
  let maxWidth = MAX_SIZE;
  while (maxWidth > MIN_SIZE && Math.round(maxWidth * ratio) > MAX_SIZE) {
    maxWidth--;
  }
  const w = Math.min(width, maxWidth);
  const height = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(w * ratio)));
  return { width: w, height, maxWidth };
}

/**
 * Canvas layout in CSS pixels. Clue areas get one cell per number of the
 * longest clue (at least one, for "0"); cells shrink to fit but never below
 * `minCell` (14 px unless the board can be pinch-zoomed).
 */
export function previewLayout(
  puzzle: Puzzle,
  availableWidth: number,
  minCell = MIN_CELL,
) {
  const longest = (lines: Puzzle['rows']) =>
    Math.max(1, ...lines.map((runs) => runs.length));
  const clueCols = longest(puzzle.rows);
  const clueRows = longest(puzzle.cols);
  const fit = Math.floor(availableWidth / (puzzle.width + clueCols));
  const cell = Math.min(MAX_CELL, Math.max(minCell, fit));
  return {
    cell,
    clueCols,
    clueRows,
    width: (clueCols + puzzle.width) * cell,
    height: (clueRows + puzzle.height) * cell,
  };
}

/** The grid cell under canvas point (x, y) in CSS pixels, or null outside the grid. */
export function cellAt(
  layout: ReturnType<typeof previewLayout>,
  puzzle: Puzzle,
  x: number,
  y: number,
): number | null {
  const { cell, clueCols, clueRows } = layout;
  const gx = Math.floor(x / cell) - clueCols;
  const gy = Math.floor(y / cell) - clueRows;
  if (gx < 0 || gy < 0 || gx >= puzzle.width || gy >= puzzle.height) {
    return null;
  }
  return gy * puzzle.width + gx;
}

/** Cells on the straight line between two cell indexes, both ends included. */
export function lineCells(from: number, to: number, width: number): number[] {
  const [x0, y0] = [from % width, Math.floor(from / width)];
  const [x1, y1] = [to % width, Math.floor(to / width)];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = steps && i / steps;
    return (
      Math.round(y0 + (y1 - y0) * t) * width + Math.round(x0 + (x1 - x0) * t)
    );
  });
}

export type Axis = 'row' | 'column';

/** The axis a drag from `start` to `cell` moved further along; ties go to the row. */
export function axisOf(start: number, cell: number, width: number): Axis {
  const dx = Math.abs((cell % width) - (start % width));
  const dy = Math.abs(Math.floor(cell / width) - Math.floor(start / width));
  return dx >= dy ? 'row' : 'column';
}

/** `cell` moved onto the start cell's row or column, so a drifting drag stays on its line. */
export function alongAxis(
  start: number,
  cell: number,
  width: number,
  axis: Axis,
): number {
  return axis === 'row'
    ? Math.floor(start / width) * width + (cell % width)
    : Math.floor(cell / width) * width + (start % width);
}
