import { expect, it } from 'vitest';
import { VERSION } from './index.ts';

it('exports a version', () => {
  expect(VERSION).toBe('0.0.0');
});
