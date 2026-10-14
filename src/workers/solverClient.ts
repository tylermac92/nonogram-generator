import type { Puzzle } from '../core/puzzle/types.ts';
import type { FixRequest } from '../core/repair/autofix.ts';
import type { ScanRequest } from '../core/repair/suggest.ts';
import type {
  Job,
  SolveRequest,
  SolveResponse,
  SolveUpdate,
} from './solver.worker.ts';

const start = () =>
  new Worker(new URL('./solver.worker.ts', import.meta.url), {
    type: 'module',
  });

/**
 * Runs checks, scans and fixes in a worker. Only the latest job's updates are
 * delivered. A job that arrives while the last one is still running (a deep
 * search, a scan or a fix can take seconds) replaces the worker, cancelling it.
 */
export function createSolverClient() {
  let worker = start();
  let latest = 0;
  let busy = false;
  let disposed = false;
  let onUpdate: (update: SolveUpdate) => void = () => {};
  const listen = () => {
    worker.onmessage = ({ data }: MessageEvent<SolveResponse>) => {
      if (data.id !== latest) return;
      // More is coming after a stuck line result or a fix's progress.
      busy =
        ('result' in data && data.result.status === 'stuck') ||
        'progress' in data;
      onUpdate(data);
    };
  };
  listen();
  /** Stops the running job, if any, by replacing the worker. */
  function cancel() {
    if (!busy || disposed) return;
    worker.terminate();
    worker = start();
    listen();
    busy = false;
  }
  function post(job: Job, callback: (update: SolveUpdate) => void) {
    if (disposed) return;
    cancel();
    busy = true;
    onUpdate = callback;
    const request: SolveRequest = { ...job, id: ++latest };
    worker.postMessage(request);
  }
  return {
    /** Line-solves, then deep-checks if stuck. Only the clues and the solution are sent. */
    check(
      { width, height, rows, cols, solution }: Puzzle,
      callback: (update: SolveUpdate) => void,
    ) {
      post(
        { puzzle: { width, height, rows, cols }, solution: solution.cells },
        callback,
      );
    },
    scan: (request: ScanRequest, callback: (update: SolveUpdate) => void) =>
      post({ scan: request }, callback),
    fix: (request: FixRequest, callback: (update: SolveUpdate) => void) =>
      post({ fix: request }, callback),
    cancel,
    dispose() {
      disposed = true;
      worker.terminate();
    },
  };
}
