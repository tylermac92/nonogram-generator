import { FONT } from '../core/io/svg.ts';

export const PAPERS = {
  letter: { name: 'Letter', width: 215.9, height: 279.4 },
  a4: { name: 'A4', width: 210, height: 297 },
} as const; // portrait sizes in mm
export type Paper = keyof typeof PAPERS;
export type Orientation = 'portrait' | 'landscape';

export const MARGIN_MM = 10;
export const HEADING_MM = 10;
const PT_PER_MM = 72 / 25.4;
export const MIN_CLUE_PT = 7;

/** Sheet size in mm, and the drawing's printed size and clue size at the biggest scale that fits. */
export function printLayout(
  svg: { width: number; height: number },
  paper: Paper,
  orientation: Orientation,
) {
  const { width, height } = PAPERS[paper];
  const [sheetWidth, sheetHeight] =
    orientation === 'portrait' ? [width, height] : [height, width];
  const mm = Math.min(
    (sheetWidth - 2 * MARGIN_MM) / svg.width,
    (sheetHeight - 2 * MARGIN_MM - HEADING_MM) / svg.height,
  ); // per SVG unit
  return {
    sheetWidth,
    sheetHeight,
    drawingWidth: svg.width * mm,
    drawingHeight: svg.height * mm,
    clueSize: FONT * mm * PT_PER_MM,
  };
}
