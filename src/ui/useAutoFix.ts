import { useEffect, useRef, useState } from 'react';
import type {
  FixProgress,
  FixRequest,
  FixResult,
} from '../core/repair/autofix.ts';
import type { Puzzle } from '../core/puzzle/types.ts';
import { createSolverClient } from '../workers/solverClient.ts';

/**
 * Runs auto-fix for the current puzzle in its own worker. A puzzle change
 * cancels it, so a fix is never applied to a grid it wasn't computed for.
 */
export function useAutoFix(puzzle: Puzzle | null) {
  const client = useRef<ReturnType<typeof createSolverClient>>(null);
  const [running, setRunning] = useState<{
    puzzle: Puzzle;
    progress?: FixProgress;
  } | null>(null);

  useEffect(() => {
    client.current = createSolverClient();
    return () => client.current?.dispose();
  }, []);
  useEffect(() => () => client.current?.cancel(), [puzzle]);

  function start(request: FixRequest, onDone: (result: FixResult) => void) {
    if (!puzzle) return;
    setRunning({ puzzle });
    client.current?.fix(request, (update) => {
      if ('progress' in update)
        setRunning({ puzzle, progress: update.progress });
      if ('fix' in update) {
        setRunning(null);
        onDone(update.fix);
      }
    });
  }

  function cancel() {
    client.current?.cancel();
    setRunning(null);
  }

  // Null when idle; progress is undefined until the first flip is kept.
  const progress = running?.puzzle === puzzle ? running : null;
  return { running: progress, start, cancel };
}
