import { describe, expect, it } from 'vitest';
import { lineClues, makePuzzle } from '../puzzle/clues.ts';
import { createGrid } from '../puzzle/grid.ts';
import { needsGuessing, random, randomGrid } from '../test-utils.ts';
import { EMPTY, FILLED, solveLine, UNKNOWN } from './line.ts';
import { overlapLine, play } from './player.ts';
import { solve } from './solve.ts';

// A character's index in this string is its mask: . EMPTY, # FILLED, ? UNKNOWN.
const MASKS = ' .#?';
const line = (s: string) => Uint8Array.from(s, (c) => MASKS.indexOf(c));
const show = (l: Uint8Array) => Array.from(l, (m) => MASKS[m]).join('');
const runs = (...lengths: number[]) =>
  lengths.map((length) => ({ length, color: 1 }));

describe('overlapLine', () => {
  it('fills where a run overlaps itself pushed left and right', () => {
    const l = line('??????????');
    expect(overlapLine(runs(8), l)).toBe(true);
    expect(show(l)).toBe('??######??');
  });

  it('uses known cells and empties cells no run can reach', () => {
    const l = line('#????');
    overlapLine(runs(1), l);
    expect(show(l)).toBe('#....');
  });

  it('empties a line with an empty clue', () => {
    const l = line('?????');
    overlapLine([], l);
    expect(show(l)).toBe('.....');
  });

  it('reports a line its clue cannot fit', () => {
    expect(overlapLine(runs(3), line('?.?.?'))).toBe(false);
  });

  it('never contradicts full line logic and is sometimes weaker', () => {
    const next = random(7);
    let weaker = 0;
    for (let t = 0; t < 2000; t++) {
      const n = 4 + Math.floor(next() * 9);
      const solution = Array.from({ length: n }, () => (next() < 0.5 ? 1 : 0));
      const clue = lineClues(solution);
      const known = Uint8Array.from(solution, (v) =>
        next() < 0.3 ? (v ? FILLED : EMPTY) : UNKNOWN,
      );
      const simple = known.slice();
      const full = known.slice();
      expect(overlapLine(clue, simple)).toBe(true);
      expect(solveLine(clue, full)).toBe(true);
      simple.forEach((m, i) => {
        if (m !== UNKNOWN) expect(m, `${show(known)} ${i}`).toBe(full[i]);
      });
      if (show(simple) !== show(full)) weaker++;
    }
    expect(weaker).toBeGreaterThan(0);
  });
});

describe('play', () => {
  it('solves a full grid in one sweep with no hard steps', () => {
    const result = play(
      makePuzzle(createGrid(5, 5, new Uint8Array(25).fill(1))),
    );
    expect(result).toEqual({ solved: true, reads: 10, hard: 0 });
  });

  it('gives up on a puzzle that needs guessing', () => {
    expect(play(makePuzzle(needsGuessing)).solved).toBe(false);
  });

  it('solves every line-solvable random grid', () => {
    for (let seed = 0; seed < 40; seed++) {
      const puzzle = makePuzzle(randomGrid(12, 10, seed, 0.6));
      const solvable = solve(puzzle).status === 'solved';
      expect(play(puzzle).solved, `seed ${seed}`).toBe(solvable);
    }
  });
});
