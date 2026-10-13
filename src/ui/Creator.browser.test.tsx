import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
