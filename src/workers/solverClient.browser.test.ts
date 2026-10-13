import { describe, expect, it, vi } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { gridFromRows } from '../core/puzzle/grid.ts';
import { FILLED } from '../core/solver/line.ts';
import { needsGuessing, randomGrid } from '../core/test-utils.ts';
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
/** Noise the deep check can't settle within its 3 seconds. */
const noise = randomGrid(30, 30, 1, 0.5);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('createSolverClient', () => {
  it('solves in the worker', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.check(makePuzzle(hollow), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    const [{ result }] = callback.mock.calls[0]!;
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
    expect(callback.mock.calls[0]![0].result.masks).toHaveLength(25);
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

  it('runs the deep check after a stuck line solve', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.check(makePuzzle(needsGuessing), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
    const [first, second] = callback.mock.calls.map(([update]) => update);
    expect(first.result.status).toBe('stuck');
    expect(first.result.undetermined).toHaveLength(75);
    expect(second).toMatchObject({ deep: { status: 'unique' } });
    client.dispose();
  });

  it('reports a search that runs out of time', async () => {
    const client = createSolverClient();
    const callback = vi.fn();
    client.check(makePuzzle(noise), callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    expect(callback.mock.calls[1]![0]).toMatchObject({
      deep: { status: 'timeout' },
    });
    client.dispose();
  });

  it('cancels a running search when a new check arrives', async () => {
    const client = createSolverClient();
    const old = vi.fn();
    const next = vi.fn();
    client.check(makePuzzle(noise), old);
    await vi.waitFor(() => expect(old).toHaveBeenCalledOnce()); // searching now
    const start = performance.now();
    client.check(makePuzzle(plus), next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    // Without cancelling, the worker would be busy for the rest of the 3 seconds.
    expect(performance.now() - start).toBeLessThan(500);
    expect(next.mock.calls[0]![0].result.status).toBe('solved');
    expect(old).toHaveBeenCalledOnce();
    client.dispose();
  });
});
