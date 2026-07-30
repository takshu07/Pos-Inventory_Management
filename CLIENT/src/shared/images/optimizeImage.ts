/**
 * Client-side image intake: validation + downscale/normalisation.
 *
 * Extracted from CategoryImageUpload so the product wizard's multi-image picker
 * shares one implementation — the format-normalisation rules below are subtle
 * (see PRESERVE_AS_IS and the non-web-native branch) and must not drift between
 * two copies.
 *
 * "Automatic optimization": oversized images are downscaled and re-encoded in
 * the browser BEFORE upload. Doing it client-side avoids adding a native image
 * pipeline (sharp) to the server, and means the large original never crosses
 * the network at all.
 */

export const MAX_DIMENSION = 1200;
export const MAX_BYTES = 10 * 1024 * 1024; // matches the server's multer limit

/**
 * ANY image type is accepted — an owner should never be blocked because their
 * product photo happens to be a BMP, AVIF, TIFF or a phone's HEIC. We check the
 * generic `image/*` prefix rather than an allow-list of subtypes.
 *
 * This is safe because of what happens next: optimizeImage() decodes the file
 * and re-encodes it as WebP through a canvas, so anything the browser can open
 * leaves here in a format every browser can display. Formats the browser cannot
 * decode fail that step and are reported to the user, rather than being
 * uploaded as an image nobody can view.
 *
 * Non-image files are still rejected — this is an image field, and the server
 * stores whatever it is handed.
 */
export function isImageFile(file: File): boolean {
  // Some browsers report an empty type for less common formats (e.g. HEIC on
  // certain platforms). Fall back to the extension so those still get a chance
  // to decode instead of being refused outright.
  if (file.type) return file.type.startsWith("image/");
  return /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|heic|heif|ico|svg)$/i.test(file.name);
}

/** Formats that must never be re-encoded, keyed by MIME type. */
const PRESERVE_AS_IS = new Set([
  "image/gif", // re-encoding would flatten the animation
  "image/svg+xml", // vector — rasterising it would destroy the scalability
]);

/**
 * A file that is ALREADY a safe, web-native format and small enough is returned
 * untouched — there is nothing to gain by re-encoding it.
 */
const WEB_NATIVE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Downscale to fit MAX_DIMENSION and re-encode as WebP.
 *
 * This does double duty: it shrinks large photos AND normalises unusual formats
 * (BMP, AVIF, TIFF, HEIC…) into WebP, which is what lets the picker accept any
 * image type without risking an upload nobody's browser can render.
 *
 * @throws if the browser cannot decode the file — callers must handle this and
 *   tell the user, rather than uploading an image that renders as broken.
 */
export async function optimizeImage(file: File): Promise<Blob> {
  if (PRESERVE_AS_IS.has(file.type)) return file;

  const bitmap = await createImageBitmap(file); // throws if undecodable — handled by the caller

  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

    // Already web-native, in-bounds and small: leave it alone.
    if (scale === 1 && WEB_NATIVE.has(file.type) && file.size < 400 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85)
    );

    if (!blob) return file;

    // For a non-web-native source, ALWAYS take the WebP even if it is larger —
    // a viewable-everywhere image beats a smaller one the browser won't render.
    if (!WEB_NATIVE.has(file.type)) return blob;

    // Otherwise this is purely a size optimisation: keep the smaller of the two.
    return blob.size < file.size ? blob : file;
  } finally {
    bitmap.close();
  }
}

/**
 * The upload filename must follow the ACTUAL bytes: the server derives the
 * stored file's extension from this name, so sending "photo.heic" for WebP data
 * would store an unopenable file.
 */
export function uploadFilename(original: File, optimized: Blob): string {
  return optimized === (original as Blob)
    ? original.name
    : original.name.replace(/\.[^.]+$/, "") + ".webp";
}
