import type { RgbaImage } from '../image/types.ts';

/** Draws the SVG `scale` times its size; Chrome rasterises at the drawn size, so it stays sharp. */
export async function svgToPng(svg: string, scale: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The image as a JPEG data URL, halved until its long side is at most 512 px.
 * Halving keeps a scaled crop's aspect ratio exact in floating point.
 */
export function toJpeg(image: RgbaImage): { url: string; scale: number } {
  let scale = 1;
  while (Math.max(image.width, image.height) * scale > 512) scale /= 2;
  const full = document.createElement('canvas');
  full.width = image.width;
  full.height = image.height;
  full
    .getContext('2d')!
    .putImageData(
      new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height,
      ),
      0,
      0,
    );
  const small = document.createElement('canvas');
  // Rounded up, so a scaled crop never reaches past the edge.
  small.width = Math.ceil(image.width * scale);
  small.height = Math.ceil(image.height * scale);
  const context = small.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(full, 0, 0, small.width, small.height);
  return { url: small.toDataURL('image/jpeg', 0.9), scale };
}

/** Saves a blob through the browser's download prompt. */
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); // after the download starts
}
