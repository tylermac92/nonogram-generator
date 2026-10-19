import { useState, type ReactNode } from 'react';
import { renderSvg, svgSize } from '../core/io/svg.ts';
import type { Puzzle } from '../core/puzzle/types.ts';
import type { Difficulty } from '../core/solver/difficulty.ts';
import {
  MIN_CLUE_PT,
  PAPERS,
  printLayout,
  type Orientation,
  type Paper,
} from './print.ts';

/** Puzzle and solution sheets, sized to the chosen paper; only the sheets print. */
export function PrintView({
  puzzle,
  title,
  warn,
  difficulty,
  onClose,
}: {
  puzzle: Puzzle;
  title: string;
  warn: boolean; // the verdict isn't Valid
  difficulty: Difficulty | null;
  onClose: () => void;
}) {
  const [paper, setPaper] = useState<Paper>('letter');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const layout = printLayout(svgSize(puzzle), paper, orientation);
  const name = title.trim() || 'Nonogram';
  const sheet = (heading: ReactNode, solution: boolean) => (
    <section
      className="sheet"
      style={{
        width: `${layout.sheetWidth}mm`,
        height: `${layout.sheetHeight}mm`,
      }}
    >
      <h2>{heading}</h2>
      <div
        style={{
          width: `${layout.drawingWidth}mm`,
          height: `${layout.drawingHeight}mm`,
        }}
        // Only renderSvg's own markup and digits; the title stays React text.
        dangerouslySetInnerHTML={{ __html: renderSvg(puzzle, { solution }) }}
      />
    </section>
  );

  return (
    <div className="print-view">
      <style>{`@page { size: ${PAPERS[paper].name} ${orientation}; margin: 0; }`}</style>
      <div className="print-controls">
        <button type="button" onClick={onClose}>
          Back to editor
        </button>{' '}
        <label>
          Paper{' '}
          <select
            value={paper}
            onChange={(e) => setPaper(e.target.value as Paper)}
          >
            <option value="letter">Letter</option>
            <option value="a4">A4</option>
          </select>
        </label>{' '}
        <label>
          Orientation{' '}
          <select
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as Orientation)}
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>{' '}
        <button type="button" onClick={() => print()}>
          Print
        </button>
        {layout.clueSize < MIN_CLUE_PT && (
          <p className="warning">
            Clues print at {layout.clueSize.toFixed(1)} pt. Try the other
            orientation, or a smaller grid.
          </p>
        )}
        {warn && (
          <p className="warning">
            This puzzle isn&apos;t Valid yet, so solvers may need to guess or
            may find a different answer. You can still print it.
          </p>
        )}
      </div>
      {sheet(
        <>
          {name}
          {difficulty && <small> · {difficulty} difficulty (estimate)</small>}
        </>,
        false,
      )}
      {sheet(`${name} — Solution`, true)}
    </div>
  );
}
