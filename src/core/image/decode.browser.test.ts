import { describe, expect, it } from 'vitest';
import { decodeImage } from './decode.ts';
import rotatedUrl from './fixtures/exif-rotated.jpg?url';
import transparentUrl from './fixtures/transparent.png?url';
import { downscale, otsu, threshold, toGray } from './pipeline.ts';

const load = async (url: string) => (await fetch(url)).blob();

describe('decodeImage', () => {
  it('applies EXIF orientation so a rotated photo comes out upright', async () => {
    const image = toGray(await decodeImage(await load(rotatedUrl)));
    expect([image.width, image.height]).toEqual([20, 40]);
    const values = downscale(
      image,
      { x: 0, y: 0, width: 20, height: 40 },
      2,
      4,
    );
    const grid = threshold(values, 2, 4, otsu(values), false);
    expect(Array.from(grid.cells)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
  });

  it('converts a transparent PNG as if placed on white', async () => {
    const image = toGray(await decodeImage(await load(transparentUrl)));
    const at = (x: number, y: number) => image.data[y * image.width + x];
    expect([at(0, 0), at(19, 0), at(0, 19), at(19, 19)]).toEqual([
      255, 255, 255, 255,
    ]);
    expect(at(10, 10)).toBeLessThan(10);
  });

  it('caps the long side at 2048 px', async () => {
    const canvas = new OffscreenCanvas(3000, 1000);
    canvas.getContext('2d')!.fillRect(0, 0, 3000, 1000);
    const image = await decodeImage(
      await canvas.convertToBlob({ type: 'image/png' }),
    );
    expect([image.width, image.height]).toEqual([2048, 683]);
  });

  it('rejects data that is not an image', async () => {
    await expect(decodeImage(new Blob(['not an image']))).rejects.toThrow();
  });
});
