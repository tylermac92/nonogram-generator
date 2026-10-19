import { useMemo, useSyncExternalStore } from 'react';
import { decodeShare } from '../core/io/share.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import './app.css';
import { Creator } from './Creator.tsx';
import { PlayView } from './PlayView.tsx';

const onHashChange = (notify: () => void) => {
  addEventListener('hashchange', notify);
  return () => removeEventListener('hashchange', notify);
};

/** `#p=…` opens a shared puzzle in play mode; anything else is the creator. */
export default function App() {
  const hash = useSyncExternalStore(onHashChange, () => location.hash);
  const shared = useMemo(() => {
    if (!hash.startsWith('#p=')) return null;
    try {
      return makePuzzle(decodeShare(hash.slice(3)));
    } catch {
      return 'broken';
    }
  }, [hash]);

  if (shared === null) return <Creator />;
  if (shared === 'broken') {
    return (
      <main className="play">
        <h1>Nonogram</h1>
        <p role="alert">
          This puzzle link is broken or incomplete. Ask for a new link, or{' '}
          <a href={location.pathname}>make your own puzzle</a>.
        </p>
      </main>
    );
  }
  // keyed by the link, so a new link starts a fresh board
  return <PlayView key={hash} puzzle={shared} title="" />;
}
