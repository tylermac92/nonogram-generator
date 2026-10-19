import { describe, expect, it } from 'vitest';
import { createGrid } from '../puzzle/grid.ts';
import { randomGrid } from '../test-utils.ts';
import { decodeShare, encodeShare } from './share.ts';

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const big = randomGrid(50, 50, 3);
const cellsOf = (g: { cells: Uint8Array }) => Array.from(g.cells);

describe('share links', () => {
  it('round-trips every size from 5x5 to 50x50', () => {
    const wrong: string[] = [];
    for (let w = 5; w <= 50; w++) {
      for (let h = 5; h <= 50; h++) {
        const grid = randomGrid(w, h, w * 100 + h);
        const back = decodeShare(encodeShare(grid));
        const same =
          back.width === w &&
          back.height === h &&
          back.cells.every((v, i) => v === grid.cells[i]);
        if (!same) wrong.push(`${w}x${h}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('fits a 50x50 in 423 base64url characters', () => {
    const payload = encodeShare(big);
    expect(payload).toHaveLength(423);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects every truncation', () => {
    const payload = encodeShare(big);
    for (let k = 0; k < payload.length; k++) {
      expect(() => decodeShare(payload.slice(0, k))).toThrow();
    }
  });

  it('rejects every single-character change, unless it decodes to the same grid', () => {
    for (const grid of [big, randomGrid(17, 9, 5)]) {
      const payload = encodeShare(grid);
      for (let i = 0; i < payload.length; i++) {
        for (const c of ALPHABET) {
          if (c === payload[i]) continue;
          const changed = payload.slice(0, i) + c + payload.slice(i + 1);
          let decoded;
          try {
            decoded = decodeShare(changed);
          } catch {
            continue;
          }
          // Only the last character's unused low bits can change harmlessly.
          expect(i).toBe(payload.length - 1);
          expect(cellsOf(decoded)).toEqual(cellsOf(grid));
        }
      }
    }
  }, 20_000); // about 27,000 decodes

  it('rejects an unknown format, a bad size, and stray characters', () => {
    const payload = encodeShare(randomGrid(10, 10, 1));
    const withHeader = (bytes: number[]) =>
      btoa(
        String.fromCharCode(
          ...bytes,
          ...atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
            .slice(3)
            .split('')
            .map((c) => c.charCodeAt(0)),
        ),
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    expect(() => decodeShare(withHeader([2, 10, 10]))).toThrow(
      'unknown format',
    );
    expect(() => decodeShare(withHeader([1, 4, 10]))).toThrow('bad size');
    expect(() => decodeShare(withHeader([1, 51, 10]))).toThrow('bad size');
    expect(() => decodeShare(payload + '=')).toThrow('bad characters');
    expect(() => decodeShare(payload + 'AAAA')).toThrow('bad length');
    expect(() => decodeShare('')).toThrow();
  });

  it('hides runs: no character repeats more than 4 times', () => {
    const fills = [() => 0, () => 1, (i: number) => Math.floor(i / 50) % 2];
    for (const fill of fills) {
      const grid = createGrid(
        50,
        50,
        Uint8Array.from({ length: 2500 }, (_, i) => fill(i)),
      );
      const longest = Math.max(
        ...encodeShare(grid)
          .match(/(.)\1*/g)!
          .map((run) => run.length),
      );
      expect(longest).toBeLessThanOrEqual(4);
    }
  });
});
