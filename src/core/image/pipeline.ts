import { createGrid } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import type { GrayImage, Rect, RgbaImage } from './types.ts';

/** Luminance per pixel, composited onto white by alpha. */
export function toGray({ width, height, data }: RgbaImage): GrayImage {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    const alpha = data[p + 3]! / 255;
    const lum =
      0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!;
    gray[i] = lum * alpha + 255 * (1 - alpha);
  }
  return { width, height, data: gray };
}

/** For each cell along one axis: the first source pixel it touches and how much of each pixel it covers. */
function spans(offset: number, length: number, cells: number) {
  const step = length / cells;
  return Array.from({ length: cells }, (_, c) => {
    const start = offset + c * step;
    const end = start + step;
    const first = Math.floor(start);
    const weights: number[] = [];
    // The epsilon drops slivers left by floating-point error at pixel edges.
    for (let p = first; p < end - 1e-9; p++) {
      weights.push(Math.min(end, p + 1) - Math.max(start, p));
    }
    return { first, weights, total: weights.reduce((a, b) => a + b, 0) };
  });
}

/**
 * Area-average downscale: each cell is the mean of the source pixels it
 * covers, weighted by partial coverage. Rows first, then columns.
 */
export function downscale(
  gray: GrayImage,
  crop: Rect,
  gridWidth: number,
  gridHeight: number,
): Float32Array {
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > gray.width ||
    crop.y + crop.height > gray.height
  ) {
    throw new RangeError('Crop must lie inside the image');
  }
  const xs = spans(crop.x, crop.width, gridWidth);
  const ys = spans(crop.y, crop.height, gridHeight);
  const top = ys[0]!.first;
  const last = ys[gridHeight - 1]!;
  const rows = last.first + last.weights.length - top;

  // Pass 1: each source row in range, summed into gridWidth columns.
  const rowSums = new Float64Array(rows * gridWidth);
  for (let r = 0; r < rows; r++) {
    const offset = (top + r) * gray.width;
    xs.forEach(({ first, weights }, gx) => {
      let sum = 0;
      weights.forEach((w, i) => (sum += w * gray.data[offset + first + i]!));
      rowSums[r * gridWidth + gx] = sum;
    });
  }

  // Pass 2: combine rows into cells and divide by the covered area.
  const out = new Float32Array(gridWidth * gridHeight);
  ys.forEach(({ first, weights, total }, gy) => {
    for (let gx = 0; gx < gridWidth; gx++) {
      let sum = 0;
      weights.forEach(
        (w, i) => (sum += w * rowSums[(first - top + i) * gridWidth + gx]!),
      );
      out[gy * gridWidth + gx] = sum / (total * xs[gx]!.total);
    }
  });
  return out;
}

/** Brightness and contrast, each −100…100; (0, 0) leaves values unchanged. */
export function adjust(
  values: Float32Array,
  brightness: number,
  contrast: number,
): Float32Array {
  const scale = (100 + contrast) / 100;
  const shift = 128 + brightness * 1.28;
  return values.map((v) =>
    Math.min(255, Math.max(0, (v - 128) * scale + shift)),
  );
}

/**
 * Otsu's cutoff over a 256-bin histogram (cells with value < cutoff are
 * dark). When several splits tie, takes the middle one; single-tone input
 * gives 128.
 */
export function otsu(values: ArrayLike<number>): number {
  const histogram = new Float64Array(256);
  let sumAll = 0;
  for (let i = 0; i < values.length; i++) {
    const bin = Math.min(255, Math.max(0, Math.round(values[i]!)));
    histogram[bin]!++;
    sumAll += bin;
  }
  let below = 0;
  let sumBelow = 0;
  let best = -1;
  let bestFrom = 127;
  let bestTo = 127;
  for (let t = 0; t < 255; t++) {
    below += histogram[t]!;
    sumBelow += t * histogram[t]!;
    const above = values.length - below;
    if (below === 0) continue;
    if (above === 0) break;
    const between =
      below * above * (sumBelow / below - (sumAll - sumBelow) / above) ** 2;
    if (between > best) {
      best = between;
      bestFrom = bestTo = t;
    } else if (between === best) {
      bestTo = t;
    }
  }
  return Math.floor((bestFrom + bestTo) / 2) + 1;
}

/** Filled when value < cutoff; invert flips that. */
export function threshold(
  values: Float32Array,
  width: number,
  height: number,
  cutoff: number,
  invert: boolean,
): Grid {
  return createGrid(
    width,
    height,
    Uint8Array.from(values, (v) => (v < cutoff !== invert ? 1 : 0)),
  );
}

/**
 * Removes filled cells with no filled orthogonal neighbor and fills empty
 * cells whose four neighbors are all filled. Reads only the input grid, so
 * the result doesn't depend on visiting order. Border cells are never holes.
 */
export function cleanup(grid: Grid): Grid {
  const { width, height, cells } = grid;
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height ? cells[y * width + x]! : 0;
  const out = cells.map((value, i) => {
    const x = i % width;
    const y = (i - x) / width;
    const neighbors = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (value) return neighbors.some(Boolean) ? value : 0;
    const inside = x > 0 && y > 0 && x < width - 1 && y < height - 1;
    return inside && neighbors.every(Boolean) ? 1 : 0;
  });
  return createGrid(width, height, out);
}
