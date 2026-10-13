import type { Puzzle } from '../core/puzzle/types.ts';
import { deepCheck, type DeepResult } from '../core/solver/deep.ts';
import { solve, type SolveResult } from '../core/solver/solve.ts';

export interface SolveRequest {
  id: number;
  puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>;
  solution: Uint8Array; // read only by the deep check, which looks for a different solution
}

/** The line result first; then, only when it is stuck, the deep check's. */
export type SolveUpdate = { result: SolveResult } | { deep: DeepResult };
export type SolveResponse = SolveUpdate & { id: number };

addEventListener('message', (e: MessageEvent<SolveRequest>) => {
  const { id, puzzle, solution } = e.data;
  const result = solve(puzzle);
  const stuck = result.status === 'stuck';
  const response: SolveResponse = { id, result };
  postMessage(response, { transfer: [result.masks.buffer] });
  if (stuck) {
    const deep: SolveResponse = { id, deep: deepCheck(puzzle, solution) };
    postMessage(deep);
  }
});
