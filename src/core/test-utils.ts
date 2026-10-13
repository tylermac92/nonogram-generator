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
