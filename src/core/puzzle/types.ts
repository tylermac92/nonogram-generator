export type CellValue = number; // 0 = empty/background; 1 = filled (v1). Color: 1..N = palette index

export interface Grid {
  width: number;
  height: number;
  cells: Uint8Array; // row-major
}

export interface ClueRun {
  length: number;
  color: number; // color is always 1 in v1
}

export interface Puzzle {
  width: number;
  height: number;
  rows: ClueRun[][];
  cols: ClueRun[][];
  solution: Grid;
  palette: string[]; // v1: ['#fff', '#000']
}
