import { useMemo, useRef, useState } from 'react';
import { decodeImage } from '../core/image/decode.ts';
import {
  cleanup,
  downscale,
  otsu,
  threshold,
  toGray,
} from '../core/image/pipeline.ts';
import type { RgbaImage } from '../core/image/types.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { createGrid } from '../core/puzzle/grid.ts';
import { gridHeight } from './layout.ts';
import { Preview } from './Preview.tsx';

export function Creator() {
  const [image, setImage] = useState<RgbaImage | null>(null);
  const [width, setWidth] = useState(20);
  const [cutoff, setCutoff] = useState<number | null>(null);
  const [invert, setInvert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // Each stage re-runs only when its own inputs change.
  const gray = useMemo(() => image && toGray(image), [image]);
  const height = gray ? gridHeight(gray.width, gray.height, width) : 0;
  const values = useMemo(
    () =>
      gray &&
      downscale(
        gray,
        { x: 0, y: 0, width: gray.width, height: gray.height },
        width,
        height,
      ),
    [gray, width, height],
  );
  const auto = useMemo(() => (values ? otsu(values) : 0), [values]);
  const level = cutoff ?? auto;
  // Cleanup runs before invert so Invert is an exact swap.
  const cleaned = useMemo(
    () => values && cleanup(threshold(values, width, height, level, false)),
    [values, width, height, level],
  );
  const grid = useMemo(
    () =>
      cleaned && invert
        ? createGrid(
            cleaned.width,
            cleaned.height,
            cleaned.cells.map((v) => 1 - v),
          )
        : cleaned,
    [cleaned, invert],
  );
  const puzzle = useMemo(() => grid && makePuzzle(grid), [grid]);

  const filled = grid
    ? grid.cells.reduce((sum, v) => sum + v, 0) / grid.cells.length
    : 0.5;
  const warning =
    filled > 0.9
      ? 'Nearly all cells are filled — the puzzle will be dull.'
      : filled < 0.05
        ? 'Nearly all cells are empty — the puzzle will be dull.'
        : null;

  async function open(file: File) {
    const id = ++latest.current;
    try {
      const decoded = await decodeImage(file);
      if (id !== latest.current) return;
      setImage(decoded);
      setCutoff(null);
      setError(null);
    } catch {
      if (id === latest.current) {
        setError("Couldn't read this file. Try a JPEG or PNG.");
      }
    }
  }

  return (
    <main
      className="creator"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void open(file);
      }}
    >
      <h1>Nonogram Generator</h1>
      <div className="controls">
        <label>
          Image{' '}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(file);
              e.target.value = '';
            }}
          />{' '}
          or drop an image anywhere
        </label>
        <label>
          Width {width}
          {image && ` (height ${height})`}{' '}
          <input
            type="range"
            min={5}
            max={50}
            value={width}
            disabled={!image}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <span>
          <label>
            Cutoff {level}
            {cutoff === null && ' (auto)'}{' '}
            <input
              type="range"
              min={0}
              max={255}
              value={level}
              disabled={!image}
              onChange={(e) => setCutoff(Number(e.target.value))}
            />
          </label>{' '}
          <button
            type="button"
            disabled={!image || cutoff === null}
            onClick={() => setCutoff(null)}
          >
            Auto
          </button>
        </span>
        <label>
          <input
            type="checkbox"
            checked={invert}
            disabled={!image}
            onChange={(e) => setInvert(e.target.checked)}
          />{' '}
          Invert
        </label>
      </div>
      <div role="status">
        {error && <p className="error">{error}</p>}
        {warning && <p>{warning}</p>}
      </div>
      {puzzle ? (
        <Preview puzzle={puzzle} />
      ) : (
        <div className="dropzone">Drop an image here or choose a file</div>
      )}
    </main>
  );
}
