import { describe, expect, it, vi } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { gridFromRows } from '../core/puzzle/grid.ts';
import { FILLED } from '../core/solver/line.ts';
import { randomGrid } from '../core/test-utils.ts';
import { createSolverClient } from './solverClient.ts';

const hollow = gridFromRows([
  '1111111111',
  '1000000001',
  '1000000001',
  '1000000001',
  '1000000001',
  '1000000001',
  '1000000001',
  '1000000001',
  '1000000001',
  '1111111111',
]);
const plus = gridFromRows(['00100', '00100', '11111', '00100', '00100']);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('createSolverClient', () => {
  it('solves in the worker', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.check(makePuzzle(hollow), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    const [result] = callback.mock.calls[0]!;
    expect(result.status).toBe('solved');
    expect(
      Array.from(result.masks, (m: number) => (m === FILLED ? 1 : 0)),
    ).toEqual(Array.from(hollow.cells));
    client.dispose();
  });

  it('drops the result of an older job', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.check(makePuzzle(randomGrid(50, 50, 20, 0.6)), callback);
    client.check(makePuzzle(plus), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    await wait(500);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0].masks).toHaveLength(25);
    client.dispose();
  });

  it('delivers nothing after dispose', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.dispose();
    client.check(makePuzzle(plus), callback);
    await wait(200);
    expect(callback).not.toHaveBeenCalled();
  });
});
