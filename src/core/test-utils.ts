import { createGrid } from './puzzle/grid.ts';
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
