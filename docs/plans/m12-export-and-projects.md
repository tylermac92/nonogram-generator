# M12 Implementation Plan — Image Export and Project Files

Plan for the twelfth user story in `docs/user-stories.md`:

> As a creator, I want to export my puzzle as an image and save my work as a project file, so that I can post puzzles online and come back later to edit them.

## Decisions

| Topic | Choice | Why |
| --- | --- | --- |
| SVG renderer | `renderSvg(puzzle, { solution })` in `core/io/svg.ts` returns a string. It draws a white background, the column clues stacked above each column, the row clues side by side left of each row, then the grid. In the solution variant, filled cells are black `<rect>`s. Clue areas get one 20-unit slot per number of the longest clue (at least one, for "0"), as in the preview | The spec's shared, string-built renderer, pure and tested in Node. Print (M13) and thumbnails reuse it |
| Vector-editor safety | Plain SVG 1.1 only: `xmlns`, `width`, `height` and `viewBox`, `<rect>`, `<line>` and `<text>` with presentation attributes. There is no CSS, `dominant-baseline`, `foreignObject` or web font: text is centred with `text-anchor="middle"` and a computed baseline, in `Arial, Helvetica, sans-serif` | These features render the same in browsers, Inkscape and Illustrator |
| Lines | Thin grey lines between cells; black lines 2 units wide every 5 cells and around the grid. Thin lines sit half a unit off the cell edge (`x + 0.5`), so a 1-unit line covers whole pixels at 1x, 2x and 4x | "Bold lines every 5 cells", and sharp PNGs: a centred 1-unit line would smear over two pixels at 1x |
| PNG | `svgToPng(svg, scale)` in `core/io/canvas.ts`: load the SVG into an `Image` through a blob URL, draw it onto a canvas `scale` times its size, then `toBlob('image/png')`. Scales 1, 2 and 4 | The spec's method. Chrome rasterises an SVG at the size it is drawn, so 4x stays sharp, and the PNG matches the SVG by construction |
| Export controls | A small `Export` component under the preview: a Puzzle / Solution choice, then "SVG", "PNG 1x", "PNG 2x" and "PNG 4x" buttons. Files download as `<title or "nonogram">-puzzle.svg`, `…-solution@2x.png`, and so on, through an `<a download>` and a blob URL | One choice and four buttons cover both variants and every format |
| Export warning | While the verdict isn't Valid, the export section shows a warning line: "This puzzle isn't Valid yet, so solvers may need to guess or may find a different answer. You can still export it." The buttons stay enabled | "Shows a warning on export, but export stays possible". A visible line warns before the click, without an extra dialog |
| Title | A Title text field above the export section, stored in `Creator` state. It names the downloaded files and is saved in the project. It isn't drawn in the SVG | The project needs a title. Drawing it belongs to the print view (M13) |
| Project format | `core/io/project.ts`:<br>`{ version: 1, title, settings, grid: string[], edits: [index, value][], fixed: number[], image?: string }`<br>`settings` is the creator's `Settings` (crop, square lock, width, cutoff or `null` for Auto, Invert, brightness, contrast), which moves into this file. `grid` is the pipeline's grid **before** edits, one `"0101…"` string per row (read back with `gridFromRows`). `fixed` holds the auto-fixed cells, so the purple markers come back. `image` is a JPEG data URL | Everything the story lists. The puzzle is `grid` plus `edits`. Row strings keep the file readable |
| Exact restore | When a project loads, its `grid` is used as is, in place of the pipeline's output, until any setting changes. In code: `grid = loaded?.settings === settings ? loaded.grid : binarize(…)`. Edits, undo and redo don't touch `settings`, so the loaded grid stays in place while you edit | The embedded image is a smaller JPEG, so rebuilding the grid from it could flip cells near the cutoff and change the verdict. The saved grid gives the exact same puzzle and verdict. After a setting change, the grid comes from the embedded image as usual |
| Embedded image | `toJpeg(image)` in `core/io/canvas.ts` halves the image's scale until its long side is at most 512 px, then encodes it as JPEG at quality 0.9. The saved crop is multiplied by the same scale | Scaling by a power of two is exact in floating point, so the crop's aspect ratio stays the same and `gridSize` gives the same width and height |
| Include-image toggle | An "Include source image" checkbox next to "Save project", on by default. Without the image, the crop is saved in the original pixels | As the spec says. Without the image, the crop only matters for the grid size |
| Loading without the image | The puzzle, edits, verdict and title come back. The crop box is missing and the image controls stay disabled (they already depend on there being an image). The page shows: "This project has no source image, so the crop and image settings can't be changed. Hand edits still work." Suggestions and auto-fix stay off, because they need the image's gray values | "Shows that the source is unavailable for re-cropping", using the controls' existing disabled state |
| Validation | `parseProject(text)` checks everything before anything changes. Unknown version: "This project is version N; this app opens version 1." Anything else (bad JSON, a missing or mistyped field, a size or value out of range, row strings of the wrong length, edit indexes outside the grid, an image that isn't a `data:image/…` URL): "This isn't a valid project file (problem: settings.crop)." `Creator` then decodes the image and checks two more things: the crop lies inside the image, and `gridSize(crop, width)` matches the grid. Only then does it ask `confirmClear` and replace its state; a failure shows the same error | "Shows a clear error and changes nothing". The file comes from outside, so every field is checked |
| Open and save controls | "Save project" downloads `<title or "nonogram">.json`. "Open project" is a separate file input (`.json`). Loading resets undo history; a load that finishes after a newer image load is dropped (the existing `latest` counter) | Reuses the image loader's race guard and edit guard |

## Files

```
src/core/io/svg.ts                # renderSvg
src/core/io/svg.test.ts           # Node
src/core/io/canvas.ts             # svgToPng, toJpeg (browser)
src/core/io/canvas.browser.test.ts
src/core/io/project.ts            # Settings, Project, serializeProject, parseProject
src/core/io/project.test.ts       # Node
src/ui/Export.tsx                 # variant choice, SVG/PNG buttons, warning, download helper
src/ui/Creator.tsx                # title, loaded grid, save/open, no-source note
src/ui/Creator.browser.test.tsx   # export and project cases
```

## Steps

1. **`svg.ts`**, with Node tests.
2. **`canvas.ts`:** `svgToPng` and `toJpeg`, with browser tests.
3. **`project.ts`:** `Settings` moves here. `serializeProject(project)` writes JSON. `parseProject(text)` returns a `Project` or throws an `Error` with the user-facing message.
4. **`Export.tsx`** and `download(blob, name)`, used by both Export and Save.
5. **`Creator`:** title, `loaded` state, Save, Open, the error path and the no-source note.

## Tests

`svg.test.ts` (Node):

| Case | Expected |
| --- | --- |
| A 10x10 grid with known clues | Size and `viewBox` follow the clue areas and grid; clue texts appear in order; a `0` appears for an empty line |
| Bold lines | Black lines at 0, 5 and 10 cells on both axes; thin lines everywhere else |
| Blank vs solution | Blank has no filled-cell `<rect>`s; solution has exactly one per filled cell, at the right positions |

`canvas.browser.test.ts` (Chromium):

| Case | Expected |
| --- | --- |
| The SVG parses as XML without errors, and loads as an `<img>` | A non-zero `naturalWidth` |
| PNG at 1x, 2x and 4x | Size is the SVG size × scale. At every scale, the centre pixels of filled cells are pure black and of empty cells pure white, and each bold line covers whole pixels in pure black |
| `toJpeg` on a 2048 × 1000 image | 512 × 250 JPEG with a scale of ¼; on a 300 px image, scale 1 |

`project.test.ts` (Node):

| Case | Expected |
| --- | --- |
| Serialize, then parse | Gives back the same project, with Auto cutoff (`null`) and the image kept |
| Version 2 | The version message |
| Bad JSON; a missing field; a wrong type; width 51; a row of the wrong length; an edit index outside the grid; an image that isn't a data URL | The "isn't a valid project file" message, naming the field |

`Creator.browser.test.tsx` (downloads are captured by stubbing the anchor click and reading the blob URL):

| Case | Expected |
| --- | --- |
| Export SVG and PNG 2x | The files are named after the title and the SVG text matches `renderSvg`; no warning on a Valid puzzle |
| The ambiguous diagonal | The warning shows, and export still downloads a file |
| Edit some cells, set the cutoff and title, save, load another image, then open the project | The title, sliders and verdict text are the same as before saving, and the preview canvas is pixel-identical (edit markers included) |
| The same with "Include source image" off | Same preview and verdict; no crop box; the no-source note shows; the sliders are disabled |
| An auto-fixed puzzle | The purple markers come back after the round trip |
| A version-2 file, then a broken file | Each shows its error; the preview and settings are unchanged |

## Acceptance criteria → how each is verified

| Criterion | Verification |
| --- | --- |
| SVG opens in a browser and in a vector editor, with clues, grid, and bold lines every 5 cells | Node structure tests; Chromium parse and load test; render the exported file with ImageMagick (a renderer that isn't a browser) and look at it. Please also open one in Inkscape or Illustrator |
| PNG at each scale is sharp and matches the SVG | Pixel test at 1x, 2x and 4x |
| Save then load restores crop, settings, edits, title and verdict | Round-trip test with the pixel-identical preview |
| "Include source image" defaults on; off still restores the grid and shows the source is unavailable | Checkbox default is checked; no-image round-trip test |
| Unknown version or invalid structure → clear error, nothing changes | Node parse tests; Creator error test |
| A non-Valid verdict warns on export, and export still works | Diagonal test |

## Out of scope for M12

The title in the SVG; dropping a project file onto the page; keeping undo history in the project; re-encoding the embedded JPEG only when the image changed (each save re-encodes); `.non` or other formats.

## Risks

- **A grid rebuilt from the embedded JPEG may differ:** after a project with an image loads, the first setting change rebuilds the grid from the 512 px JPEG, which can flip a few cells near the cutoff compared with the original photo. The saved puzzle itself is always restored exactly.
- **4x PNG of a 50x50 with long clues** is a canvas of about 6,000 px square, roughly 150 MB while it is drawn. Chrome handles it, but a phone may not; 1x and 2x stay small.
- **Fonts differ** between browsers and editors. Clue slots leave room for two digits at any common sans-serif width.
