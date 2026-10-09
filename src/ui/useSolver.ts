import { useEffect, useRef, useState } from 'react';
import type { Puzzle } from '../core/puzzle/types.ts';
import type { SolveResult } from '../core/solver/solve.ts';
import { createSolverClient } from '../workers/solverClient.ts';

const DEBOUNCE_MS = 150;

/** Line-solves the puzzle in a worker once it stops changing. Null until the current puzzle's result arrives. */
export function useSolver(puzzle: Puzzle | null): SolveResult | null {
  const client = useRef<ReturnType<typeof createSolverClient>>(null);
  const [checked, setChecked] = useState<{
    puzzle: Puzzle;
    result: SolveResult;
  } | null>(null);

  useEffect(() => {
    client.current = createSolverClient();
    return () => client.current?.dispose();
  }, []);

  useEffect(() => {
    if (!puzzle) return;
    const timer = setTimeout(
      () =>
        client.current?.check(puzzle, (result) =>
          setChecked({ puzzle, result }),
        ),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [puzzle]);

  // A result for an older grid is never shown on the current one.
  return checked?.puzzle === puzzle ? checked.result : null;
}
