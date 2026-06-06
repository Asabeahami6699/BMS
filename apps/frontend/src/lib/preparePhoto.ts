import { compressImageDataUrl, isDataUrlWithinLimit } from "./imageCompress";

export async function preparePhoto(dataUrl: string | undefined): Promise<string | undefined> {
  if (!dataUrl) {
    return undefined;
  }
  const compressed = await compressImageDataUrl(dataUrl);
  if (!isDataUrlWithinLimit(compressed)) {
    throw new Error("PHOTO_TOO_LARGE");
  }
  return compressed;
}
