/** Snapshot undo history: whole states, so it can't drift out of sync. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

export const historyOf = <T>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
});

/** Makes `next` the present; the past keeps the last 100 states. */
export function record<T>(h: History<T>, next: T): History<T> {
  return {
    past: [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
  };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past.at(-1)!,
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0]!,
    future: h.future.slice(1),
  };
}
