import { useEffect, useRef, useState } from 'react';
import type { Puzzle } from '../core/puzzle/types.ts';
import type { DeepResult } from '../core/solver/deep.ts';
import type { SolveResult } from '../core/solver/solve.ts';
import { createSolverClient } from '../workers/solverClient.ts';

const DEBOUNCE_MS = 150;

export interface Check {
  result: SolveResult;
  deep?: DeepResult; // only when the line solver is stuck, once the search ends
}

/** Checks the puzzle in a worker once it stops changing. Null until the current puzzle's line result arrives. */
export function useSolver(puzzle: Puzzle | null): Check | null {
  const client = useRef<ReturnType<typeof createSolverClient>>(null);
  const [checked, setChecked] = useState<(Check & { puzzle: Puzzle }) | null>(
    null,
  );

  useEffect(() => {
    client.current = createSolverClient();
    return () => client.current?.dispose();
  }, []);

  useEffect(() => {
    if (!puzzle) return;
    const timer = setTimeout(
      () =>
        client.current?.check(puzzle, (update) =>
          setChecked((c) =>
            'result' in update
              ? { puzzle, result: update.result }
              : c && { ...c, deep: update.deep },
          ),
        ),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [puzzle]);

  // A result for an older grid is never shown on the current one.
  return checked?.puzzle === puzzle ? checked : null;
}
