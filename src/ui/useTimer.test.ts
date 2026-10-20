import { expect, it } from 'vitest';
import { clock } from './useTimer.ts';

it.each([
  [0, '0:00'],
  [999, '0:00'],
  [59_999, '0:59'],
  [61_000, '1:01'],
  [3_599_999, '59:59'],
  [3_661_000, '1:01:01'],
])('shows %i ms as %s', (ms, text) => {
  expect(clock(ms)).toBe(text);
});
