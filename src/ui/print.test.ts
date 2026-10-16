import { describe, expect, it } from 'vitest';
import { makePuzzle } from '../core/puzzle/clues.ts';
import { createGrid } from '../core/puzzle/grid.ts';
import { svgSize } from '../core/io/svg.ts';
import {
  HEADING_MM,
  MARGIN_MM,
  MIN_CLUE_PT,
  printLayout,
  type Orientation,
  type Paper,
} from './print.ts';

/** A 50x50 filled disc: a few runs per line, like a simple image. */
function disc() {
  const cells = new Uint8Array(2500);
  for (let i = 0; i < 2500; i++) {
    const [x, y] = [(i % 50) - 24.5, Math.floor(i / 50) - 24.5];
    cells[i] = x * x + y * y < 22 * 22 ? 1 : 0;
  }
  return makePuzzle(createGrid(50, 50, cells));
}

/** 50x50 whose first row clue has `n` numbers; other lines are simple. */
function rowClues(n: number) {
  const cells = new Uint8Array(2500);
  for (let k = 0; k < n; k++) cells[k * 2] = 1;
  return makePuzzle(createGrid(50, 50, cells));
}

const combos: [Paper, Orientation][] = [
  ['letter', 'portrait'],
  ['letter', 'landscape'],
  ['a4', 'portrait'],
  ['a4', 'landscape'],
];

describe('printLayout', () => {
  it.each(combos)(
    'fits a simple 50x50 on %s %s with clues of at least 7 pt',
    (paper, orientation) => {
      const layout = printLayout(svgSize(disc()), paper, orientation);
      expect(layout.drawingWidth).toBeLessThanOrEqual(
        layout.sheetWidth - 2 * MARGIN_MM + 1e-9,
      );
      expect(layout.drawingHeight).toBeLessThanOrEqual(
        layout.sheetHeight - 2 * MARGIN_MM - HEADING_MM + 1e-9,
      );
      expect(layout.clueSize).toBeGreaterThanOrEqual(MIN_CLUE_PT);
    },
  );

  it('keeps 7 pt for 8 row clues on Letter portrait, but not on A4 portrait', () => {
    const size = svgSize(rowClues(8));
    expect(
      printLayout(size, 'letter', 'portrait').clueSize,
    ).toBeGreaterThanOrEqual(MIN_CLUE_PT);
    expect(printLayout(size, 'a4', 'portrait').clueSize).toBeLessThan(
      MIN_CLUE_PT,
    );
  });

  it('gives a wide puzzle a bigger scale in landscape', () => {
    const wide = svgSize(makePuzzle(createGrid(50, 10, new Uint8Array(500))));
    expect(printLayout(wide, 'letter', 'landscape').clueSize).toBeGreaterThan(
      printLayout(wide, 'letter', 'portrait').clueSize,
    );
  });

  it('swaps the sheet sides for landscape', () => {
    const size = svgSize(disc());
    expect(printLayout(size, 'a4', 'landscape')).toMatchObject({
      sheetWidth: 297,
      sheetHeight: 210,
    });
  });
});
