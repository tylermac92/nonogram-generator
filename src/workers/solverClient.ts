import type { Puzzle } from '../core/puzzle/types.ts';
import type {
  SolveRequest,
  SolveResponse,
  SolveUpdate,
} from './solver.worker.ts';

const start = () =>
  new Worker(new URL('./solver.worker.ts', import.meta.url), {
    type: 'module',
  });

/**
 * Checks puzzles in a worker. Only the latest check's updates are delivered.
 * A check that arrives while the last one is still running (a deep search
 * can take seconds) replaces the worker, which cancels that search.
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
      busy = 'result' in data && data.result.status === 'stuck';
      onUpdate(data);
    };
  };
  listen();
  return {
    check(
      { width, height, rows, cols, solution }: Puzzle,
      callback: (update: SolveUpdate) => void,
    ) {
      if (disposed) return;
      if (busy) {
        worker.terminate();
        worker = start();
        listen();
      }
      busy = true;
      onUpdate = callback;
      // The line solver gets only the clues; the solution is for the deep check.
      const request: SolveRequest = {
        id: ++latest,
        puzzle: { width, height, rows, cols },
        solution: solution.cells,
      };
      worker.postMessage(request);
    },
    dispose() {
      disposed = true;
      worker.terminate();
    },
  };
}
