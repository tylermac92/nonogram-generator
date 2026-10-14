import type { Puzzle } from '../core/puzzle/types.ts';
import {
  autoFix,
  type FixProgress,
  type FixRequest,
  type FixResult,
} from '../core/repair/autofix.ts';
import {
  suggestSettings,
  type ScanRequest,
  type Suggestion,
} from '../core/repair/suggest.ts';
import { deepCheck, type DeepResult } from '../core/solver/deep.ts';
import { solve, type SolveResult } from '../core/solver/solve.ts';

export type Job =
  | {
      puzzle: Pick<Puzzle, 'width' | 'height' | 'rows' | 'cols'>;
      solution: Uint8Array; // read only by the deep check, which looks for a different solution
    }
  | { scan: ScanRequest }
  | { fix: FixRequest };
export type SolveRequest = Job & { id: number };

/**
 * A check sends the line result, then the deep check's when stuck. A fix
 * sends progress after each flip, then its result. A scan sends one message.
 */
export type SolveUpdate =
  | { result: SolveResult }
  | { deep: DeepResult }
  | { suggestions: Suggestion[] }
  | { progress: FixProgress }
  | { fix: FixResult };
export type SolveResponse = SolveUpdate & { id: number };

addEventListener('message', ({ data }: MessageEvent<SolveRequest>) => {
  const { id } = data;
  if ('scan' in data) {
    const response: SolveResponse = {
      id,
      suggestions: suggestSettings(data.scan),
    };
    postMessage(response);
    return;
  }
  if ('fix' in data) {
    const fix = autoFix(data.fix, (progress) => {
      const update: SolveResponse = { id, progress };
      postMessage(update);
    });
    const response: SolveResponse = { id, fix };
    postMessage(response);
    return;
  }
  const { puzzle, solution } = data;
  const result = solve(puzzle);
  const stuck = result.status === 'stuck';
  const response: SolveResponse = { id, result };
  postMessage(response, { transfer: [result.masks.buffer] });
  if (stuck) {
    const deep: SolveResponse = { id, deep: deepCheck(puzzle, solution) };
    postMessage(deep);
  }
});
