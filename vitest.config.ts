import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against a separate database (occasio_test) using the
// same three roles as the app. The URLs are derived from .env.local so no
// credentials are written into the repository.
function testEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = "";
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  for (const k of ["DATABASE_URL_OWNER", "DATABASE_URL_APP", "DATABASE_URL_WORKER"]) {
    if (out[k]) out[k] = out[k]!.replace(/\/[^/?]+(\?|$)/, "/occasio_test$1");
  }
  out.STORAGE_DIR = "./storage-test";
  out.OCCASIO_MODE = "development";
  return out;
}

const env = testEnv();
// globalSetup runs in this process, so it needs the same variables.
Object.assign(process.env, env);

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    env,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
