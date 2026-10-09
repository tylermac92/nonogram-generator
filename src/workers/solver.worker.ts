import type { Puzzle } from '../core/puzzle/types.ts';
import { solve, type SolveResult } from '../core/solver/solve.ts';

export interface SolveRequest {
  id: number;
  puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>;
}

export interface SolveResponse {
  id: number;
  result: SolveResult;
}

addEventListener('message', (e: MessageEvent<SolveRequest>) => {
  const result = solve(e.data.puzzle);
  const response: SolveResponse = { id: e.data.id, result };
  postMessage(response, { transfer: [result.masks.buffer] });
});
