import { useState } from 'react';
import { download, svgToPng } from '../core/io/canvas.ts';
import { renderSvg } from '../core/io/svg.ts';
import type { Puzzle } from '../core/puzzle/types.ts';

/** SVG and PNG downloads of the blank puzzle or its solution. */
export function Export({
  puzzle,
  name,
  warn,
}: {
  puzzle: Puzzle;
  name: string; // file name stem
  warn: boolean; // the verdict isn't Valid
}) {
  const [solution, setSolution] = useState(false);
  const variant = solution ? 'solution' : 'puzzle';
  const svg = () => renderSvg(puzzle, { solution });
  return (
    <fieldset className="export">
      <legend>Export</legend>
      {warn && (
        <p className="warning">
          This puzzle isn&apos;t Valid yet, so solvers may need to guess or may
          find a different answer. You can still export it.
        </p>
      )}
      <label>
        <input
          type="radio"
          name="variant"
          checked={!solution}
          onChange={() => setSolution(false)}
        />{' '}
        Puzzle
      </label>{' '}
      <label>
        <input
          type="radio"
          name="variant"
          checked={solution}
          onChange={() => setSolution(true)}
        />{' '}
        Solution
      </label>{' '}
      <button
        type="button"
        onClick={() =>
          download(
            new Blob([svg()], { type: 'image/svg+xml' }),
            `${name}-${variant}.svg`,
          )
        }
      >
        SVG
      </button>
      {[1, 2, 4].map((scale) => (
        <button
          key={scale}
          type="button"
          onClick={async () =>
            download(
              await svgToPng(svg(), scale),
              `${name}-${variant}${scale > 1 ? `@${scale}x` : ''}.png`,
            )
          }
        >
          PNG {scale}x
        </button>
      ))}
    </fieldset>
  );
}
