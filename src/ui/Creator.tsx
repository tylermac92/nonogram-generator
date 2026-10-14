import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeImage } from '../core/image/decode.ts';
import {
  adjust,
  binarize,
  downscale,
  otsu,
  toGray,
} from '../core/image/pipeline.ts';
import type { Rect, RgbaImage } from '../core/image/types.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import {
  DULL,
  fillFraction,
  type ScanRequest,
  type Suggestion,
} from '../core/repair/suggest.ts';
import { applyEdits, type Edits } from '../core/puzzle/grid.ts';
import type { CellValue } from '../core/puzzle/types.ts';
import { squareCrop } from './crop.ts';
import { CropBox } from './CropBox.tsx';
import { historyOf, record, redo, undo } from './history.ts';
import { gridSize } from './layout.ts';
import { Preview, type Highlight } from './Preview.tsx';
import { useSolver, type Check } from './useSolver.ts';
import { useSuggestions } from './useSuggestions.ts';

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
  const grid = useMemo(
    () => adjusted && binarize(adjusted, width, height, level, invert),
    [adjusted, width, height, level, invert],
  );
  // Hand edits go on last, so they survive every slider and Invert.
  const edited = useMemo(() => grid && applyEdits(grid, edits), [grid, edits]);
  const puzzle = useMemo(() => edited && makePuzzle(edited), [edited]);
  const check = useSolver(puzzle);
  const status = useMemo(() => verdict(check), [check]);

  const failing = check !== null && check.result.status !== 'solved';
  const scanRequest = useMemo((): ScanRequest | null => {
    if (!failing || !gray) return null;
    const sizes = [];
    for (let w = width - 3; w <= width + 3; w++) {
      if (w >= 5 && w <= maxWidth) sizes.push(gridSize(crop, w));
    }
    return {
      gray,
      crop,
      sizes,
      width,
      cutoff: level,
      brightness,
      contrast,
      invert,
      edits,
    };
  }, [
    failing,
    gray,
    crop,
    width,
    maxWidth,
    level,
    brightness,
    contrast,
    invert,
    edits,
  ]);
  const scan = useSuggestions(scanRequest);

  function applySuggestion(s: Suggestion) {
    if (s.width === width) update({ cutoff: s.cutoff });
    else resize({ width: s.width, cutoff: s.cutoff });
  }

  const filled = edited ? fillFraction(edited) : 0.5;
  const warning =
    filled > DULL.above
      ? 'Nearly all cells are filled — the puzzle will be dull.'
      : filled < DULL.below
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
          <p role="status" className={`verdict ${status.kind}`}>
            {status.text}
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
          {scan.state && (
            <div className="suggestions" aria-live="polite">
              {scan.state.status === 'scanning' && (
                <p>
                  Looking for nearby settings that pass…{' '}
                  <button type="button" onClick={scan.cancel}>
                    Cancel
                  </button>
                </p>
              )}
              {scan.state.status === 'cancelled' && <p>Search cancelled.</p>}
              {scan.state.status === 'done' &&
                (scan.state.suggestions.length === 0 ? (
                  <p>
                    No nearby settings pass. Try auto-fix, or edit the
                    highlighted cells by hand.
                  </p>
                ) : (
                  <p>
                    These nearby settings pass:{' '}
                    {scan.state.suggestions.map((s) => (
                      <button
                        key={`${s.width}-${s.cutoff}`}
                        type="button"
                        onClick={() => applySuggestion(s)}
                      >
                        Cutoff {s.cutoff}, width {s.width}
                        {s.width !== width &&
                          edits.size > 0 &&
                          ' — clears your edits'}
                      </button>
                    ))}
                  </p>
                ))}
            </div>
          )}
          <p className="hint">
            Click or drag on the grid to edit cells, or use the arrow keys and
            Space. Ctrl+Z undoes.
          </p>
          <Preview
            puzzle={puzzle}
            highlight={status.highlight}
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

const AMBER = 'rgba(255, 160, 0, 0.6)';
const RED = 'rgba(230, 0, 0, 0.5)';
const cells = (n: number) => `${n} ${n === 1 ? 'cell' : 'cells'}`;

/** The badge text and colour, and which cells to tint, for a check. */
function verdict(check: Check | null): {
  text: string;
  kind: string;
  highlight?: Highlight;
} {
  if (!check) return { text: 'Checking…', kind: '' };
  const { result, deep } = check;
  if (result.status === 'solved') {
    return { text: 'Valid — unique, solvable by logic', kind: 'valid' };
  }
  const n = result.undetermined.length;
  const undetermined = { cells: result.undetermined, color: AMBER };
  if (!deep) {
    return {
      text: `Not line-solvable — ${cells(n)} undetermined. Checking further…`,
      kind: 'pending',
      highlight: undetermined,
    };
  }
  if (deep.status === 'unique') {
    return {
      text: `Needs guessing — unique, but ${cells(n)} ${n === 1 ? 'needs' : 'need'} trial and error`,
      kind: 'guess',
      highlight: undetermined,
    };
  }
  if (deep.status === 'ambiguous') {
    const d = deep.differing.length;
    return {
      text: `Ambiguous — ${cells(d)} ${d === 1 ? 'differs' : 'differ'} in a second solution`,
      kind: 'invalid',
      highlight: { cells: deep.differing, color: RED },
    };
  }
  return {
    text: "Inconclusive — couldn't prove either way",
    kind: 'unknown',
    highlight: undetermined,
  };
}
