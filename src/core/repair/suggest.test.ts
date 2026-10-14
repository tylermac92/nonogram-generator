import { describe, expect, it } from 'vitest';
import { adjust, binarize, downscale } from '../image/pipeline.ts';
import type { GrayImage } from '../image/types.ts';
import { makePuzzle } from '../puzzle/clues.ts';
import { applyEdits } from '../puzzle/grid.ts';
import { solve } from '../solver/solve.ts';
import {
  DULL,
  fillFraction,
  suggestSettings,
  type ScanRequest,
} from './suggest.ts';

/** White image with [x, y, width, height, gray] rectangles. */
function image(width: number, height: number, rects: number[][]): GrayImage {
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (const [x, y, w, h, v] of rects) {
    for (let j = y!; j < y! + h!; j++)
      data.fill(v!, j * width + x!, j * width + x! + w!);
  }
  return { width, height, data };
}

const diagonal = [
  [0, 0, 100, 50, 0],
  [100, 50, 100, 50, 0],
];
/** The ambiguous diagonal plus a gray (100) 2×2-cell patch: a cutoff above 100 fills it, which breaks the tie. */
const patched = image(200, 100, [...diagonal, [140, 20, 20, 20, 100]]);

const request = (
  gray: GrayImage,
  cutoff: number,
  edits = new Map(),
): ScanRequest => ({
  gray,
  crop: { x: 0, y: 0, width: 200, height: 100 },
  sizes: [17, 18, 19, 20, 21, 22, 23].map((width) => ({
    width,
    height: Math.round(width / 2),
  })),
  width: 20,
  cutoff,
  brightness: 0,
  contrast: 0,
  invert: false,
  edits,
});

/** The grid a suggestion gives once applied, built the way the creator builds it. */
function apply(
  r: ScanRequest,
  { width, cutoff }: { width: number; cutoff: number },
) {
  const height = Math.round(width / 2);
  const values = adjust(downscale(r.gray, r.crop, width, height), 0, 0);
  const grid = binarize(values, width, height, cutoff, false);
  return width === r.width ? applyEdits(grid, r.edits) : grid;
}

describe('suggestSettings', () => {
  it('finds passing settings near failing ones, closest first', () => {
    const r = request(patched, 90);
    expect(solve(makePuzzle(apply(r, { width: 20, cutoff: 90 }))).status).toBe(
      'stuck',
    );
    const suggestions = suggestSettings(r);
    expect(suggestions[0]).toEqual({ width: 20, cutoff: 102 });
    expect(suggestions.length).toBeLessThanOrEqual(3);
    const distance = ({ width, cutoff }: { width: number; cutoff: number }) =>
      Math.abs(cutoff - 90) / 30 + Math.abs(width - 20) / 3;
    for (const [i, s] of suggestions.entries()) {
      const grid = apply(r, s);
      expect(solve(makePuzzle(grid)).status).toBe('solved');
      const fill = fillFraction(grid);
      expect(fill).toBeGreaterThanOrEqual(DULL.below);
      expect(fill).toBeLessThanOrEqual(DULL.above);
      if (i > 0)
        expect(distance(s)).toBeGreaterThanOrEqual(
          distance(suggestions[i - 1]!),
        );
    }
  });

  it('scans with the edits at the current width', () => {
    // Clearing the patch cells by hand undoes what a higher cutoff would fill in.
    const patch = [54, 55, 74, 75].map((i): [number, number] => [i, 0]);
    const edited = request(patched, 90, new Map(patch));
    const suggestions = suggestSettings(edited);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.width).not.toBe(20);
      expect(solve(makePuzzle(apply(edited, s))).status).toBe('solved');
    }
  });

  it('never suggests a dull grid', () => {
    // One small dark patch: every grid in range is nearly empty, and those solve trivially.
    const speck = image(200, 100, [[0, 0, 20, 20, 120]]);
    const r = { ...request(speck, 130), sizes: [{ width: 20, height: 10 }] };
    expect(suggestSettings(r)).toEqual([]);
  });

  it('only suggests the sizes it was given', () => {
    const r = { ...request(patched, 90), sizes: [{ width: 20, height: 10 }] };
    expect(suggestSettings(r).every((s) => s.width === 20)).toBe(true);
  });

  it('scans a 50-wide grid at 7 widths in well under 3 seconds', () => {
    // Every pixel different, so no two cutoffs give the same grid.
    const size = 1000;
    const data = new Uint8ClampedArray(size * size).map(
      (_, i) =>
        ((i % size) / 4 + Math.floor(i / size) / 8 + ((i * 7919) % 97)) % 256,
    );
    const r: ScanRequest = {
      ...request({ width: size, height: size, data }, 128),
      crop: { x: 0, y: 0, width: size, height: size },
      sizes: [44, 45, 46, 47, 48, 49, 50].map((w) => ({ width: w, height: w })),
      width: 47,
    };
    const start = performance.now();
    suggestSettings(r);
    expect(performance.now() - start).toBeLessThan(3000);
  });
});
