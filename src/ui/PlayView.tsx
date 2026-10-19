import { useEffect, useMemo, useState } from 'react';
import {
  completedClues,
  CROSS,
  EMPTY,
  FILLED,
  isSolved,
  mistakes,
} from '../core/puzzle/board.ts';
import type { CellValue, Puzzle } from '../core/puzzle/types.ts';
import { historyOf, record, redo, undo } from './history.ts';
import { Preview } from './Preview.tsx';

const RED = 'rgba(230, 0, 0, 0.5)';

/** Solve the puzzle on a board: fill, X, drag along a line, undo, Check. */
export function PlayView({
  puzzle,
  title,
  onClose,
}: {
  puzzle: Puzzle;
  title: string;
  onClose?: () => void; // absent for a shared link: offer the creator instead
}) {
  const [history, setHistory] = useState(() =>
    historyOf(new Uint8Array(puzzle.width * puzzle.height)),
  );
  const [mode, setMode] = useState<'fill' | 'x'>('fill'); // for touch, where there's no right button
  const [check, setCheck] = useState<{ board: Uint8Array; wrong: number[] }>();
  const board = history.present;
  const solved = useMemo(() => isSolved(puzzle, board), [puzzle, board]);
  const wrong = check?.board === board ? check.wrong : null; // cleared by the next move
  const done = useMemo(() => {
    const { width: w, height: h } = puzzle;
    return {
      rows: puzzle.rows.map((runs, y) =>
        completedClues(runs, board.subarray(y * w, (y + 1) * w)),
      ),
      cols: puzzle.cols.map((runs, x) =>
        completedClues(
          runs,
          Array.from({ length: h }, (_, y) => board[y * w + x]!),
        ),
      ),
    };
  }, [puzzle, board]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  function paint(cells: number[], value: CellValue, start: boolean) {
    setHistory((h) => {
      const next = h.present.slice();
      for (const i of cells) next[i] = value;
      return start ? record(h, next) : { ...h, present: next };
    });
  }
  /** Drops a stroke a pinch interrupted, as if it never happened. */
  const cancelStroke = () => setHistory((h) => ({ ...undo(h), future: [] }));
  /** Fill (or X) the stroke, or clear it if its first cell already has that. */
  function paintValue(cell: number, mark: boolean) {
    const target = mark || mode === 'x' ? CROSS : FILLED;
    return board[cell] === target ? EMPTY : target;
  }
  const cells = (n: number) => `${n} ${n === 1 ? 'cell is' : 'cells are'}`;

  return (
    <main className="play">
      <h1>{title.trim() || 'Nonogram'}</h1>
      <div className="play-controls">
        {onClose ? (
          <button type="button" onClick={onClose}>
            Back to editor
          </button>
        ) : (
          <a href={location.pathname}>Make your own puzzle</a>
        )}{' '}
        <span role="group" aria-label="Tap to">
          <button
            type="button"
            aria-pressed={mode === 'fill'}
            onClick={() => setMode('fill')}
          >
            Fill
          </button>
          <button
            type="button"
            aria-pressed={mode === 'x'}
            onClick={() => setMode('x')}
          >
            X
          </button>
        </span>{' '}
        <button
          type="button"
          disabled={history.past.length === 0}
          onClick={() => setHistory(undo)}
        >
          Undo
        </button>{' '}
        <button
          type="button"
          disabled={history.future.length === 0}
          onClick={() => setHistory(redo)}
        >
          Redo
        </button>{' '}
        <button
          type="button"
          onClick={() => setCheck({ board, wrong: mistakes(puzzle, board) })}
        >
          Check
        </button>
      </div>
      <p role="status">
        {solved
          ? 'Solved — well done!'
          : wrong &&
            (wrong.length
              ? `${cells(wrong.length)} filled wrongly (shown in red).`
              : 'No mistakes so far.')}
      </p>
      <p className="hint">
        Click to fill, right-click to mark X, and click again to clear. Drag to
        paint along a row or column. Arrow keys, Space and X work too.
      </p>
      <Preview
        puzzle={puzzle}
        cells={board}
        highlight={wrong ? { cells: wrong, color: RED } : undefined}
        onPaint={paint}
        paintValue={paintValue}
        lockAxis
        zoomable
        onCancel={cancelStroke}
        done={done}
        crosshair
        label={`Puzzle board, ${puzzle.width} by ${puzzle.height}`}
      />
    </main>
  );
}
