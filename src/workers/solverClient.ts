import type { SolveResult } from '../core/solver/solve.ts';
import type { SolveRequest, SolveResponse } from './solver.worker.ts';

/**
 * Runs line solves in a worker. Only the latest check's result is delivered;
 * older jobs still finish in the worker, but their results are dropped.
 */
export function createSolverClient() {
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
    type: 'module',
  });
  let latest = 0;
  let onResult: (result: SolveResult) => void = () => {};
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    if (e.data.id === latest) onResult(e.data.result);
  };
  return {
    check(
      { width, height, rows, cols }: SolveRequest['puzzle'],
      callback: (result: SolveResult) => void,
    ) {
      onResult = callback;
      // Only the clues are sent: the solver must never see the solution.
      const request: SolveRequest = {
        id: ++latest,
        puzzle: { width, height, rows, cols },
      };
      worker.postMessage(request);
    },
    dispose: () => worker.terminate(),
  };
}
