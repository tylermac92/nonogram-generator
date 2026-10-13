import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeImage } from '../core/image/decode.ts';
import {
  adjust,
  cleanup,
  downscale,
  otsu,
  threshold,
  toGray,
} from '../core/image/pipeline.ts';
import type { Rect, RgbaImage } from '../core/image/types.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { applyEdits, createGrid, type Edits } from '../core/puzzle/grid.ts';
import type { CellValue } from '../core/puzzle/types.ts';
import { squareCrop } from './crop.ts';
import { CropBox } from './CropBox.tsx';
import { historyOf, record, redo, undo } from './history.ts';
import { gridSize } from './layout.ts';
import { Preview } from './Preview.tsx';
import { useSolver } from './useSolver.ts';

/** Everything the creator's controls set; saved with the project in M12. */
export interface Settings {
  crop: Rect;
  square: boolean;
  width: number;
  cutoff: number | null; // null = Auto (Otsu)
  invert: boolean;
  brightness: number;
  contrast: number;
}

const DEFAULTS: Settings = {
  crop: { x: 0, y: 0, width: 1, height: 1 },
  square: false,
  width: 20,
  cutoff: null,
  invert: false,
  brightness: 0,
  contrast: 0,
};
const PRESETS = [10, 15, 20, 25, 30, 40, 50];
const NO_EDITS = historyOf<Edits>(new Map());

export function Creator() {
  const [image, setImage] = useState<RgbaImage | null>(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [history, setHistory] = useState(NO_EDITS);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const edits = history.present;

  const confirmClear = () =>
    edits.size === 0 ||
    confirm(
      `This clears your ${edits.size} edited ${edits.size === 1 ? 'cell' : 'cells'}. Continue?`,
    );
  /** Edits sit on cell indexes, so a new crop or grid size would scramble them. */
  function resize(patch: Partial<Settings>) {
    if (!confirmClear()) return;
    setHistory(NO_EDITS);
    update(patch);
  }

  function paint(cells: number[], value: CellValue, start: boolean) {
    setHistory((h) => {
      const next = new Map(h.present);
      for (const i of cells) next.set(i, value);
      return start ? record(h, next) : { ...h, present: next };
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const { crop, square, cutoff, invert, brightness, contrast } = settings;

  // Each stage re-runs only when its own inputs change.
  const gray = useMemo(() => image && toGray(image), [image]);
  const { width, height, maxWidth } = gridSize(crop, settings.width);
  const values = useMemo(
    () => gray && downscale(gray, crop, width, height),
    [gray, crop, width, height],
  );
  // Otsu sees the values before brightness and contrast; otherwise Auto would
  // follow them and both sliders would seem to do nothing.
  const auto = useMemo(() => (values ? otsu(values) : 0), [values]);
  const level = cutoff ?? auto;
  const adjusted = useMemo(
    () => values && adjust(values, brightness, contrast),
    [values, brightness, contrast],
  );
  // Cleanup runs before invert so Invert is an exact swap.
  const cleaned = useMemo(
    () => adjusted && cleanup(threshold(adjusted, width, height, level, false)),
    [adjusted, width, height, level],
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
  // Hand edits go on last, so they survive every slider and Invert.
  const edited = useMemo(() => grid && applyEdits(grid, edits), [grid, edits]);
  const puzzle = useMemo(() => edited && makePuzzle(edited), [edited]);
  const result = useSolver(puzzle);
  const unknown = result?.undetermined.length ?? 0;

  const filled = edited
    ? edited.cells.reduce((sum, v) => sum + v, 0) / edited.cells.length
    : 0.5;
  const warning =
    filled > 0.9
      ? 'Nearly all cells are filled — the puzzle will be dull.'
      : filled < 0.05
        ? 'Nearly all cells are empty — the puzzle will be dull.'
        : null;

  async function open(file: File) {
    if (!confirmClear()) return;
    const id = ++latest.current;
    try {
      const decoded = await decodeImage(file);
      if (id !== latest.current) return;
      setImage(decoded);
      setHistory(NO_EDITS);
      setSettings((s) => ({
        ...DEFAULTS,
        width: s.width,
        crop: { x: 0, y: 0, width: decoded.width, height: decoded.height },
      }));
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
      <div className="workspace">
        {image && (
          <CropBox
            image={image}
            crop={crop}
            square={square}
            onStart={() => {
              if (edits.size === 0) return true;
              // Asked before the drag: a dialog mid-drag swallows the pointerup.
              if (confirmClear()) setHistory(NO_EDITS);
              return false;
            }}
            onChange={(crop) => resize({ crop })}
          />
        )}
        <div className="controls">
          <label>
            Width {width}
            {image && ` (height ${height})`}{' '}
            <input
              type="range"
              min={5}
              max={maxWidth}
              value={width}
              disabled={!image}
              onChange={(e) => resize({ width: Number(e.target.value) })}
            />
          </label>
          <div className="presets" role="group" aria-label="Size presets">
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={!image}
                onClick={() =>
                  resize({
                    width: n,
                    square: true,
                    crop: squareCrop(crop, image!.width, image!.height),
                  })
                }
              >
                {n}
              </button>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={square}
              disabled={!image}
              onChange={(e) =>
                e.target.checked
                  ? resize({
                      square: true,
                      crop: squareCrop(crop, image!.width, image!.height),
                    })
                  : update({ square: false })
              }
            />{' '}
            Lock to square
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
                onChange={(e) => update({ cutoff: Number(e.target.value) })}
              />
            </label>{' '}
            <button
              type="button"
              disabled={!image || cutoff === null}
              onClick={() => update({ cutoff: null })}
            >
              Auto
            </button>
          </span>
          <label>
            Brightness {brightness}{' '}
            <input
              type="range"
              min={-100}
              max={100}
              value={brightness}
              disabled={!image}
              onChange={(e) => update({ brightness: Number(e.target.value) })}
            />
          </label>
          <label>
            Contrast {contrast}{' '}
            <input
              type="range"
              min={-100}
              max={100}
              value={contrast}
              disabled={!image}
              onChange={(e) => update({ contrast: Number(e.target.value) })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={invert}
              disabled={!image}
              onChange={(e) => update({ invert: e.target.checked })}
            />{' '}
            Invert
          </label>
        </div>
      </div>
      <div role="status">
        {error && <p className="error">{error}</p>}
        {warning && <p>{warning}</p>}
      </div>
      {puzzle ? (
        <>
          <p
            role="status"
            className={`verdict ${result ? (result.status === 'solved' ? 'valid' : 'invalid') : ''}`}
          >
            {!result
              ? 'Checking…'
              : result.status === 'solved'
                ? 'Valid — unique, solvable by logic'
                : `Not line-solvable — ${unknown} ${unknown === 1 ? 'cell' : 'cells'} undetermined`}
          </p>{' '}
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
          </button>
          <p className="hint">
            Click or drag on the grid to edit cells, or use the arrow keys and
            Space. Ctrl+Z undoes.
          </p>
          <Preview
            puzzle={puzzle}
            undetermined={result?.undetermined}
            edits={edits}
            onPaint={paint}
          />
        </>
      ) : (
        <div className="dropzone">Drop an image here or choose a file</div>
      )}
    </main>
  );
}
