import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { decodeImage } from '../core/image/decode.ts';
import { downscale, otsu, toGray } from '../core/image/pipeline.ts';
import { makePuzzle } from '../core/puzzle/clues.ts';
import type { Grid } from '../core/puzzle/types.ts';
import { solve } from '../core/solver/solve.ts';
import { autoFix } from '../core/repair/autofix.ts';
import { gridFromRows } from '../core/puzzle/grid.ts';
import { needsGuessing, randomGrid, wavesImage } from '../core/test-utils.ts';
import App from './App.tsx';

/** White PNG (200×100 by default) with rectangles ([x, y, width, height, gray = 0]). */
async function png(rects: number[][], width = 200, height = 100) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  for (const [x, y, w, h, v = 0] of rects) {
    ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
    ctx.fillRect(x!, y!, w!, h!);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new File([blob], 'test.png', { type: 'image/png' });
}

/** A black 100×60 rectangle whose edges fall on cell edges at width 20: line-solvable. */
const squareImage = () => png([[50, 20, 100, 60]]);

/** Top-left and bottom-right quarters black: at 20×10 every row is [10] and every column [5], which has two solutions. */
const diagonalImage = () =>
  png([
    [0, 0, 100, 50],
    [100, 50, 100, 50],
  ]);

/** A grid drawn as black 10 px blocks on white, so it downscales back to itself. */
async function gridImage({ width, height, cells }: Grid) {
  const rects: number[][] = [];
  cells.forEach((v, i) => {
    if (v) rects.push([(i % width) * 10, Math.floor(i / width) * 10, 10, 10]);
  });
  return png(rects, width * 10, height * 10);
}

/** RGBA at the center of grid cell (x, y), counted from the bottom-right corner so clue areas don't matter. */
function cellPixel(x: number, y: number, width: number, height: number) {
  const canvas =
    document.querySelector<HTMLCanvasElement>('canvas[role="img"]')!;
  const dpr = window.devicePixelRatio;
  const cell = 32 * dpr; // the container is wide enough for the 32 px maximum
  const right = canvas.width - dpr;
  const bottom = canvas.height - dpr;
  const px = Math.round(right - (width - x - 0.5) * cell);
  const py = Math.round(bottom - (height - y - 0.5) * cell);
  return Array.from(canvas.getContext('2d')!.getImageData(px, py, 1, 1).data);
}

const cellColor = (x: number, y: number, width: number, height: number) =>
  cellPixel(x, y, width, height)[0];
const verdict = (text: RegExp) => page.getByText(text);

const preview = (width: number, height: number) =>
  page.getByRole('img', { name: `Puzzle preview, ${width} by ${height}` });
const cutoffSlider = () => page.getByRole('slider', { name: /Cutoff/ });

const widthSlider = () => page.getByRole('slider', { name: /Width/ });

/** Presses a key on an element: focus it, then type. */
async function press(locator: { element(): Element }, keys: string) {
  (locator.element() as HTMLElement).focus();
  await userEvent.keyboard(keys);
}

/**
 * Drags a crop handle (or the box, for null) by (dx, dy) screen pixels.
 * Returns a function that releases the pointer, so a test can check mid-drag.
 */
function drag(corner: string | null, dx: number, dy: number) {
  const target = corner
    ? document.querySelector(`[data-corner="${corner}"]`)!
    : document.querySelector('.crop-box')!;
  const box = target.getBoundingClientRect();
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  const init = { bubbles: true, pointerId: 1, isPrimary: true };
  target.dispatchEvent(
    new PointerEvent('pointerdown', { ...init, clientX: x, clientY: y }),
  );
  window.dispatchEvent(
    new PointerEvent('pointermove', {
      ...init,
      clientX: x + dx,
      clientY: y + dy,
    }),
  );
  return () =>
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        ...init,
        clientX: x + dx,
        clientY: y + dy,
      }),
    );
}

/** Screen point at the center of grid cell (x, y) of a width × height grid (32 px cells). */
function cellPoint(x: number, y: number, width: number, height: number) {
  const rect = document
    .querySelector('canvas[role="img"]')!
    .getBoundingClientRect();
  return {
    clientX: rect.right - 1 - (width - x - 0.5) * 32,
    clientY: rect.bottom - 1 - (height - y - 0.5) * 32,
  };
}

