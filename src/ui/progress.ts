import { encodeShare } from '../core/io/share.ts';
import { CROSS } from '../core/puzzle/board.ts';
import type { Puzzle } from '../core/puzzle/types.ts';

/** Where a puzzle's progress is saved: FNV-1a (32-bit) of its share payload. */
export function progressKey(puzzle: Puzzle) {
  let h = 0x811c9dc5;
  for (const c of encodeShare(puzzle.solution)) {
    h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  }
  return `nonogram-progress:${(h >>> 0).toString(16)}`;
}

export interface Progress {
  board: Uint8Array;
  elapsed: number; // ms
}

/** The saved board and time, or null if there is none or it doesn't fit this puzzle. */
export function loadProgress(key: string, cells: number): Progress | null {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (
      typeof data !== 'object' ||
      data === null ||
      !('board' in data && 'elapsed' in data) ||
      typeof data.board !== 'string' ||
      data.board.length !== cells ||
      !/^[012]*$/.test(data.board) ||
      typeof data.elapsed !== 'number' ||
      !(data.elapsed >= 0 && data.elapsed < Infinity)
    ) {
      return null;
    }
    return {
      board: Uint8Array.from(data.board, (c) => (c === '2' ? CROSS : +c)),
      elapsed: data.elapsed,
    };
  } catch {
    return null; // storage blocked, or not JSON
  }
}

/** One digit per cell: 0 empty, 1 filled, 2 X. Silently skipped if storage is blocked or full. */
export function saveProgress(key: string, { board, elapsed }: Progress) {
  try {
    const cells = Array.from(board, (v) => (v === CROSS ? '2' : v)).join('');
    localStorage.setItem(key, JSON.stringify({ board: cells, elapsed }));
  } catch {
    // private browsing or a full quota: play goes on unsaved
  }
}

export function clearProgress(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing saved, then
  }
}
