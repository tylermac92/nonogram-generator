import { describe, expect, it, vi } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { gridFromRows } from '../core/puzzle/grid.ts';
import { FILLED } from '../core/solver/line.ts';
import { needsGuessing, randomGrid } from '../core/test-utils.ts';
import { autoFix, type FixRequest } from '../core/repair/autofix.ts';
import { suggestSettings, type ScanRequest } from '../core/repair/suggest.ts';
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
/** A 50-wide noisy gradient at 7 widths: every scanned grid is different, so the scan takes a while. */
const scan: ScanRequest = {
  gray: {
    width: 1000,
    height: 1000,
    data: new Uint8ClampedArray(1e6).map(
      (_, i) =>
        ((i % 1000) / 4 + Math.floor(i / 1000) / 8 + ((i * 7919) % 97)) % 256,
    ),
  },
  crop: { x: 0, y: 0, width: 1000, height: 1000 },
  sizes: [44, 45, 46, 47, 48, 49, 50].map((w) => ({ width: w, height: w })),
  width: 47,
  cutoff: 128,
  brightness: 0,
  contrast: 0,
  invert: false,
  edits: new Map(),
};
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

  it('scans nearby settings, and a cancelled scan reports nothing', async () => {
    const client = createSolverClient();
    const done = vi.fn();
    client.scan(scan, done);
    await vi.waitFor(() => expect(done).toHaveBeenCalled(), { timeout: 3000 });
    expect(done.mock.calls[0]![0].suggestions).toEqual(suggestSettings(scan));

    const cancelled = vi.fn();
    client.scan(scan, cancelled);
    client.cancel();
    await wait(1500);
    expect(cancelled).not.toHaveBeenCalled();
    client.dispose();
  });

  it('auto-fixes with progress, and a new job cancels a running fix', async () => {
    const grid = randomGrid(15, 15, 7, 0.5); // needs two flips
    const request: FixRequest = {
      grid,
      values: Float32Array.from(grid.cells, (v) => (v ? 0 : 255)),
      cutoff: 128,
      locked: [],
    };
    const client = createSolverClient();
    const updates = vi.fn();
    client.fix(request, updates);
    await vi.waitFor(() =>
      expect(updates.mock.calls.some(([u]) => 'fix' in u)).toBe(true),
    );
    const expected = autoFix(request);
    expect(updates.mock.calls.map(([u]) => u)).toMatchObject([
      { progress: { flips: 1 } },
      { progress: { flips: 2, undetermined: 0 } },
      { fix: expected },
    ]);

    // A slow fix (seconds per round), replaced after its first progress message.
    const slow = vi.fn();
    client.fix(
      { ...request, grid: noise, values: new Float32Array(900) },
      slow,
    );
    await vi.waitFor(() => expect(slow).toHaveBeenCalled(), { timeout: 5000 });
    const start = performance.now();
    const quick = vi.fn();
    client.fix(request, quick);
    await vi.waitFor(() =>
      expect(quick.mock.calls.some(([u]) => 'fix' in u)).toBe(true),
    );
    // Had the slow fix kept running, the worker would have taken seconds.
    expect(performance.now() - start).toBeLessThan(1000);
    expect(slow.mock.calls.every(([u]) => 'progress' in u)).toBe(true);
    client.dispose();
  });
});
