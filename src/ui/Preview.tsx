import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { CROSS } from '../core/puzzle/board.ts';
import { clueLabels } from '../core/puzzle/clues.ts';
import type { Edits } from '../core/puzzle/grid.ts';
import type { CellValue, Puzzle } from '../core/puzzle/types.ts';
import {
  alongAxis,
  axisOf,
  cellAt,
  lineCells,
  previewLayout,
  type Axis,
} from './layout.ts';

const ZOOM_MIN_CELL = 4;
const DONE_GREY = '#aaa';
type Done = { rows: boolean[][]; cols: boolean[][] };
const MAX_CANVAS_PIXELS = 16_000_000;
const onZoom = (notify: () => void) => {
  visualViewport?.addEventListener('resize', notify);
  return () => visualViewport?.removeEventListener('resize', notify);
};

/** Cells to tint, drawn over the cell values. */
export interface Highlight {
  cells: number[];
  color: string;
}

/**
 * The grid with its clues, drawn on one canvas; editable when `onPaint` is set.
 * The creator shows the solution; play passes the player's board as `cells`.
 */
export function Preview({
  puzzle,
  cells,
  highlight,
  edits,
  fixed,
  onPaint,
  paintValue,
  lockAxis = false,
  zoomable = false,
  onCancel,
  done,
  label = `Puzzle preview, ${puzzle.width} by ${puzzle.height}`,
}: {
  puzzle: Puzzle;
  cells?: Uint8Array; // what to draw: 0 empty, 1 filled, CROSS; the solution by default
  highlight?: Highlight;
  edits?: Edits;
  fixed?: ReadonlySet<number>; // auto-fixed cells among the edits
  /** `start` is true for the first cell of a stroke: one undo step per stroke. */
  onPaint?: (cells: number[], value: CellValue, start: boolean) => void;
  /** What a stroke paints, from its first cell; `mark` is the right button or X key. Null ignores it. */
  paintValue?: (cell: number, mark: boolean) => CellValue | null;
  lockAxis?: boolean; // a drag stays on the row or column it started along
  /** Play on phones: fits any board to the width, and stays sharp under the browser's pinch-zoom. */
  zoomable?: boolean;
  /** A stroke was cut short, by a pinch starting: undo what it painted. */
  onCancel?: () => void;
  /** Clue numbers to grey out, per line and number. */
  done?: Done;
  label?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const layout = useMemo(
    () =>
      previewLayout(puzzle, available, zoomable ? ZOOM_MIN_CELL : undefined),
    [puzzle, available, zoomable],
  );
  const zoom = useSyncExternalStore(onZoom, () =>
    // Half steps, so a pinch redraws a few times rather than every frame.
    zoomable ? Math.ceil((visualViewport?.scale ?? 1) * 2) / 2 : 1,
  );
  const { width: w, height: h, solution } = puzzle;
  const shown = cells ?? solution.cells;
  const valueFor =
    paintValue ?? ((i: number, mark: boolean) => (mark ? null : 1 - shown[i]!));
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
        shown,
        layout,
        highlight,
        edits,
        fixed,
        focused && editable ? at : null,
        zoom,
        done,
      ),
    [
      puzzle,
      shown,
      layout,
      highlight,
      edits,
      fixed,
      focused,
      at,
      editable,
      zoom,
      done,
    ],
  );

  function startPaint(e: PointerEvent) {
    const rect = canvas.current!.getBoundingClientRect();
    const cellUnder = (p: { clientX: number; clientY: number }) =>
      cellAt(layout, puzzle, p.clientX - rect.left, p.clientY - rect.top);
    const start = cellUnder(e);
    // A second finger is the start of a pinch, not a stroke.
    if (!onPaint || start === null || e.button === 1 || !e.isPrimary) return;
    const value = valueFor(start, e.button === 2);
    if (value === null) return;
    e.preventDefault();
    onPaint([start], value, true);
    let last = start;
    let axis: Axis | undefined;
    // Window listeners keep the stroke going when the pointer leaves the canvas.
    const move = (m: globalThis.PointerEvent) => {
      let cell = cellUnder(m);
      if (cell === null) return;
      if (lockAxis && cell !== start) {
        axis ??= axisOf(start, cell, w);
        cell = alongAxis(start, cell, w, axis);
      }
      if (cell === last) return;
      onPaint(lineCells(last, cell, w), value, false);
      last = cell;
    };
    const end = (e: globalThis.PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      if (e.type === 'pointercancel') onCancel?.();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!onPaint) return;
    const mark = e.key === 'x' || e.key === 'X';
    if (mark || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const value = valueFor(at, mark);
      if (value !== null) onPaint([at], value, true);
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
        aria-label={label}
        tabIndex={editable ? 0 : undefined}
        onPointerDown={startPaint}
        onContextMenu={(e) => editable && e.preventDefault()}
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
  shown: Uint8Array,
  { cell, clueCols, clueRows, width, height }: ReturnType<typeof previewLayout>,
  highlight: Highlight | undefined,
  edits: Edits = new Map(),
  fixed: ReadonlySet<number> = new Set(),
  cursor: number | null,
  zoom: number,
  done: Done | undefined,
) {
  const { width: w, height: h } = puzzle;
  // Device pixels for the zoomed size, within iOS Safari's canvas area limit.
  const dpr = Math.min(
    (window.devicePixelRatio || 1) * zoom,
    Math.sqrt(MAX_CANVAS_PIXELS / ((width + 1) * (height + 1))),
  );
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
  ctx.strokeStyle = '#666';
  ctx.lineWidth = Math.max(1, cell / 12);
  shown.forEach((value, i) => {
    const [x, y] = [left + (i % w) * cell, top + Math.floor(i / w) * cell];
    if (value === CROSS) {
      ctx.beginPath();
      ctx.moveTo(x + cell / 4, y + cell / 4);
      ctx.lineTo(x + (cell * 3) / 4, y + (cell * 3) / 4);
      ctx.moveTo(x + (cell * 3) / 4, y + cell / 4);
      ctx.lineTo(x + cell / 4, y + (cell * 3) / 4);
      ctx.stroke();
    } else if (value) {
      ctx.fillRect(x, y, cell, cell);
    }
  });

  ctx.fillStyle = highlight?.color ?? '';
  for (const i of highlight?.cells ?? []) {
    ctx.fillRect(
      left + (i % w) * cell,
      top + Math.floor(i / w) * cell,
      cell,
      cell,
    );
  }

  // Edited cells: a small square that shows on black, white and amber;
  // blue for hand edits, purple for auto-fixed cells.
  for (const i of edits.keys()) {
    ctx.fillStyle = fixed.has(i) ? '#9334e6' : '#1a73e8';
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
    labels.forEach((label, i) => {
      ctx.fillStyle = done?.rows[y]![i] ? DONE_GREY : '#000';
      ctx.fillText(
        label,
        left - (labels.length - i - 0.5) * cell,
        top + (y + 0.5) * cell,
      );
    });
  });
  puzzle.cols.forEach((runs, x) => {
    const labels = clueLabels(runs);
    labels.forEach((label, i) => {
      ctx.fillStyle = done?.cols[x]![i] ? DONE_GREY : '#000';
      ctx.fillText(
        label,
        left + (x + 0.5) * cell,
        top - (labels.length - i - 0.5) * cell,
      );
    });
  });
}
