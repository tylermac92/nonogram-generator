import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { decodeImage } from '../core/image/decode.ts';
import { downscale, otsu, toGray } from '../core/image/pipeline.ts';
import App from './App.tsx';

/** 200×100 white PNG with a black 100×60 rectangle whose edges fall on cell edges at width 20. */
async function squareImage() {
  const canvas = new OffscreenCanvas(200, 100);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = '#000';
  ctx.fillRect(50, 20, 100, 60);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new File([blob], 'square.png', { type: 'image/png' });
}

/** Red channel at the center of grid cell (x, y), counted from the bottom-right corner so clue areas don't matter. */
function cellColor(x: number, y: number, width: number, height: number) {
  const canvas = document.querySelector('canvas')!;
  const dpr = window.devicePixelRatio;
  const cell = 32 * dpr; // the container is wide enough for the 32 px maximum
  const right = canvas.width - dpr;
  const bottom = canvas.height - dpr;
  const px = Math.round(right - (width - x - 0.5) * cell);
  const py = Math.round(bottom - (height - y - 0.5) * cell);
  return canvas.getContext('2d')!.getImageData(px, py, 1, 1).data[0];
}

const preview = (width: number, height: number) =>
  page.getByRole('img', { name: `Puzzle preview, ${width} by ${height}` });
const cutoffSlider = () => page.getByRole('slider', { name: /Cutoff/ });

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
});
