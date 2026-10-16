import { clueLabels } from '../puzzle/clues.ts';
import type { Puzzle } from '../puzzle/types.ts';

export const CELL = 20;
const PAD = 10;
export const FONT = 15; // clue size; two digits still leave a gap between neighbours

/** Where the grid starts, and the whole drawing's size, in SVG units. */
export function svgSize({ width, height, rows, cols }: Puzzle) {
  const left = PAD + Math.max(...rows.map((r) => clueLabels(r).length)) * CELL;
  const top = PAD + Math.max(...cols.map((c) => clueLabels(c).length)) * CELL;
  return {
    left,
    top,
    width: left + width * CELL + PAD,
    height: top + height * CELL + PAD,
  };
}

/**
 * The puzzle as a standalone SVG: clues, grid, a bold line every 5 cells, and
 * the filled cells when `solution` is set. Plain SVG 1.1 (no CSS), so vector
 * editors read it the same as browsers. Sizes are in CSS pixels at 1x.
 */
export function renderSvg(puzzle: Puzzle, { solution = false } = {}): string {
  const { width: w, height: h, rows, cols } = puzzle;
  const rowLabels = rows.map(clueLabels);
  const colLabels = cols.map(clueLabels);
  const size = svgSize(puzzle);
  const { left, top } = size;
  const right = left + w * CELL;
  const bottom = top + h * CELL;
  const baseline = 0.35 * FONT; // centres digits vertically without dominant-baseline
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
    `<rect width="${size.width}" height="${size.height}" fill="#fff"/>`,
  ];

  if (solution) {
    out.push('<g fill="#000">');
    puzzle.solution.cells.forEach((v, i) => {
      if (v === 0) return;
      const x = left + (i % w) * CELL;
      const y = top + Math.floor(i / w) * CELL;
      out.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`);
    });
    out.push('</g>');
  }

  out.push(
    `<g font-family="Arial, Helvetica, sans-serif" font-size="${FONT}" text-anchor="middle" fill="#000">`,
  );
  rowLabels.forEach((labels, y) =>
    labels.forEach((text, i) => {
      const x = left - (labels.length - i - 0.5) * CELL;
      out.push(
        `<text x="${x}" y="${top + (y + 0.5) * CELL + baseline}">${text}</text>`,
      );
    }),
  );
  colLabels.forEach((labels, x) =>
    labels.forEach((text, i) => {
      const y = top - (labels.length - i - 0.5) * CELL + baseline;
      out.push(`<text x="${left + (x + 0.5) * CELL}" y="${y}">${text}</text>`);
    }),
  );
  out.push('</g>');

  // Thin lines sit half a unit inside the cell so they cover whole pixels at
  // 1x, 2x and 4x; bold lines are 2 units wide, centred on the cell edge.
  const thin: string[] = [];
  const bold: string[] = [];
  for (let k = 0; k <= w; k++) {
    const x = left + k * CELL;
    if (k % 5 === 0 || k === w) bold.push(line(x, top, x, bottom));
    else thin.push(line(x + 0.5, top, x + 0.5, bottom));
  }
  for (let k = 0; k <= h; k++) {
    const y = top + k * CELL;
    if (k % 5 === 0 || k === h) bold.push(line(left, y, right, y));
    else thin.push(line(left, y + 0.5, right, y + 0.5));
  }
  out.push(
    `<g stroke="#999" stroke-width="1">${thin.join('')}</g>`,
    `<g stroke="#000" stroke-width="2" stroke-linecap="square">${bold.join('')}</g>`,
    '</svg>',
  );
  return out.join('\n');
}

const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
