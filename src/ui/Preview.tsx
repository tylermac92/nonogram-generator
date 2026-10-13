import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { clueLabels } from '../core/puzzle/clues.ts';
import type { Edits } from '../core/puzzle/grid.ts';
import type { CellValue, Puzzle } from '../core/puzzle/types.ts';
import { cellAt, lineCells, previewLayout } from './layout.ts';

/** The grid with its clues, drawn on one canvas; editable when `onPaint` is set. */
export function Preview({
  puzzle,
  undetermined,
  edits,
  onPaint,
}: {
  puzzle: Puzzle;
  undetermined?: number[];
  edits?: Edits;
  /** `start` is true for the first cell of a stroke: one undo step per stroke. */
  onPaint?: (cells: number[], value: CellValue, start: boolean) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const layout = useMemo(
    () => previewLayout(puzzle, available),
    [puzzle, available],
  );
  const { width: w, height: h, solution } = puzzle;
  const at = Math.min(cursor, w * h - 1); // the grid may have shrunk
  const editable = onPaint !== undefined;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry!.contentRect.width),
    );
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      draw(
        canvas.current!,
        puzzle,
        layout,
        undetermined,
        edits,
        focused && editable ? at : null,
      ),
    [puzzle, layout, undetermined, edits, focused, at, editable],
  );

  function startPaint(e: PointerEvent) {
    const rect = canvas.current!.getBoundingClientRect();
    const cellUnder = (p: { clientX: number; clientY: number }) =>
      cellAt(layout, puzzle, p.clientX - rect.left, p.clientY - rect.top);
    let last = cellUnder(e);
    if (!onPaint || last === null) return;
    e.preventDefault();
    const value = 1 - solution.cells[last]!;
    onPaint([last], value, true);
    // Window listeners keep the stroke going when the pointer leaves the canvas.
    const move = (m: globalThis.PointerEvent) => {
      const cell = cellUnder(m);
      if (cell === null || cell === last) return;
      onPaint(lineCells(last!, cell, w), value, false);
      last = cell;
    };
    const end = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!onPaint) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPaint([at], 1 - solution.cells[at]!, true);
      return;
    }
    const [dx, dy] = (
      {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      } as Record<string, [number, number]>
    )[e.key] ?? [0, 0];
    if (!dx && !dy) return;
    e.preventDefault();
    const x = Math.min(w - 1, Math.max(0, (at % w) + dx));
    const y = Math.min(h - 1, Math.max(0, Math.floor(at / w) + dy));
    setCursor(y * w + x);
  }

  return (
    <div ref={wrapper} className="preview">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Puzzle preview, ${w} by ${h}`}
        tabIndex={editable ? 0 : undefined}
        onPointerDown={startPaint}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

function draw(
  canvas: HTMLCanvasElement,
  puzzle: Puzzle,
  { cell, clueCols, clueRows, width, height }: ReturnType<typeof previewLayout>,
  undetermined: number[] = [],
  edits: Edits = new Map(),
  cursor: number | null,
) {
  const { width: w, height: h, solution } = puzzle;
  const dpr = window.devicePixelRatio || 1;
  // One extra pixel so the outer border isn't clipped at the right and bottom edges.
  canvas.width = Math.round((width + 1) * dpr);
  canvas.height = Math.round((height + 1) * dpr);
  canvas.style.width = `${width + 1}px`;
  canvas.style.height = `${height + 1}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width + 1, height + 1);

  const left = clueCols * cell;
  const top = clueRows * cell;
  ctx.fillStyle = '#000';
  solution.cells.forEach((value, i) => {
    if (value) {
      ctx.fillRect(
        left + (i % w) * cell,
        top + Math.floor(i / w) * cell,
        cell,
        cell,
      );
    }
  });

  ctx.fillStyle = 'rgba(255, 160, 0, 0.6)';
  for (const i of undetermined) {
    ctx.fillRect(
      left + (i % w) * cell,
      top + Math.floor(i / w) * cell,
      cell,
      cell,
    );
  }

  // Edited cells: a small blue square that shows on black, white and amber.
  ctx.fillStyle = '#1a73e8';
  for (const i of edits.keys()) {
    ctx.fillRect(
      left + ((i % w) + 1 / 3) * cell,
      top + (Math.floor(i / w) + 1 / 3) * cell,
      cell / 3,
      cell / 3,
    );
  }

  // Thin lines first, then a bold rule every 5 cells and the outer border on top.
  for (const major of [false, true]) {
    const t = major ? 2 : 1;
    ctx.fillStyle = major ? '#000' : '#bbb';
    for (let x = 0; x <= w; x++) {
      if ((x % 5 === 0 || x === w) === major) {
        ctx.fillRect(left + x * cell - t / 2, top, t, h * cell);
      }
    }
    for (let y = 0; y <= h; y++) {
      if ((y % 5 === 0 || y === h) === major) {
        ctx.fillRect(left, top + y * cell - t / 2, w * cell, t);
      }
    }
  }

  if (cursor !== null) {
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      left + (cursor % w) * cell + 1.5,
      top + Math.floor(cursor / w) * cell + 1.5,
      cell - 3,
      cell - 3,
    );
  }

  ctx.font = `${Math.round(cell * 0.65)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  puzzle.rows.forEach((runs, y) => {
    const labels = clueLabels(runs);
    labels.forEach((label, i) =>
      ctx.fillText(
        label,
        left - (labels.length - i - 0.5) * cell,
        top + (y + 0.5) * cell,
      ),
    );
  });
  puzzle.cols.forEach((runs, x) => {
    const labels = clueLabels(runs);
    labels.forEach((label, i) =>
      ctx.fillText(
        label,
        left + (x + 0.5) * cell,
        top - (labels.length - i - 0.5) * cell,
      ),
    );
  });
}
