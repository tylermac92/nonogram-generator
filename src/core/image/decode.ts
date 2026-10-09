import type { RgbaImage } from './types.ts';

const MAX_SIDE = 2048;

/**
 * Decodes any image the browser supports, upright (EXIF orientation applied)
 * and at most 2048 px on the long side. Rejects if the browser can't decode it.
 */
export async function decodeImage(file: Blob): Promise<RgbaImage> {
  let bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  try {
    const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
    if (scale < 1) {
      const original = bitmap;
      bitmap = await createImageBitmap(original, {
        resizeWidth: Math.round(original.width * scale),
        resizeHeight: Math.round(original.height * scale),
        resizeQuality: 'high',
      });
      original.close();
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { width, height, data } = context.getImageData(
      0,
      0,
      bitmap.width,
      bitmap.height,
    );
    return { width, height, data };
  } finally {
    bitmap.close();
  }
}
