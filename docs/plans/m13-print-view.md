# M13 Implementation Plan — Print View

Plan for the thirteenth user story in `docs/user-stories.md`:

> As a creator, I want a clean printable puzzle with a separate solution page, so that I can hand out puzzles on paper or save them as a PDF.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| Where the view lives | A "Print…" button in the creator opens a print view **in the same page**. The creator stays mounted but is `hidden`, and "Back to editor" brings it back with everything as it was. There is no URL route | The spec says "dedicated route", but a real URL route would lose the creator's state on reload, or need the puzzle in the URL (M15's shareable link). Keeping the creator mounted is the least code and loses nothing |
| Pages | Two sheets. Sheet 1: the title (or "Nonogram"), then the blank puzzle SVG. Sheet 2: "<title> — Solution", then the solution SVG. Both come from M12's `renderSvg`. Difficulty goes on sheet 1 once M16 adds it | The spec's two pages, using the shared renderer |
| Paper and orientation | Two selects: Letter or A4, portrait or landscape. Default: Letter, portrait. A `<style>` element written from that state sets `@page { size: letter portrait; margin: 0 }` | Chrome and Firefox both follow `@page size`, so the print dialog opens on the chosen paper |
| Page geometry | Each sheet is a box exactly the paper's size in `mm`, with 10 mm padding and a 10 mm heading line. `break-after: page` goes on the first sheet only. The on-screen preview is these same boxes, grey around white, so what you see is what prints | One set of boxes for screen and print means the preview can't drift from the output |
| Auto-fit | `printLayout(svgSize, paper, orientation)` in `ui/print.ts` (pure) works out the scale in pt per SVG unit, `min(available width ÷ SVG width, available height ÷ SVG height)`, and returns the SVG's printed size and the clue font size in pt. Both sheets use the same scale. `renderSvg`'s size calculation moves into an exported `svgSize(puzzle)`, so print doesn't parse the SVG string | Biggest cells that fit; the clue area is already sized to the longest clue by the renderer |
| Clue size | The renderer's clue font goes from 12 to 15 units in a 20-unit cell (0.75 of a cell), for export as well as print. A two-digit clue still leaves about 3 units between neighbours | At 12 units, a 50x50 would print at about 6 pt. At 15, it reaches 7 pt (table below) |
| Small-print warning | Under the controls (on screen only): "Clues print at 6.4 pt. Try the other orientation, or a smaller grid." whenever the clue size is under 7 pt | The limits depend on the clues, so the view says when they are crossed |
| Non-Valid warning | The same "isn't Valid yet" line as the export section, on screen only | Printing is an export too (M12's criterion) |
| Nothing else prints | `@media print` hides the creator, the print controls and the warnings. The sheets lose their shadow and screen margins | "No app UI on the printed pages" |
| Printing | A "Print" button calls `window.print()`. The browser's dialog offers Save as PDF | As the spec says |

What 7 pt allows on a 50x50 (clue font 0.75 of a cell, 10 mm margins, 10 mm heading). "Row clues" is the most numbers in any row's clue; "column clues" is the most in any column's:

| Paper | Portrait | Landscape |
| --- | --- | --- |
| Letter | Up to 8 row clues (column clues up to 24) | Up to 5 column clues (row clues up to 27) |
| A4 | Up to 6 row clues (column clues up to 30) | Up to 3 column clues (row clues up to 33) |

## Files

```
src/core/io/svg.ts             # svgSize, clue font 15
src/core/io/svg.test.ts        # clues stay clear of the grid
src/ui/print.ts                # PAPERS, printLayout
src/ui/print.test.ts           # Node
src/ui/PrintView.tsx           # sheets, paper and orientation, Print, Back
src/ui/Creator.tsx             # Print… button, hidden while printing
src/ui/app.css                 # sheets, @media print
src/ui/Creator.browser.test.tsx
```

## Steps

1. **`svgSize`** and the font change; existing SVG and export tests must still pass.
2. **`print.ts`:** paper sizes in mm, `printLayout`.
3. **`PrintView`:** props `puzzle`, `title`, `warn`, `onClose`. It renders the controls, the `@page` style and the two sheets. Each SVG is inserted with `dangerouslySetInnerHTML`; that string comes only from `renderSvg` (digits and fixed markup), and the title is rendered as React text.
4. **`Creator`:** a `printing` state; the creator `<main>` gets `hidden={printing}`.

## Tests

`svg.test.ts`: for a puzzle with two-digit clues on both axes, every row clue's right edge (estimated at 0.6 em per digit) stays left of the grid, and every column clue's baseline sits above it.

`print.test.ts` (Node):

| Case | Expected |
| --- | --- |
| A 50x50 heart (few clues) on Letter and A4, portrait and landscape | Fits inside the printable area; clue size ≥ 7 pt in every combination |
| A 50x50 with 8 numbers in its longest row clue | ≥ 7 pt on Letter portrait; under 7 on A4 portrait, so the warning would show |
| Landscape vs portrait for a wide puzzle | Landscape gives the larger scale |

`Creator.browser.test.tsx`:

| Case | Expected |
| --- | --- |
| Print… on the square image | Two sheets; the first holds the title and no filled cells, the second the solution's filled cells; the creator is hidden |
| Switch to A4, then landscape | The sheet's width changes (210 mm, then 297 mm) and the `@page` rule changes with it |
| Print | `window.print` is called (stubbed) |
| Back to editor | The creator shows again with its settings, edits and verdict unchanged |
| The ambiguous diagonal | The non-Valid warning shows in the print view |

Production check (Playwright on the built app): print a 50x50 to PDF with the CSS page size, for all four paper and orientation combinations. `pdfinfo` must report exactly 2 pages of the right size, and `pdftotext` must find the clues and title but none of the app's button or label text. Render page 1 with `pdftoppm` and look at it.

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| Printing gives exactly two pages, puzzle then solution | PDF check: 2 pages; page 1 has no filled cells and page 2 does |
| A 50x50 fits one Letter or A4 page with clues ≥ 7 pt | `printLayout` Node tests; the PDF check on a 50x50 |
| Bold rules every 5 cells; clue areas never overlap the grid | M12's SVG line tests; the new clue-clearance test |
| Changing paper or orientation updates the preview before printing | Paper and orientation browser test |
| No app UI on the printed pages | `pdftotext` finds no UI text |

## Out of scope for M13

The difficulty line (M16), custom margins, remembering the paper choice, more than one puzzle per page, and a print button in play mode.

## Risks

- **Busy 50x50 puzzles print under 7 pt:** a photo with many short runs can have more clue numbers than the table allows. The view then says so and suggests the other orientation or a smaller grid; it doesn't shrink the margins.
- **Browser print quirks:** rounding can push a sheet that is exactly page-sized onto a third, blank page. The PDF check catches this; if it happens, sheets lose 1 mm of height.
- **Thin grey lines** print at about 0.4 pt and may look faint on some printers; bold rules are twice as thick.
