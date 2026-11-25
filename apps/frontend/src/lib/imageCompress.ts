/** Target max JPEG size after compression (bytes, approximate from data URL length). */
export const MAX_PHOTO_BYTES = 600 * 1024;
const MAX_WIDTH = 1280;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = dataUrl;
  });
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality);
}

function drawScaled(img: HTMLImageElement): HTMLCanvasElement {
  const scale = Math.min(1, MAX_WIDTH / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not process image");
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Resize and re-encode as JPEG so the payload stays small enough for API + storage. */
export async function compressImageDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = drawScaled(img);
  let quality = 0.82;
  let result = canvasToJpegDataUrl(canvas, quality);
  const maxChars = Math.ceil(MAX_PHOTO_BYTES * 1.37);
  while (result.length > maxChars && quality > 0.4) {
    quality -= 0.08;
    result = canvasToJpegDataUrl(canvas, quality);
  }
  return result;
}

export function isDataUrlWithinLimit(dataUrl: string): boolean {
  return dataUrl.length <= Math.ceil(MAX_PHOTO_BYTES * 1.37);
}

/**
 * Normalizes uploaded company logos into a clean square 512x512 PNG (preserving transparency)
 * so PWA install manifests, home-screen icons, favicons, and printed PDFs stay sharp.
 * Falls back to compressed JPEG only if the PNG exceeds the storage size cap.
 */
export async function compressCompanyLogoDataUrl(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return compressImageDataUrl(dataUrl);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size, size);
  const pad = Math.round(size * 0.04);
  const box = size - pad * 2;
  const scale = Math.min(box / Math.max(1, img.width), box / Math.max(1, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const x = Math.round((size - w) / 2);
  const y = Math.round((size - h) / 2);
  ctx.drawImage(img, x, y, w, h);

  const png = canvas.toDataURL("image/png");
  if (isDataUrlWithinLimit(png)) {
    return png;
  }

  // Try 384x384 PNG before falling back to JPEG so transparency is kept whenever possible.
  const smaller = document.createElement("canvas");
  smaller.width = 384;
  smaller.height = 384;
  const sctx = smaller.getContext("2d");
  if (sctx) {
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(canvas, 0, 0, 384, 384);
    const smallPng = smaller.toDataURL("image/png");
    if (isDataUrlWithinLimit(smallPng)) {
      return smallPng;
    }
  }

  return compressImageDataUrl(dataUrl);
}