/** Presses on the first cell, moves through the rest, and releases ([x, y] on the 20×10 grid). */
function stroke(...cells: [number, number][]) {
  const init = { bubbles: true, pointerId: 1, isPrimary: true };
  const [first, ...rest] = cells.map(([x, y]) => cellPoint(x, y, 20, 10));
  document
    .querySelector('canvas[role="img"]')!
    .dispatchEvent(new PointerEvent('pointerdown', { ...init, ...first }));
  for (const point of rest) {
    window.dispatchEvent(
      new PointerEvent('pointermove', { ...init, ...point }),
    );
  }
  window.dispatchEvent(new PointerEvent('pointerup', init));
}

/** Red channel near a cell's top-left corner, clear of the edit marker in its center. */
const fill = (x: number, y: number) => cellColor(x - 0.3, y, 20, 10);
const BLUE = [26, 115, 232, 255];

/** The ambiguous diagonal plus a gray (100) patch at cells (14, 2)–(15, 3): a cutoff above 100 fills it, which breaks the tie. */
const patchedImage = () =>
  png([
    [0, 0, 100, 50],
    [100, 50, 100, 50],
    [140, 20, 20, 20, 100],
  ]);

/** Sets a range input the way a drag would, so React sees one change. */
function setSlider(locator: { element(): Element }, value: number) {
  const input = locator.element() as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )!.set!;
  set.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const scanning = () => page.getByText(/Looking for nearby settings/);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  container.style.width = '2000px';
  document.body.append(container);
  root = createRoot(container);
  root.render(<App />);
});

afterEach(() => {
  vi.restoreAllMocks();
  root.unmount();
  container.remove();
});

const upload = async (file: File) =>
  userEvent.upload(page.getByLabelText(/Image/), file);

