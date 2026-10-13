import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { decodeImage } from '../core/image/decode.ts';
import { downscale, otsu, toGray } from '../core/image/pipeline.ts';
import App from './App.tsx';

/** White PNG (200×100 by default) with black rectangles ([x, y, width, height]). */
async function png(rects: number[][], width = 200, height = 100) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  for (const [x, y, w, h] of rects) ctx.fillRect(x!, y!, w!, h!);
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
  });

  it('tints undetermined cells and counts them', async () => {
    await upload(await diagonalImage());
    await expect
      .element(verdict(/Not line-solvable — 200 cells undetermined/))
      .toBeVisible();
    // Amber over white, not plain white or black.
    const [r, g, b] = cellPixel(15, 2, 20, 10);
    expect(r).toBe(255);
    expect(g).toBeGreaterThan(150);
    expect(g).toBeLessThan(240);
    expect(b).toBeLessThan(150);
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
      await expect.element(verdict(/200 cells undetermined/)).toBeVisible();
      await expect.poll(() => fill(15, 2)).not.toBe(0);
      // Clearing column 0 gives it the clue 0, which the line solver can use.
      stroke([0, 0], [0, 9]);
      await expect
        .poll(() => document.querySelector('.verdict')!.textContent)
        .toMatch(/^(Valid|Not line-solvable — (?!200 )\d+ cells)/);
    });
  });
});
