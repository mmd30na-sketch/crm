/** Client-side checks of a national-card photo before it is sent to OCR. Warn only; never blocks. */

export interface CardImageQuality {
  width: number;
  height: number;
  /** Variance of the Laplacian on a grayscale copy normalized to a fixed size (higher = sharper). */
  sharpness: number;
  lowResolution: boolean;
  blurry: boolean;
  /** Portrait photo although a landscape card is expected. */
  portrait: boolean;
}

export const MIN_LONG_SIDE = 600;
export const MIN_SHARPNESS = 20;
const SHARPNESS_LONG_SIDE = 800;

function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function laplacianVariance(data: Uint8ClampedArray, w: number, h: number): number {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += l; sumSq += l * l; n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Returns null when the image cannot be decoded or analysed (the caller then just continues). */
export async function analyzeCardImage(file: File): Promise<CardImageQuality | null> {
  try {
    const img = await loadImage(file);
    if (!img) return null;
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const long = Math.max(width, height);
    // Normalize to the same size so small-but-sharp photos are not penalized.
    const scale = SHARPNESS_LONG_SIDE / long;
    const cw = Math.max(8, Math.round(width * scale));
    const ch = Math.max(8, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    const sharpness = laplacianVariance(ctx.getImageData(0, 0, cw, ch).data, cw, ch);
    return {
      width, height, sharpness,
      lowResolution: long < MIN_LONG_SIDE,
      blurry: sharpness < MIN_SHARPNESS,
      portrait: height > width * 1.1,
    };
  } catch {
    return null;
  }
}

/** Rotate the photo 90 degrees clockwise (a portrait phone photo of a landscape card). */
export async function rotateImage90(file: File): Promise<File> {
  const img = await loadImage(file);
  if (!img) return file;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalHeight; canvas.height = img.naturalWidth;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.translate(canvas.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '_rot.jpg', { type: 'image/jpeg' }) : file;
}
