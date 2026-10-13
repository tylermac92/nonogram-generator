import { describe, expect, it } from 'vitest';
import { historyOf, record, redo, undo } from './history.ts';

describe('history', () => {
  it('keeps the last 100 steps', () => {
    let h = historyOf(0);
    for (let i = 1; i <= 150; i++) h = record(h, i);
    for (let i = 0; i < 150; i++) h = undo(h);
    expect(h.present).toBe(50);
    expect(h.past).toEqual([]);
  });

  it('redoes what was undone until something new is recorded', () => {
    let h = record(record(historyOf('a'), 'b'), 'c');
    h = undo(undo(h));
    expect(h.present).toBe('a');
    h = redo(h);
    expect(h.present).toBe('b');
    expect(redo(redo(redo(h))).present).toBe('c');
    h = record(h, 'd');
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
    expect(undo(h).present).toBe('b');
  });
});
