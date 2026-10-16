import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeImage } from '../core/image/decode.ts';
import {
  adjust,
  binarize,
  downscale,
  otsu,
  toGray,
} from '../core/image/pipeline.ts';
import type { RgbaImage } from '../core/image/types.ts';
import { download, toJpeg } from '../core/io/canvas.ts';
import {
  invalid,
  parseProject,
  serializeProject,
  type Settings,
} from '../core/io/project.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import type { FixResult } from '../core/repair/autofix.ts';
import {
  DULL,
  fillFraction,
  type ScanRequest,
  type Suggestion,
} from '../core/repair/suggest.ts';
import { applyEdits, type Edits } from '../core/puzzle/grid.ts';
import type { CellValue, Grid } from '../core/puzzle/types.ts';
import { squareCrop } from './crop.ts';
import { CropBox } from './CropBox.tsx';
import { Export } from './Export.tsx';
import { historyOf, record, redo, undo } from './history.ts';
import { gridSize } from './layout.ts';
import { Preview, type Highlight } from './Preview.tsx';
import { PlayView } from './PlayView.tsx';
import { PrintView } from './PrintView.tsx';
import { useSolver, type Check } from './useSolver.ts';
import { useAutoFix } from './useAutoFix.ts';
import { useSuggestions } from './useSuggestions.ts';

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
/** One undo step: the edits, and which of them auto-fix made. */
interface EditState {
  edits: Edits;
  fixed: ReadonlySet<number>;
}
const NO_EDITS = historyOf<EditState>({ edits: new Map(), fixed: new Set() });

