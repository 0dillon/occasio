import { z } from "zod";
import { type Db, one } from "@/db/tx";
import { isValidTimeZone } from "@/lib/time";
import { audit, emit } from "./audit";
import { CATEGORIES } from "./catalog";
import { replanForUser } from "./reminders";

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter country code").nullable();
const optional = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

/** Only these fields are writable by the account owner. Roles are never here. */
export const profileSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  country: optional(country),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid timezone").optional(),
  categories: z.array(z.enum(CATEGORIES)).max(10).optional(),
  interests: z.array(z.string().trim().toLowerCase().min(2).max(40)).max(12).optional(),
  remoteOk: z.boolean().optional(),
  freeOnly: z.boolean().optional(),
  residenceCountry: optional(country),
  citizenships: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(4).nullable().optional(),
  educationLevel: optional(z.enum(["secondary", "undergraduate", "graduate", "not_studying"])),
  ageBand: optional(z.enum(["under_18", "18_24", "25_34", "35_plus"])),
  experienceLevel: optional(z.enum(["none", "early", "mid", "senior"])),
  completeOnboarding: z.boolean().optional(),
});
export type ProfileInput = z.input<typeof profileSchema>;

export const notificationSchema = z.object({
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  offsets: z.array(z.coerce.number().int().refine((n) => [10080, 4320, 1440, 180].includes(n))).max(4),
});

export async function getProfile(c: Db, userId: string) {
  return one(
    c,
    `SELECT u.email, u.role, u.email_verified_at, u.created_at, p.display_name, p.country, p.timezone, p.onboarded_at,
            pr.categories, pr.interests, pr.remote_ok, pr.free_only,
            e.residence_country, e.citizenships, e.education_level, e.age_band, e.experience_level,
            n.email_enabled, n.in_app_enabled, n.quiet_start, n.quiet_end, n.offsets_minutes
       FROM users u JOIN profiles p ON p.user_id = u.id JOIN user_preferences pr ON pr.user_id = u.id
       JOIN user_eligibility e ON e.user_id = u.id JOIN notification_preferences n ON n.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
}

export async function updateProfile(c: Db, userId: string, raw: ProfileInput) {
  const p = profileSchema.parse(raw);
  const has = (k: keyof typeof p) => p[k] !== undefined;
  if (has("displayName") || has("country") || has("timezone") || p.completeOnboarding) {
    await c.query(
      `UPDATE profiles SET display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
              country = CASE WHEN $4 THEN $5 ELSE country END,
              timezone = coalesce($6, timezone),
              onboarded_at = CASE WHEN $7 THEN coalesce(onboarded_at, now()) ELSE onboarded_at END,
              revision = revision + 1
        WHERE user_id = $1`,
      [userId, has("displayName"), p.displayName ?? null, has("country"), p.country ?? null, p.timezone ?? null, !!p.completeOnboarding],
    );
  }
  if (has("categories") || has("interests") || has("remoteOk") || has("freeOnly")) {
    await c.query(
      `UPDATE user_preferences SET categories = coalesce($2, categories), interests = coalesce($3, interests),
              remote_ok = coalesce($4, remote_ok), free_only = coalesce($5, free_only) WHERE user_id = $1`,
      [userId, p.categories ?? null, p.interests ?? null, p.remoteOk ?? null, p.freeOnly ?? null],
    );
  }
  const eligKeys = ["residenceCountry", "citizenships", "educationLevel", "ageBand", "experienceLevel"] as const;
  if (eligKeys.some(has)) {
    await c.query(
      `UPDATE user_eligibility SET
         residence_country = CASE WHEN $2 THEN $3 ELSE residence_country END,
         citizenships = CASE WHEN $4 THEN $5 ELSE citizenships END,
         education_level = CASE WHEN $6 THEN $7 ELSE education_level END,
         age_band = CASE WHEN $8 THEN $9 ELSE age_band END,
         experience_level = CASE WHEN $10 THEN $11 ELSE experience_level END
       WHERE user_id = $1`,
      [userId, has("residenceCountry"), p.residenceCountry ?? null, has("citizenships"), p.citizenships ?? null,
       has("educationLevel"), p.educationLevel ?? null, has("ageBand"), p.ageBand ?? null, has("experienceLevel"), p.experienceLevel ?? null],
    );
  }
  // Private attributes are not written into the audit trail, only that they changed.
  await audit(c, { kind: "user", id: userId }, "profile.updated", "user", userId, { changes: { fields: Object.keys(p) } });
  if (has("timezone")) await replanForUser(c, userId);
}

export async function updateNotifications(c: Db, userId: string, raw: z.input<typeof notificationSchema>) {
  const n = notificationSchema.parse(raw);
  await c.query(
    `UPDATE notification_preferences SET email_enabled = $2, in_app_enabled = $3, quiet_start = $4, quiet_end = $5, offsets_minutes = $6, updated_at = now()
      WHERE user_id = $1`,
    [userId, n.emailEnabled, n.inAppEnabled, n.quietStart, n.quietEnd, n.offsets.sort((a, b) => b - a)],
  );
  await c.query("INSERT INTO user_consents(user_id, kind, version) VALUES ($1, $2, 'notifications-2026-11-03')", [userId, n.emailEnabled ? "email_reminders_on" : "email_reminders_off"]);
  await audit(c, { kind: "user", id: userId }, "notifications.updated", "user", userId);
  await replanForUser(c, userId);
  await emit(c, "user.preferences_changed.v1", userId, {});
}

export const onboardingNeeded = (p: { onboarded_at: Date | null } | undefined) => !p?.onboarded_at;
