import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { productRules } from "@/config/product-rules";
import { sha256 } from "@/lib/security";

/**
 * Private object storage — development adapter (local disk outside public/).
 * Production should use a private bucket (e.g. Supabase Storage) behind the
 * same three functions. Objects are only served through an authorized route.
 */
function root() {
  return resolve(process.env.STORAGE_DIR ?? "./storage");
}
function pathFor(key: string) {
  if (!/^[a-z0-9/_-]+\.(jpg|png|webp)$/.test(key)) throw new Error("invalid object key");
  return join(root(), key);
}

export async function putObject(key: string, data: Buffer) {
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data, { mode: 0o600 });
}
export const getObject = (key: string) => readFile(pathFor(key));
export const deleteObject = (key: string) => rm(pathFor(key), { force: true });

export class UploadRejected extends Error {}

/**
 * Validates an uploaded poster by decoding it (not by trusting the declared
 * MIME type or extension), caps pixels, applies orientation, strips all
 * metadata (EXIF/GPS) and re-encodes. SVG/HTML/anything else is rejected.
 */
export async function processPoster(input: Buffer) {
  if (input.length === 0) throw new UploadRejected("The file is empty.");
  if (input.length > productRules.proposed.maxUploadBytes) throw new UploadRejected("Images must be 8 MB or smaller.");
  const magic = input.subarray(0, 12);
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff;
  const isPng = magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = magic.subarray(0, 4).toString() === "RIFF" && magic.subarray(8, 12).toString() === "WEBP";
  if (!isJpeg && !isPng && !isWebp) throw new UploadRejected("Upload a PNG, JPG or WebP image.");
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: productRules.proposed.maxImagePixels }).metadata();
  } catch {
    throw new UploadRejected("We couldn't read that image. Try a different file.");
  }
  if (!meta.width || !meta.height || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
    throw new UploadRejected("Upload a PNG, JPG or WebP image.");
  }
  // Re-encode: rotate per EXIF, bound the size, drop all metadata.
  const out = await sharp(input, { limitInputPixels: productRules.proposed.maxImagePixels })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    data: out.data, mime: "image/jpeg" as const, width: out.info.width, height: out.info.height,
    bytes: out.data.length, sha256: sha256(out.data),
  };
}