export function Creator() {
  const [image, setImage] = useState<RgbaImage | null>(null);
  const [settings, setSettings] = useState(DEFAULTS);
  const [history, setHistory] = useState(NO_EDITS);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [includeImage, setIncludeImage] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const away = printing || playing; // another view is showing
  // A loaded project's grid, used as is until a setting changes.
  const [loaded, setLoaded] = useState<{
    grid: Grid;
    settings: Settings;
  } | null>(null);
  const latest = useRef(0);
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const { edits, fixed } = history.present;
  const [report, setReport] = useState<{
    state: EditState;
    result: FixResult;
  } | null>(null);

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

  useEffect(() => {
    if (away) return; // play has its own undo; hidden edits must not change
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? redo(h) : undo(h)));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [away]);
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
  // A project's saved grid stands in for the pipeline until a setting changes:
  // rebuilding it from the smaller embedded JPEG could flip cells.
  const grid = useMemo(
    () =>
      loaded?.settings === settings
        ? loaded.grid
        : adjusted && binarize(adjusted, width, height, level, invert),
    [loaded, settings, adjusted, width, height, level, invert],
  );
  // Hand edits go on last, so they survive every slider and Invert.
  const edited = useMemo(() => grid && applyEdits(grid, edits), [grid, edits]);
  const puzzle = useMemo(() => edited && makePuzzle(edited), [edited]);
  function paint(cells: number[], value: CellValue, start: boolean) {
    setHistory((h) => {
      const edits = new Map(h.present.edits);
      const fixed = new Set(h.present.fixed);
      for (const i of cells) {
        // Painting an auto-fixed cell back to the image's value reverts that flip.
        if (fixed.delete(i) && grid?.cells[i] === value) edits.delete(i);
        else edits.set(i, value);
      }
      const next = { edits, fixed };
      return start ? record(h, next) : { ...h, present: next };
    });
  }

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

  const fixer = useAutoFix(puzzle);
  function startFix() {
    if (!edited || !adjusted) return;
    const before = history.present;
    const request = {
      grid: edited,
      values: adjusted,
      cutoff: level,
      locked: [...before.edits.keys()],
    };
    fixer.start(request, (result) => {
      let state = before;
      if (result.flips.length > 0) {
        const edits = new Map(before.edits);
        const fixed = new Set(before.fixed);
        for (const i of result.flips) {
          edits.set(i, 1 - edited.cells[i]!);
          fixed.add(i);
        }
        state = { edits, fixed };
        setHistory((h) => record(h, state)); // one undo step for the whole fix
      }
      setReport({ state, result });
    });
  }

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
      setLoaded(null);
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

  const name = title.trim() || 'nonogram';
  function save() {
    if (!grid) return;
    let saved = settings;
    let embedded: string | undefined;
    if (includeImage && image) {
      const { url, scale } = toJpeg(image);
      embedded = url;
      const { x, y, width, height } = crop;
      saved = {
        ...settings,
        crop: {
          x: x * scale,
          y: y * scale,
          width: width * scale,
          height: height * scale,
        },
      };
    }
    const json = serializeProject({
      title,
      settings: saved,
      grid,
      edits,
      fixed,
      ...(embedded && { image: embedded }),
    });
    download(new Blob([json], { type: 'application/json' }), `${name}.json`);
  }

  /** Checks the whole file before anything changes. */
  async function openProject(file: File) {
    const id = ++latest.current;
    try {
      const project = parseProject(await file.text());
      let source: RgbaImage | null = null;
      if (project.image) {
        try {
          source = await decodeImage(await (await fetch(project.image)).blob());
        } catch {
          throw invalid('image');
        }
      }
      const { crop, width } = project.settings;
      if (
        source &&
        (crop.x + crop.width > source.width ||
          crop.y + crop.height > source.height)
      ) {
        throw invalid('settings.crop');
      }
      const size = gridSize(crop, width);
      if (
        size.width !== project.grid.width ||
        size.height !== project.grid.height
      ) {
        throw invalid('grid');
      }
      if (id !== latest.current || !confirmClear()) return;
      setImage(source);
      setSettings(project.settings);
      setLoaded({ grid: project.grid, settings: project.settings });
      setHistory(historyOf({ edits: project.edits, fixed: project.fixed }));
      setTitle(project.title);
      setError(null);
    } catch (e) {
      if (id === latest.current) setError((e as Error).message);
    }
  }

  return (
    <>
      {printing && puzzle && (
        <PrintView
          puzzle={puzzle}
          title={title}
          warn={failing}
          onClose={() => setPrinting(false)}
        />
      )}
      {playing && puzzle && (
        <PlayView
          puzzle={puzzle}
          title={title}
          onClose={() => setPlaying(false)}
        />
      )}
      <main
        className="creator"
        hidden={away}
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
        </label>{' '}
        <label>
          Open project{' '}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void openProject(file);
              e.target.value = '';
            }}
          />
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
          {puzzle && !image && (
            <p>
              This project has no source image, so the crop and image settings
              can&apos;t be changed. Hand edits still work.
            </p>
          )}
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
                <p>
                  {fixer.running ? (
                    <>
                      Auto-fixing…
                      {fixer.running.progress &&
                        ` ${cells(fixer.running.progress.flips)} flipped, ${fixer.running.progress.undetermined} undetermined.`}{' '}
                      <button type="button" onClick={fixer.cancel}>
                        Cancel auto-fix
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={startFix}>
                      Auto-fix
                    </button>
                  )}
                </p>
              </div>
            )}
            {report?.state === history.present && (
              <p role="status">{fixReport(report.result)}</p>
            )}
            <p className="hint">
              Click or drag on the grid to edit cells, or use the arrow keys and
              Space. Ctrl+Z undoes. Purple marks a cell auto-fix flipped; click
              it to flip it back.
            </p>
            <Preview
              puzzle={puzzle}
              highlight={status.highlight}
              edits={edits}
              fixed={fixed}
              onPaint={paint}
            />
            <label>
              Title{' '}
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <Export puzzle={puzzle} name={name} warn={failing} />
            <p>
              <button
                type="button"
                onClick={() => {
                  setPrinting(true);
                  scrollTo(0, 0); // the button sits far down the creator
                }}
              >
                Print…
              </button>{' '}
              <button
                type="button"
                onClick={() => {
                  setPlaying(true);
                  scrollTo(0, 0);
                }}
              >
                Play this puzzle
              </button>
            </p>
            <fieldset>
              <legend>Project</legend>
              <button type="button" onClick={save}>
                Save project
              </button>{' '}
              <label>
                <input
                  type="checkbox"
                  checked={includeImage && image !== null}
                  disabled={!image}
                  onChange={(e) => setIncludeImage(e.target.checked)}
                />{' '}
                Include source image
              </label>
            </fieldset>
          </>
        ) : (
          <div className="dropzone">Drop an image here or choose a file</div>
        )}
      </main>
    </>
  );
}

const AMBER = 'rgba(255, 160, 0, 0.6)';
const RED = 'rgba(230, 0, 0, 0.5)';
const cells = (n: number) => `${n} ${n === 1 ? 'cell' : 'cells'}`;

function fixReport({ flips, undetermined, reason }: FixResult) {
  const flipped = `Auto-fix flipped ${cells(flips.length)}`;
  if (reason === 'solved') return `${flipped}.`;
  const left = `${cells(undetermined)} ${undetermined === 1 ? 'is' : 'are'} still undetermined`;
  return reason === 'stuck'
    ? `${flipped}; ${left}. No single flip helps any more.`
    : `${flipped}; ${left}. The flip budget (5% of cells) ran out.`;
}

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
