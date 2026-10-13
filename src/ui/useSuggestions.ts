import { useEffect, useRef, useState } from 'react';
import type { ScanRequest, Suggestion } from '../core/repair/suggest.ts';
import { createSolverClient } from '../workers/solverClient.ts';

const IDLE_MS = 500;

export type ScanState =
  | { status: 'scanning' }
  | { status: 'done'; suggestions: Suggestion[] }
  | { status: 'cancelled' };

/**
 * Scans nearby settings in its own worker once `request` has been still for
 * 500 ms; a new request cancels the running scan. Null while there is nothing to scan.
 */
export function useSuggestions(request: ScanRequest | null) {
  const client = useRef<ReturnType<typeof createSolverClient>>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [ended, setEnded] = useState<{
    request: ScanRequest;
    state: ScanState;
  } | null>(null);

  useEffect(() => {
    client.current = createSolverClient();
    return () => client.current?.dispose();
  }, []);

  useEffect(() => {
    if (!request) return;
    timer.current = setTimeout(
      () =>
        client.current?.scan(request, (update) => {
          if ('suggestions' in update) {
            const { suggestions } = update;
            setEnded({ request, state: { status: 'done', suggestions } });
          }
        }),
      IDLE_MS,
    );
    return () => {
      clearTimeout(timer.current);
      client.current?.cancel();
    };
  }, [request]);

  function cancel() {
    if (!request) return;
    clearTimeout(timer.current);
    client.current?.cancel();
    setEnded({ request, state: { status: 'cancelled' } });
  }

  const state: ScanState | null = !request
    ? null
    : ended?.request === request
      ? ended.state
      : { status: 'scanning' };
  return { state, cancel };
}
