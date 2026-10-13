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
 * longest clue (at least one, for "0"); cells shrink to fit but never below 14 px.
 */
export function previewLayout(puzzle: Puzzle, availableWidth: number) {
  const longest = (lines: Puzzle['rows']) =>
    Math.max(1, ...lines.map((runs) => runs.length));
  const clueCols = longest(puzzle.rows);
  const clueRows = longest(puzzle.cols);
  const fit = Math.floor(availableWidth / (puzzle.width + clueCols));
  const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, fit));
  return {
    cell,
    clueCols,
    clueRows,
    width: (clueCols + puzzle.width) * cell,
    height: (clueRows + puzzle.height) * cell,
  };
}