describe('Creator', () => {
  it('shows a preview within 1 second of choosing an image', async () => {
    const start = performance.now();
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('resizes the grid when the width slider moves', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    page.getByRole('slider', { name: /Width/ }).element().focus();
    await userEvent.keyboard('{End}');
    await expect.element(preview(50, 25)).toBeVisible();
  });

  it('starts the cutoff at the Otsu value and Auto restores it', async () => {
    const file = await squareImage();
    const gray = toGray(await decodeImage(file));
    const expected = otsu(
      downscale(gray, { x: 0, y: 0, width: 200, height: 100 }, 20, 10),
    );
    await upload(file);
    await expect.element(cutoffSlider()).toHaveValue(String(expected));

    cutoffSlider().element().focus();
    await userEvent.keyboard('{Home}');
    await expect.element(cutoffSlider()).toHaveValue('0');
    await page.getByRole('button', { name: 'Auto' }).click();
    await expect.element(cutoffSlider()).toHaveValue(String(expected));
  });

  it('swaps filled and empty cells when Invert is on', async () => {
    await upload(await squareImage());
    // Polls both cells together: the first frame may still use the pre-measure cell size.
    const cells = () => [cellColor(10, 5, 20, 10), cellColor(2, 5, 20, 10)];
    await expect.poll(cells).toEqual([0, 255]);

    await page.getByRole('checkbox', { name: 'Invert' }).click();
    await expect.poll(cells).toEqual([255, 0]);
  });

  it('warns when nearly all cells are empty', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    cutoffSlider().element().focus();
    await userEvent.keyboard('{Home}');
    await expect
      .element(page.getByText(/Nearly all cells are empty/))
      .toBeVisible();
  });

  it('suggests JPEG or PNG for a file it cannot read', async () => {
    await upload(new File(['not an image'], 'photo.heic'));
    await expect.element(page.getByText(/Try a JPEG or PNG/)).toBeVisible();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('shows Valid for a line-solvable image', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    await expect.element(verdict(/^Valid/)).toBeVisible();
    expect(cellPixel(2, 5, 20, 10)).toEqual([255, 255, 255, 255]);
    expect(verdict(/Checking further/).query()).toBeNull();
  });

  it('shows Ambiguous and tints the cells that differ', async () => {
    await upload(await diagonalImage());
    await expect
      .element(verdict(/^Ambiguous — 200 cells differ in a second solution/))
      .toBeVisible();
    // Red over white, not plain white or black. Polled: the canvas redraws in an effect after the text updates.
    await expect
      .poll(() => {
        const [r, g, b] = cellPixel(15, 2, 20, 10);
        return r! > 200 && g! < 170 && b === g;
      })
      .toBe(true);
  });

  it('shows Needs guessing for a unique puzzle the line solver can’t finish', async () => {
    await upload(await gridImage(needsGuessing));
    await page.getByRole('button', { name: '10', exact: true }).click();
    await expect
      .element(
        verdict(/^Needs guessing — unique, but 75 cells need trial and error/),
      )
      .toBeVisible();
    // Amber over an undetermined cell.
    const cell = solve(makePuzzle(needsGuessing)).undetermined[0]!;
    await expect
      .poll(() => {
        const [r, g, b] = cellPixel(cell % 10, Math.floor(cell / 10), 10, 10);
        return r! > g! && g! > b!;
      })
      .toBe(true);
  });

  it('cancels a running deep check when a setting changes', async () => {
    await upload(await gridImage(randomGrid(30, 30, 1, 0.5)));
    await page.getByRole('button', { name: '30', exact: true }).click();
    await expect.element(verdict(/Checking further…/)).toBeVisible();
    const start = performance.now();
    await press(widthSlider(), '{Home}');
    await expect.element(preview(5, 5)).toBeVisible();
    // The old search would hold the worker for up to 3 seconds.
    await expect
      .element(verdict(/^(Valid|Not|Needs|Ambiguous|Inconclusive)/))
      .toBeVisible();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('re-checks after a slider change within the time budget', async () => {
    await upload(await squareImage());
    await expect.element(verdict(/^Valid/)).toBeVisible();
    page.getByRole('slider', { name: /Width/ }).element().focus();
    await userEvent.keyboard('{End}');
    const start = performance.now();
    await expect.element(verdict(/^Checking…/)).toBeVisible();
    await expect.element(verdict(/^Valid/)).toBeVisible();
    expect(performance.now() - start).toBeLessThan(600);
    await expect.element(preview(50, 25)).toBeVisible();
  });

  it('lowers the width maximum for a tall crop', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    const release = drag('nw', 500, 0); // shrinks to the 10 px minimum width
    // Checked before release: the preview follows the drag live.
    await expect.element(preview(5, 50)).toBeVisible();
    release();
    await expect.element(widthSlider()).toHaveAttribute('max', '5');
    await expect.element(page.getByText('Width 5 (height 50)')).toBeVisible();
  });

  it('keeps the height at least 5 for a wide crop', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    drag('se', 0, -500)();
    await expect.element(page.getByText(/Crop 200 × 10 px/)).toBeVisible();
    await expect.element(preview(20, 5)).toBeVisible();
  });

  it('moves the crop when the box is dragged', async () => {
    await upload(await squareImage());
    await page.getByRole('checkbox', { name: 'Lock to square' }).click();
    await expect.element(preview(20, 20)).toBeVisible();
    // Crop 50–150 covers the black rectangle edge to edge, so row 10 is all black.
    await expect.poll(() => cellColor(2, 10, 20, 20)).toBe(0);
    const release = drag(null, -50, 0);
    await expect.element(page.getByText(/at \(0, 0\)/)).toBeVisible();
    // Now the left half of the crop is white margin.
    await expect.poll(() => cellColor(2, 10, 20, 20)).toBe(255);
    release();
  });

  it('moves and resizes the crop with the keyboard', async () => {
    await upload(await squareImage());
    await page.getByRole('checkbox', { name: 'Lock to square' }).click();
    const box = page.getByRole('group', { name: /Crop area/ });
    await press(box, '{ArrowRight}');
    await expect
      .element(page.getByText(/Crop 100 × 100 px at \(52, 0\)/))
      .toBeVisible();
    await press(box, '{Shift>}{ArrowLeft}{/Shift}');
    await expect
      .element(page.getByText(/Crop 98 × 98 px at \(52, 0\)/))
      .toBeVisible();
  });

  it('keeps the crop square while locked', async () => {
    await upload(await squareImage());
    await page.getByRole('checkbox', { name: 'Lock to square' }).click();
    await expect.element(preview(20, 20)).toBeVisible();
    drag('se', -30, -10)();
    await expect.element(page.getByText(/Crop 70 × 70 px/)).toBeVisible();
    await expect.element(preview(20, 20)).toBeVisible();
  });

  it('applies a preset size and locks to square', async () => {
    await upload(await squareImage());
    await page.getByRole('button', { name: '30', exact: true }).click();
    await expect.element(preview(30, 30)).toBeVisible();
    await expect
      .element(page.getByRole('checkbox', { name: 'Lock to square' }))
      .toBeChecked();
  });

  it('changes the grid with brightness', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    // −100 maps white to 127, below the Auto cutoff of 128: every cell fills.
    await press(page.getByRole('slider', { name: /Brightness/ }), '{Home}');
    await expect
      .element(page.getByText(/Nearly all cells are filled/))
      .toBeVisible();
  });

  it('changes the grid with contrast', async () => {
    await upload(await squareImage());
    await expect.element(preview(20, 10)).toBeVisible();
    // −100 flattens every cell to 128, so the grid is uniform.
    await press(page.getByRole('slider', { name: /Contrast/ }), '{Home}');
    await expect.element(page.getByText(/Nearly all cells are/)).toBeVisible();
  });

  it('draws the crop box to scale over a scaled-down image', async () => {
    await upload(await png([], 1600, 1000));
    await page.getByRole('checkbox', { name: 'Lock to square' }).click();
    await expect.element(page.getByText(/Crop 1000 × 1000 px/)).toBeVisible();
    const box = document.querySelector('.crop-box')!.getBoundingClientRect();
    const image = document
      .querySelector('.crop canvas')!
      .getBoundingClientRect();
    expect(image.width).toBe(480);
    expect(box.width).toBeCloseTo(box.height, 0);
    expect(box.width).toBeCloseTo(300, 0);
  });

  describe('editing', () => {
    /** The square image, once the preview is drawn at its final cell size. */
    async function ready() {
      await upload(await squareImage());
      await expect.poll(() => [fill(10, 5), fill(2, 5)]).toEqual([0, 255]);
    }

    it('toggles a clicked cell, marks it and re-checks', async () => {
      await ready();
      await expect.element(verdict(/^Valid/)).toBeVisible();
      stroke([2, 0]);
      await expect.poll(() => fill(2, 0)).toBe(0);
      expect(cellPixel(2, 0, 20, 10)).toEqual(BLUE);
      await expect.element(verdict(/^Checking…/)).toBeVisible();
      await expect.element(verdict(/^(Valid|Not line-solvable)/)).toBeVisible();
    });

    it('paints every crossed cell with the first cell’s new value', async () => {
      await ready();
      stroke([0, 0], [4, 0], [6, 0]); // the first move skips three cells
      await expect
        .poll(() => [0, 1, 2, 3, 4, 5, 6, 7].map((x) => fill(x, 0)))
        .toEqual([0, 0, 0, 0, 0, 0, 0, 255]);

      // Starting on a filled cell clears, even over cells that were already empty.
      stroke([5, 5], [0, 5]);
      await expect
        .poll(() => [0, 2, 4, 5, 6].map((x) => fill(x, 5)))
        .toEqual([255, 255, 255, 255, 0]);
    });

    it('keeps edits through cutoff, brightness, contrast and Invert', async () => {
      await ready();
      stroke([2, 0]); // filled by hand
      stroke([10, 5]); // cleared by hand
      const edited = () => [fill(2, 0), fill(10, 5)];
      await expect.poll(edited).toEqual([0, 255]);

      await press(cutoffSlider(), '{Home}'); // nothing else filled
      await expect
        .poll(() => [...edited(), fill(11, 5)])
        .toEqual([0, 255, 255]);
      await page.getByRole('button', { name: 'Auto' }).click();
      await press(page.getByRole('slider', { name: /Brightness/ }), '{Home}');
      await expect.poll(() => [...edited(), fill(3, 0)]).toEqual([0, 255, 0]);
      await press(page.getByRole('slider', { name: /Contrast/ }), '{Home}');
      await expect.poll(edited).toEqual([0, 255]);
      await press(page.getByRole('slider', { name: /Brightness/ }), '{End}');
      await press(page.getByRole('slider', { name: /Contrast/ }), '{Home}');
      await page.getByRole('checkbox', { name: 'Invert' }).click();
      await expect.poll(edited).toEqual([0, 255]);
    });

    it('undoes and redoes whole strokes', async () => {
      await ready();
      stroke([2, 0]);
      stroke([0, 1], [3, 1]);
      const cells = () => [fill(2, 0), fill(0, 1), fill(3, 1)];
      await expect.poll(cells).toEqual([0, 0, 0]);

      await userEvent.keyboard('{Control>}z{/Control}');
      await expect.poll(cells).toEqual([0, 255, 255]);
      await userEvent.keyboard('{Control>}z{/Control}');
      await expect.poll(cells).toEqual([255, 255, 255]);
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeDisabled();
      await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
      await expect.poll(cells).toEqual([0, 255, 255]);
      await page.getByRole('button', { name: 'Redo' }).click();
      await expect.poll(cells).toEqual([0, 0, 0]);
    });

    it('asks before a width change clears the edits', async () => {
      await ready();
      stroke([2, 0]);
      await expect.poll(() => fill(2, 0)).toBe(0);
      const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await press(widthSlider(), '{End}');
      expect(ask).toHaveBeenCalledWith(
        'This clears your 1 edited cell. Continue?',
      );
      await expect.element(preview(20, 10)).toBeVisible();
      expect(cellPixel(2, 0, 20, 10)).toEqual(BLUE);

      ask.mockReturnValue(true);
      await press(widthSlider(), '{End}');
      await expect.element(preview(50, 25)).toBeVisible();
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeDisabled();
    });

    it('asks before a crop drag and starts on the next drag', async () => {
      await upload(await squareImage());
      await page.getByRole('checkbox', { name: 'Lock to square' }).click();
      await expect.element(preview(20, 20)).toBeVisible();
      await expect.poll(() => cellColor(2, 10, 20, 20)).toBe(0);
      const rect = cellPoint(2, 2, 20, 20);
      const init = { bubbles: true, pointerId: 1, isPrimary: true, ...rect };
      document
        .querySelector('canvas[role="img"]')!
        .dispatchEvent(new PointerEvent('pointerdown', init));
      window.dispatchEvent(new PointerEvent('pointerup', init));
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeEnabled();
      const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);

      drag(null, -50, 0)();
      expect(ask).toHaveBeenCalledOnce();
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeDisabled();
      expect(page.getByText(/at \(50, 0\)/).query()).not.toBeNull();

      drag(null, -50, 0)();
      await expect.element(page.getByText(/at \(0, 0\)/)).toBeVisible();
      expect(ask).toHaveBeenCalledOnce();
    });

    it('edits from the keyboard', async () => {
      await ready();
      const grid = page.getByRole('img', { name: /Puzzle preview/ });
      await press(grid, ' ');
      await expect.poll(() => fill(0, 0)).toBe(0);
      await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}');
      await expect.poll(() => fill(1, 1)).toBe(0);
    });

    it('re-checks an ambiguous puzzle after an edit', async () => {
      await upload(await diagonalImage());
      await expect.element(verdict(/^Ambiguous — 200 cells/)).toBeVisible();
      await expect.poll(() => fill(15, 2)).not.toBe(0);
      // Clearing column 0 gives it the clue 0, which the line solver can use.
      stroke([0, 0], [0, 9]);
      await expect
        .poll(() => document.querySelector('.verdict')!.textContent)
        .toMatch(
          /^(Valid|Needs guessing|Inconclusive|Ambiguous — (?!200 )\d+)/,
        );
    });
  });

  describe('suggestions', () => {
    /** The patched image at cutoff 90, which leaves the patch empty: ambiguous. */
    async function failing() {
      await upload(await patchedImage());
      await expect.element(verdict(/^Valid/)).toBeVisible(); // Auto (178) fills the patch
      setSlider(cutoffSlider(), 90);
      await expect.element(verdict(/^Ambiguous/)).toBeVisible();
    }

    it('shows no panel for a Valid puzzle', async () => {
      await upload(await squareImage());
      await expect.element(verdict(/^Valid/)).toBeVisible();
      await new Promise((done) => setTimeout(done, 700));
      expect(scanning().query()).toBeNull();
    });

    it('offers nearby settings that pass, applied in one click', async () => {
      await failing();
      await expect.element(scanning()).toBeVisible();
      const first = page.getByRole('button', { name: 'Cutoff 102, width 20' });
      await first.click();
      await expect.element(verdict(/^Valid/)).toBeVisible();
      await expect.element(cutoffSlider()).toHaveValue('102');
      expect(scanning().query()).toBeNull();
    });

    it('asks before a suggestion clears edits', async () => {
      await failing();
      // Starts on a filled cell, so it clears: including the patch cells, which
      // takes away every passing cutoff at width 20.
      stroke([9, 4], [14, 3], [14, 2], [15, 2], [15, 3]);
      const other = page
        .getByRole('button', { name: /clears your edits/ })
        .first();
      await expect.element(other).toBeVisible();
      const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await other.click();
      expect(ask).toHaveBeenCalledOnce();
      await expect.element(preview(20, 10)).toBeVisible();
      await expect.element(cutoffSlider()).toHaveValue('90');
    });

    it('says so when nothing nearby passes', async () => {
      await upload(await diagonalImage());
      await expect
        .element(page.getByText(/No nearby settings pass\. Try auto-fix/))
        .toBeVisible();
    });

    it('can be cancelled and restarts when settings change', async () => {
      await failing();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect.element(page.getByText('Search cancelled.')).toBeVisible();
      setSlider(cutoffSlider(), 88);
      await expect
        .element(page.getByRole('button', { name: 'Cutoff 102, width 20' }))
        .toBeVisible();
    });
  });

  describe('auto-fix', () => {
    const PURPLE = [147, 52, 230, 255];
    const autoFixButton = () => page.getByRole('button', { name: 'Auto-fix' });
    /** The cell auto-fix flips on the diagonal image, computed the same way in Node. */
    const diagonalGrid = gridFromRows(
      Array.from({ length: 10 }, (_, y) =>
        y < 5
          ? '1'.repeat(10) + '0'.repeat(10)
          : '0'.repeat(10) + '1'.repeat(10),
      ),
    );
    const [flip] = autoFix({
      grid: diagonalGrid,
      values: Float32Array.from(diagonalGrid.cells, (v) => (v ? 0 : 255)),
      cutoff: 128,
      locked: [],
    }).flips;
    const flipPixel = () =>
      cellPixel(flip! % 20, Math.floor(flip! / 20), 20, 10);

    async function fixDiagonal() {
      await upload(await diagonalImage());
      await autoFixButton().click();
      await expect.element(verdict(/^Valid/)).toBeVisible();
      await expect
        .element(page.getByText('Auto-fix flipped 1 cell.'))
        .toBeVisible();
      await expect.poll(flipPixel).toEqual(PURPLE);
    }

    it('fixes an ambiguous puzzle and marks the flipped cell', async () => {
      await fixDiagonal();
    });

    it('reverts one flipped cell with a click', async () => {
      await fixDiagonal();
      stroke([flip! % 20, Math.floor(flip! / 20)]);
      await expect.element(verdict(/^Ambiguous/)).toBeVisible();
      await expect.poll(() => flipPixel()).not.toEqual(PURPLE);
      // Reverted, not hand-edited: no marker of either colour.
      expect(cellPixel(flip! % 20, Math.floor(flip! / 20), 20, 10)).not.toEqual(
        BLUE,
      );
    });

    it('undoes and redoes the whole fix in one step', async () => {
      await fixDiagonal();
      await userEvent.keyboard('{Control>}z{/Control}');
      await expect.element(verdict(/^Ambiguous/)).toBeVisible();
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeDisabled();
      await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
      await expect.element(verdict(/^Valid/)).toBeVisible();
      await expect.poll(flipPixel).toEqual(PURPLE);
    });

    it('can be cancelled, leaving the grid unchanged', async () => {
      await upload(await gridImage(randomGrid(30, 30, 1, 0.5))); // about 14 s of fixing
      await page.getByRole('button', { name: '30', exact: true }).click();
      await autoFixButton().click();
      await expect.element(page.getByText(/^Auto-fixing…/)).toBeVisible();
      await page.getByRole('button', { name: 'Cancel auto-fix' }).click();
      await expect.element(autoFixButton()).toBeVisible();
      expect(page.getByText(/Auto-fix flipped/).query()).toBeNull();
      await expect
        .element(page.getByRole('button', { name: 'Undo' }))
        .toBeDisabled();
    });

    it('reports when no single flip helps', async () => {
      const { width, height, data } = wavesImage();
      const canvas = new OffscreenCanvas(width, height);
      const rgba = new Uint8ClampedArray(width * height * 4);
      data.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
      canvas.getContext('2d')!.putImageData(new ImageData(rgba, width), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await upload(new File([blob], 'waves.png', { type: 'image/png' }));
      await page.getByRole('button', { name: '30', exact: true }).click();
      setSlider(cutoffSlider(), 128);
      await expect.element(verdict(/900 cells/)).toBeVisible();
      await autoFixButton().click();
      await expect
        .element(
          page.getByText(
            'Auto-fix flipped 0 cells; 900 cells are still undetermined. No single flip helps any more.',
          ),
        )
        .toBeVisible();
    });
  });
});
