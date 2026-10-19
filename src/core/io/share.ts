import { createGrid } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';

const FORMAT = 1;

/**
 * A fixed xorshift byte stream per size. XORed over the packed cells, it hides
 * runs like `AAAA` from a casual look; it is not security.
 */
function scramble(width: number, height: number, n: number): Uint8Array {
  let x = ((width << 8) | height | 0x9e3779b9) >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 255;
  }
  return out;
}

/** Each step is one-to-one in `h`, so any single changed byte changes the result. */
const checksum = (bytes: Uint8Array) =>
  bytes.reduce((h, b) => ((h ^ b) * 31) & 255, 7);

/** Format byte, width, height, cells 8 per byte (scrambled), checksum; base64url without padding. */
export function encodeShare({ width, height, cells }: Grid): string {
  const n = Math.ceil((width * height) / 8);
  const bytes = new Uint8Array(4 + n);
  bytes.set([FORMAT, width, height]);
  cells.forEach((v, i) => {
    if (v) bytes[3 + (i >> 3)]! |= 128 >> (i & 7);
  });
  scramble(width, height, n).forEach((k, i) => (bytes[3 + i]! ^= k));
  bytes[3 + n] = checksum(bytes.subarray(0, 3 + n));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The solution grid from a link payload; throws if anything doesn't check out. */
export function decodeShare(payload: string): Grid {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('bad characters');
  const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/')); // throws on a bad length
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const [format, width = 0, height = 0] = bytes;
  if (format !== FORMAT) throw new Error('unknown format');
  if (width < 5 || width > 50 || height < 5 || height > 50) {
    throw new Error('bad size');
  }
  const n = Math.ceil((width * height) / 8);
  if (bytes.length !== 4 + n) throw new Error('bad length');
  if (checksum(bytes.subarray(0, 3 + n)) !== bytes[3 + n]) {
    throw new Error('bad checksum');
  }
  const key = scramble(width, height, n);
  const cells = Uint8Array.from(
    { length: width * height },
    (_, i) => ((bytes[3 + (i >> 3)]! ^ key[i >> 3]!) >> (7 - (i & 7))) & 1,
  );
  return createGrid(width, height, cells);
}
