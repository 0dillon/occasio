import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { deleteObject, getObject, processPoster, putObject, UploadRejected } from "@/adapters/storage";

describe(`private object storage (${process.env.STORAGE_DRIVER ?? "disk"})`, () => {
  it("round-trips a processed poster and deletes it", async () => {
    const png = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#d4f812" } }).png().toBuffer();
    const poster = await processPoster(png);
    expect(poster.mime).toBe("image/jpeg");
    const key = `test/${randomUUID()}.jpg`;
    await putObject(key, poster.data);
    const back = await getObject(key);
    expect(back.equals(poster.data)).toBe(true);
    await deleteObject(key);
    await expect(getObject(key)).rejects.toThrow();
  });
  it("rejects files that are not images regardless of name", async () => {
    await expect(processPoster(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).rejects.toBeInstanceOf(UploadRejected);
  });
  it("refuses path traversal in object keys", async () => {
    await expect(putObject("../etc/passwd.jpg", Buffer.from("x"))).rejects.toThrow(/invalid object key/);
  });
});
