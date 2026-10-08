import { describe, expect, it } from 'vitest';
import { lineClues } from '../puzzle/clues.ts';
import type { ClueRun } from '../puzzle/types.ts';
import { random } from '../test-utils.ts';
import { EMPTY, FILLED, solveLine } from './line.ts';

const runs = (...lengths: number[]): ClueRun[] =>
  lengths.map((length) => ({ length, color: 1 }));
// '?' unknown, '#' filled, '.' empty
const parse = (s: string) =>
  Uint8Array.from(s, (c) => (c === '#' ? FILLED : c === '.' ? EMPTY : 3));
const show = (line: Uint8Array) =>
  Array.from(line, (m) => (m === FILLED ? '#' : m === EMPTY ? '.' : '?')).join(
    '',
  );

/** Tries every filling; returns the OR of all that fit, or null if none do. */
function bruteForce(clue: ClueRun[], line: Uint8Array): Uint8Array | null {
  const n = line.length;
  const target = clue.map((r) => r.length).join();
  const result = new Uint8Array(n);
  let found = false;
  for (let bits = 0; bits < 1 << n; bits++) {
    const cells = Array.from({ length: n }, (_, i) => (bits >> i) & 1);
    if (cells.some((v, i) => !(line[i]! & (v ? FILLED : EMPTY)))) continue;
    if (
      lineClues(cells)
        .map((r) => r.length)
        .join() !== target
    )
      continue;
    found = true;
    cells.forEach((v, i) => (result[i]! |= v ? FILLED : EMPTY));
  }
  return found ? result : null;
}

describe('solveLine', () => {
  it.each([
    ['?????', [3], '??#??'],
    ['?????', [2, 2], '##.##'],
    ['?????', [], '.....'],
    ['?#???', [1], '.#...'],
  ])('%s with %j becomes %s', (input, clue, expected) => {
    const line = parse(input);
    expect(solveLine(runs(...clue), line)).toBe(true);
    expect(show(line)).toBe(expected);
  });

  it.each([
    ['???', [2, 2]],
    ['###', [1]],
  ])('%s with %j is a contradiction', (input, clue) => {
    expect(solveLine(runs(...clue), parse(input))).toBe(false);
  });

  it('matches brute force on random lines', () => {
    const next = random(7);
    for (let c = 0; c < 1500; c++) {
      const n = 1 + Math.floor(next() * 12);
      const truth = Array.from({ length: n }, () => (next() < 0.55 ? 1 : 0));
      // Usually the truth's clue; sometimes an unrelated one.
      const clue =
        next() < 0.8
          ? lineClues(truth)
          : lineClues(Array.from({ length: n }, () => (next() < 0.5 ? 1 : 0)));
      // Reveal some cells, occasionally wrongly, to exercise contradictions.
      const line = Uint8Array.from(truth, (v) => {
        if (next() > 0.3) return 3;
        const shown = next() < 0.9 ? v : 1 - v;
        return shown ? FILLED : EMPTY;
      });
      const expected = bruteForce(clue, line);
      const input = show(line);
      const ok = solveLine(clue, line);
      const label = `case ${c}: ${input} ${JSON.stringify(clue.map((r) => r.length))}`;
      expect(ok, label).toBe(expected !== null);
      if (expected) expect(show(line), label).toBe(show(expected));
    }
  });
});
