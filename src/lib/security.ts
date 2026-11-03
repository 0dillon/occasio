import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY = "scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, PARAMS);
  return ["scrypt", salt.toString("base64"), key.toString("base64")].join(":");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do comparable work, even for unknown accounts, to avoid timing leaks.
  const [, saltB64, keyB64] = (stored ?? DUMMY).split(":");
  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(keyB64 ?? "", "base64");
  const key = await scrypt(password.normalize("NFKC"), salt, 32, PARAMS);
  return stored !== null && expected.length === key.length && timingSafeEqual(expected, key);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
/** Stable hash of a JSON-able request body for idempotency comparisons. */
export const requestHash = (body: unknown) => sha256(JSON.stringify(canonical(body)));
