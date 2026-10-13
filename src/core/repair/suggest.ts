import { adjust, binarize, downscale } from '../image/pipeline.ts';
import type { GrayImage, Rect } from '../image/types.ts';
import { makePuzzle } from '../puzzle/clues.ts';
import { applyEdits, type Edits } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import { solve } from '../solver/solve.ts';

/** Fill fractions outside these bounds make a dull puzzle (and line-solve trivially). */
export const DULL = { below: 0.05, above: 0.9 };

export const fillFraction = (grid: Grid) =>
  grid.cells.reduce((sum, v) => sum + v, 0) / grid.cells.length;

export interface ScanRequest {
  gray: GrayImage;
  crop: Rect;
  sizes: { width: number; height: number }[]; // the widths the crop allows, within ±3
  width: number;
  cutoff: number; // Auto already resolved to its value
  brightness: number;
  contrast: number;
  invert: boolean;
  edits: Edits; // applied at the current width only: other widths clear them
}

export interface Suggestion {
  width: number;
  cutoff: number;
}

const CUTOFF_RANGE = 30;
const CUTOFF_STEP = 2;
const WIDTH_RANGE = 3;

/**
 * Up to three cutoff and width combinations near the current ones whose
 * puzzle line-solves and isn't dull, closest first.
 */
export function suggestSettings(request: ScanRequest): Suggestion[] {
  const { gray, crop, width, cutoff, brightness, contrast, invert, edits } =
    request;
  const found: (Suggestion & { distance: number })[] = [];
  for (const size of request.sizes) {
    const values = adjust(
      downscale(gray, crop, size.width, size.height),
      brightness,
      contrast,
    );
    for (let d = -CUTOFF_RANGE; d <= CUTOFF_RANGE; d += CUTOFF_STEP) {
      const level = cutoff + d;
      if (level < 0 || level > 255) continue;
      let grid = binarize(values, size.width, size.height, level, invert);
      if (size.width === width) grid = applyEdits(grid, edits);
      const fill = fillFraction(grid);
      if (fill < DULL.below || fill > DULL.above) continue;
      if (solve(makePuzzle(grid)).status !== 'solved') continue;
      found.push({
        width: size.width,
        cutoff: level,
        distance:
          Math.abs(d) / CUTOFF_RANGE +
          Math.abs(size.width - width) / WIDTH_RANGE,
      });
    }
  }
  return found
    .sort(
      (a, b) =>
        // On a tie, keep the current width: changing it clears the edits.
        a.distance - b.distance ||
        Number(a.width !== width) - Number(b.width !== width),
    )
    .slice(0, 3)
    .map(({ width, cutoff }) => ({ width, cutoff }));
}
