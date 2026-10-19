import { beforeAll, describe, expect, it } from 'vitest';
import { decodeImage } from '../core/image/decode.ts';
import {
  adjust,
  binarize,
  downscale,
  otsu,
  toGray,
} from '../core/image/pipeline.ts';
import type { GrayImage, Rect } from '../core/image/types.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import type { Grid } from '../core/puzzle/types.ts';
import { autoFix } from '../core/repair/autofix.ts';
import { DULL, fillFraction, suggestSettings } from '../core/repair/suggest.ts';
import { difficulty, type Difficulty } from '../core/solver/difficulty.ts';
import { solve } from '../core/solver/solve.ts';
import { gridSize } from './layout.ts';
import cameraman from './samples/cameraman.jpg';
import cat from './samples/cat.jpg';
import horse from './samples/horse.jpg';
import sailboat from './samples/sailboat.jpg';
import skyline from './samples/skyline.jpg';

const SAMPLES = { horse, cameraman, cat, sailboat, skyline };
const WIDTHS = [10, 15, 20, 25, 30, 40, 50];
const ORDER: (Difficulty | null)[] = ['Easy', 'Medium', 'Hard', 'Expert'];

/** One sample at one width, built exactly as the creator builds it by default. */
interface Run {
  name: string;
  gray: GrayImage;
  crop: Rect;
  width: number;
  cutoff: number;
  values: Float32Array;
  grid: Grid;
  rating: Difficulty | null; // null when not Valid
}

const runs: Run[] = [];
beforeAll(async () => {
  for (const [name, url] of Object.entries(SAMPLES)) {
    const image = await decodeImage(await (await fetch(url)).blob());
    const gray = toGray(image);
    const crop = { x: 0, y: 0, width: image.width, height: image.height };
    for (const w of WIDTHS) {
      const { width, height } = gridSize(crop, w);
      const raw = downscale(gray, crop, width, height);
      const cutoff = otsu(raw);
      const values = adjust(raw, 0, 0);
      const grid = binarize(values, width, height, cutoff, false);
      const rating = difficulty(solve(makePuzzle(grid)));
      runs.push({ name, gray, crop, width, cutoff, values, grid, rating });
    }
  }
});

describe('sample images', () => {
  it('are all Valid and not dull at the default width', () => {
    for (const run of runs.filter((r) => r.width === 20)) {
      expect(run.rating, run.name).not.toBeNull();
      const fill = fillFraction(run.grid);
      expect(fill, run.name).toBeGreaterThan(DULL.below);
      expect(fill, run.name).toBeLessThan(DULL.above);
    }
  });

  it('rate the same or harder as they grow', () => {
    for (const name of Object.keys(SAMPLES)) {
      const ranks = runs
        .filter((r) => r.name === name && r.rating)
        .map((r) => ORDER.indexOf(r.rating));
      expect(ranks, name).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  // Moved here from M10 and M11, which had no sample images yet.
  it('mostly pass once failing: by a suggestion, and by auto-fix under 2%', () => {
    const failing = runs.filter((r) => !r.rating);
    expect(failing.length).toBeGreaterThan(0);

    const suggested = failing.filter((run) => {
      const sizes = [];
      for (let w = run.width - 3; w <= run.width + 3; w++) {
        const size = gridSize(run.crop, w);
        if (w >= 5 && w <= size.maxWidth) sizes.push(size);
      }
      const [best] = suggestSettings({
        gray: run.gray,
        crop: run.crop,
        sizes,
        width: run.width,
        cutoff: run.cutoff,
        brightness: 0,
        contrast: 0,
        invert: false,
        edits: new Map(),
      });
      if (!best) return false;
      const size = gridSize(run.crop, best.width);
      const values = adjust(
        downscale(run.gray, run.crop, size.width, size.height),
        0,
        0,
      );
      const grid = binarize(
        values,
        size.width,
        size.height,
        best.cutoff,
        false,
      );
      return solve(makePuzzle(grid)).status === 'solved';
    });
    expect(suggested.length).toBeGreaterThan(0);

    const fixed = failing.filter((run) => {
      const result = autoFix({
        grid: run.grid,
        values: run.values,
        cutoff: run.cutoff,
        locked: [],
      });
      return (
        result.reason === 'solved' &&
        result.flips.length < run.grid.cells.length * 0.02
      );
    });
    expect(fixed.length).toBeGreaterThan(failing.length / 2);
  }, 60_000);
});
