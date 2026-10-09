import type { Puzzle } from '../core/puzzle/types.ts';

const MIN_SIZE = 5;
const MAX_SIZE = 50;
const MIN_CELL = 14;
const MAX_CELL = 32;

/** Grid height that keeps the image's proportions, clamped to 5–50. */
export function gridHeight(
  imageWidth: number,
  imageHeight: number,
  width: number,
): number {
  const height = Math.round((width * imageHeight) / imageWidth);
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, height));
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
