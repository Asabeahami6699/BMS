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
