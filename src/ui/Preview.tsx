import { useEffect, useRef, useState } from 'react';
import { clueLabels } from '../core/puzzle/clues.ts';
import type { Puzzle } from '../core/puzzle/types.ts';
import { previewLayout } from './layout.ts';

/** The grid with its clues, drawn on one canvas. */
export function Preview({
  puzzle,
  undetermined,
}: {
  puzzle: Puzzle;
  undetermined?: number[];
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry!.contentRect.width),
    );
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => draw(canvas.current!, puzzle, available, undetermined),
    [puzzle, available, undetermined],
  );

  return (
    <div ref={wrapper} className="preview">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Puzzle preview, ${puzzle.width} by ${puzzle.height}`}
      />
    </div>
  );
}

function draw(
  canvas: HTMLCanvasElement,
  puzzle: Puzzle,
  available: number,
  undetermined: number[] = [],
) {
  const { cell, clueCols, clueRows, width, height } = previewLayout(
    puzzle,
    available,
  );
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
