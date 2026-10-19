import type { Rect } from '../image/types.ts';
import { gridFromRows, type Edits } from '../puzzle/grid.ts';
import type { Grid } from '../puzzle/types.ts';
import type { Difficulty } from '../solver/difficulty.ts';

/** Everything the creator's controls set. */
export interface Settings {
  crop: Rect;
  square: boolean;
  width: number;
  cutoff: number | null; // null = Auto (Otsu)
  invert: boolean;
  brightness: number;
  contrast: number;
}

/** A saved creator session. The puzzle is `grid` (before edits) plus `edits`. */
export interface Project {
  title: string;
  settings: Settings;
  grid: Grid;
  edits: Edits;
  fixed: ReadonlySet<number>; // auto-fixed cells among the edits
  image?: string; // JPEG data URL, at most 512 px
  difficulty?: Difficulty; // written for readers of the file; never read back
}

export const VERSION = 1;

export function serializeProject({ grid, edits, fixed, ...rest }: Project) {
  const rows = Array.from({ length: grid.height }, (_, y) =>
    grid.cells.slice(y * grid.width, (y + 1) * grid.width).join(''),
  );
  return JSON.stringify({
    version: VERSION,
    ...rest,
    grid: rows,
    edits: [...edits],
    fixed: [...fixed],
  });
}

/** Checks every field; throws an Error with a message for the user. */
export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalid('JSON');
  }
  if (!isObject(data) || typeof data.version !== 'number') {
    throw invalid('version');
  }
  if (data.version !== VERSION) {
    throw new Error(
      `This project is version ${data.version}; this app opens version ${VERSION}.`,
    );
  }
  const { title, settings: s, grid: rows, edits, fixed, image } = data;
  if (typeof title !== 'string') throw invalid('title');
  if (!isObject(s)) throw invalid('settings');
  const c = s.crop;
  if (
    !isObject(c) ||
    ![c.x, c.y, c.width, c.height].every(
      (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0,
    ) ||
    !((c.width as number) > 0 && (c.height as number) > 0)
  ) {
    throw invalid('settings.crop');
  }
  if (typeof s.square !== 'boolean') throw invalid('settings.square');
  if (!isInt(s.width, 5, 50)) throw invalid('settings.width');
  if (s.cutoff !== null && !isInt(s.cutoff, 0, 255)) {
    throw invalid('settings.cutoff');
  }
  if (typeof s.invert !== 'boolean') throw invalid('settings.invert');
  if (!isInt(s.brightness, -100, 100)) throw invalid('settings.brightness');
  if (!isInt(s.contrast, -100, 100)) throw invalid('settings.contrast');

  if (
    !Array.isArray(rows) ||
    !isInt(rows.length, 5, 50) ||
    !rows.every(
      (r) =>
        typeof r === 'string' &&
        r.length === rows[0].length &&
        /^[01]+$/.test(r),
    ) ||
    !isInt(rows[0].length, 5, 50)
  ) {
    throw invalid('grid');
  }
  const grid = gridFromRows(rows as string[]);
  const size = grid.cells.length;
  if (
    !Array.isArray(edits) ||
    !edits.every(
      (e) =>
        Array.isArray(e) &&
        e.length === 2 &&
        isInt(e[0], 0, size - 1) &&
        isInt(e[1], 0, 1),
    )
  ) {
    throw invalid('edits');
  }
  if (!Array.isArray(fixed) || !fixed.every((i) => isInt(i, 0, size - 1))) {
    throw invalid('fixed');
  }
  if (
    image !== undefined &&
    (typeof image !== 'string' || !image.startsWith('data:image/'))
  ) {
    throw invalid('image');
  }
  return {
    title,
    settings: {
      crop: { x: c.x, y: c.y, width: c.width, height: c.height } as Rect,
      square: s.square,
      width: s.width as number,
      cutoff: s.cutoff as number | null,
      invert: s.invert,
      brightness: s.brightness as number,
      contrast: s.contrast as number,
    },
    grid,
    edits: new Map(edits as [number, number][]),
    fixed: new Set(fixed as number[]),
    ...(image === undefined ? {} : { image }),
  };
}

export const invalid = (field: string) =>
  new Error(`This isn't a valid project file (problem: ${field}).`);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
