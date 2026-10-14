import { createGrid, gridFromRows } from './puzzle/grid.ts';
import type { Grid } from './puzzle/types.ts';

/** Seeded LCG returning numbers in [0, 1), so tests are deterministic. */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function randomGrid(
  width: number,
  height: number,
  seed: number,
  density = 0.5,
): Grid {
  const next = random(seed);
  return createGrid(
    width,
    height,
    Uint8Array.from({ length: width * height }, () =>
      next() < density ? 1 : 0,
    ),
  );
}

/** Unique, but the line solver leaves 75 cells unknown; unchanged by cleanup. Seeded search: randomGrid(10, 10, 31). */
export const needsGuessing = gridFromRows([
  '1110100111',
  '0001100001',
  '0011000001',
  '0011111001',
  '0001011101',
  '1010011001',
  '1111000010',
  '0010011010',
  '1010000100',
  '1100000100',
]);

/** Smooth but repetitive 500×500 gray image: at 30x30 and cutoff 128 the line solver determines nothing, and no single flip helps. */
export function wavesImage() {
  const size = 500;
  const data = new Uint8ClampedArray(size * size).map((_, i) => {
    const x = i % size;
    const y = Math.floor(i / size);
    return (
      128 +
      90 * Math.sin(x / 37) * Math.cos(y / 23) +
      30 * Math.sin((x + y) / 11)
    );
  });
  return { width: size, height: size, data };
}
