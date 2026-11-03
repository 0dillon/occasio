import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { productRules } from "@/config/product-rules";
import { sha256 } from "@/lib/security";

/**
 * Private object storage behind three functions. Objects are never public;
 * they're served only through an authorized route.
 * - STORAGE_DRIVER=s3: any S3-compatible private bucket (Neon object storage
 *   in production), configured with OBJECT_STORAGE_* variables. Dedicated
 *   names avoid clashing with ambient AWS_* credentials on the host.
 * - default "disk": local development, outside public/.
 */
function checkKey(key: string) {
  if (!/^[a-z0-9/_-]+\.(jpg|png|webp|txt)$/.test(key)) throw new Error("invalid object key");
  return key;
}
function pathFor(key: string) {
  return join(/* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./storage"), checkKey(key));
}

let client: S3Client | undefined;
function s3() {
  const e = process.env;
  if (!e.OBJECT_STORAGE_ENDPOINT || !e.OBJECT_STORAGE_ACCESS_KEY_ID || !e.OBJECT_STORAGE_SECRET_ACCESS_KEY || !e.OBJECT_STORAGE_BUCKET) {
    throw new Error("STORAGE_DRIVER=s3 needs OBJECT_STORAGE_ENDPOINT, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY and _BUCKET");
  }
  client ??= new S3Client({
    endpoint: e.OBJECT_STORAGE_ENDPOINT,
    region: e.OBJECT_STORAGE_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: e.OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey: e.OBJECT_STORAGE_SECRET_ACCESS_KEY },
  });
  return { client, bucket: e.OBJECT_STORAGE_BUCKET };
}
const useS3 = () => process.env.STORAGE_DRIVER === "s3";

export async function putObject(key: string, data: Buffer, contentType = "image/jpeg") {
  if (useS3()) {
    const { client, bucket } = s3();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: checkKey(key), Body: data, ContentType: contentType }));
    return;
  }
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data, { mode: 0o600 });
}

export async function getObject(key: string): Promise<Buffer> {
  if (useS3()) {
    const { client, bucket } = s3();
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: checkKey(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(/* turbopackIgnore: true */ pathFor(key));
}

export async function deleteObject(key: string) {
  if (useS3()) {
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: checkKey(key) }));
    return;
  }
  await rm(pathFor(key), { force: true });
}

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
