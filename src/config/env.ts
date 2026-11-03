import { z } from "zod";

// Server-only configuration. Never import this from a client component.
const schema = z.object({
  DATABASE_URL_APP: z.string().url(),
  DATABASE_URL_WORKER: z.string().url().optional(),
  DATABASE_URL_OWNER: z.string().url().optional(),
  APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  OCCASIO_MODE: z.enum(["development", "test", "production"]).default("development"),
  STORAGE_DIR: z.string().default("./storage"),
  FETCHER_URL: z.string().url().optional(),
  FETCHER_TOKEN: z.string().min(24).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        "Invalid server configuration: " +
          parsed.error.issues.map((i) => i.path.join(".")).join(", "),
      );
    }
    cached = parsed.data;
    if (cached.OCCASIO_MODE === "production") {
      // Production must never silently fall back to development adapters.
      const missing = (["FETCHER_URL", "FETCHER_TOKEN", "RESEND_API_KEY", "EMAIL_FROM"] as const).filter(
        (k) => !cached![k],
      );
      if (missing.length) throw new Error("Production requires: " + missing.join(", "));
    }
  }
  return cached;
}

export const isDev = () => env().OCCASIO_MODE !== "production";
