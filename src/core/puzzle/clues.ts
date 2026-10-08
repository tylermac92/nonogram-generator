import { gridColumn, gridRow } from './grid.ts';
import type { ClueRun, Grid, Puzzle } from './types.ts';

/** Runs of equal non-zero values. A value change ends a run, so adjacent colors stay separate. */
export function lineClues(line: ArrayLike<number>): ClueRun[] {
  const runs: ClueRun[] = [];
  let length = 0;
  for (let i = 0; i < line.length; i++) {
    const color = line[i]!;
    length++;
    if (line[i + 1] !== color) {
      if (color !== 0) runs.push({ length, color });
      length = 0;
    }
  }
  return runs;
}

/** Display text for one line's clue; an empty line shows "0". */
export function clueLabels(runs: ClueRun[]): string[] {
  return runs.length ? runs.map((run) => String(run.length)) : ['0'];
}

export function makePuzzle(solution: Grid): Puzzle {
  const { width, height } = solution;
  return {
    width,
    height,
    rows: Array.from({ length: height }, (_, y) =>
      lineClues(gridRow(solution, y)),
    ),
    cols: Array.from({ length: width }, (_, x) =>
      lineClues(gridColumn(solution, x)),
    ),
    solution,
    palette: ['#fff', '#000'],
  };
}
