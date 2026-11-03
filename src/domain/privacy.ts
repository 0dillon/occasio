import { deleteObject } from "@/adapters/storage";
import { type Db, many, one, withWorker } from "@/db/tx";
import { audit, emit } from "./audit";

/**
 * Export: everything we hold about the account owner, read under their own
 * row-security context so nothing from another account can leak in.
 */
export async function exportAccount(c: Db, userId: string) {
  const q = (sql: string) => many(c, sql, [userId]);
  return {
    generated_at: new Date().toISOString(),
    note: "Your OCCASIO data. Credit history is append-only; opportunity facts are shared catalog data and are referenced by id.",
    account: await one(c, "SELECT id, email, role, email_verified_at, created_at FROM users WHERE id = $1", [userId]),
    profile: await one(c, "SELECT display_name, country, timezone, onboarded_at FROM profiles WHERE user_id = $1", [userId]),
    preferences: await one(c, "SELECT categories, interests, remote_ok, free_only FROM user_preferences WHERE user_id = $1", [userId]),
    eligibility: await one(c, "SELECT residence_country, citizenships, education_level, age_band, experience_level FROM user_eligibility WHERE user_id = $1", [userId]),
    notification_preferences: await one(c, "SELECT * FROM notification_preferences WHERE user_id = $1", [userId]),
    consents: await q("SELECT kind, version, granted_at, revoked_at FROM user_consents WHERE user_id = $1"),
    submissions: await q("SELECT id, application_url, user_note, claimed, status, status_reason, created_at FROM submissions WHERE user_id = $1"),
    wallet: await one(c, "SELECT balance, starter_available FROM wallets WHERE user_id = $1", [userId]),
    credit_ledger: await q("SELECT delta, reason, note, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY created_at"),
    entitlements: await q("SELECT opportunity_id, via, unlocked_at FROM entitlements WHERE user_id = $1"),
    match_requests: await q("SELECT query_text, constraints, state, created_at FROM match_requests WHERE user_id = $1"),
    applications: await q("SELECT opportunity_id, status, notes, target_at, submitted_at, user_reference, created_at FROM applications WHERE user_id = $1"),
    tasks: await q("SELECT application_id, title, target_date, done_at FROM application_tasks WHERE user_id = $1"),
    reminders: await q("SELECT kind, channel, due_at, state FROM reminders WHERE user_id = $1"),
    notifications: await q("SELECT title, body, created_at, read_at FROM notifications WHERE user_id = $1"),
  };
}

export async function requestDeletion(c: Db, userId: string) {
  const r = await one<{ id: string }>(c, "INSERT INTO privacy_requests(user_id, kind) VALUES ($1,'delete') RETURNING id", [userId]);
  // Block sign-in immediately; erasure runs in the worker.
  await c.query("UPDATE users SET state = 'deleted', deleted_at = now() WHERE id = $1", [userId]);
  await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  await emit(c, "user.deleted.v1", userId, { request: r!.id });
  await audit(c, { kind: "user", id: userId }, "account.deletion_requested", "user", userId);
}

/**
 * Erasure (worker). Private data is deleted; the credit ledger and audit
 * trail are append-only, so they are kept but disconnected from a reachable
 * identity (email replaced). That is pseudonymisation, not anonymisation.
 */
export async function processDeletions() {
  const pending = await withWorker((c) => many<{ id: string; user_id: string }>(c, "SELECT id, user_id FROM privacy_requests WHERE kind = 'delete' AND state = 'pending' LIMIT 10 FOR UPDATE SKIP LOCKED"));
  for (const p of pending) {
    const keys = await withWorker((c) => many<{ object_key: string }>(c, "SELECT object_key FROM submission_assets WHERE owner_id = $1", [p.user_id]));
    for (const k of keys) await deleteObject(k.object_key);
    await withWorker(async (c) => {
      const uid = p.user_id;
      for (const t of ["application_tasks", "application_status_history", "reminders", "notifications", "saved_searches", "refund_requests", "match_requests", "applications", "user_consents"]) {
        if (t === "match_requests") await c.query("UPDATE entitlements SET match_request_id = NULL WHERE user_id = $1", [uid]);
        await c.query(`DELETE FROM ${t} WHERE user_id = $1`, [uid]);
      }
      await c.query("DELETE FROM submission_assets WHERE owner_id = $1", [uid]);
      await c.query("UPDATE submissions SET user_note = NULL, claimed = '{}', candidate = NULL WHERE user_id = $1", [uid]);
      await c.query("UPDATE notification_attempts SET payload = '{\"redacted\":true}' WHERE user_id = $1", [uid]);
      await c.query("DELETE FROM user_eligibility WHERE user_id = $1", [uid]);
      await c.query("DELETE FROM user_preferences WHERE user_id = $1", [uid]);
      await c.query("DELETE FROM notification_preferences WHERE user_id = $1", [uid]);
      await c.query("UPDATE profiles SET display_name = NULL, country = NULL WHERE user_id = $1", [uid]);
      await c.query("UPDATE users SET email = $2, password_hash = NULL WHERE id = $1", [uid, `deleted-${uid}@deleted.invalid`]);
      await c.query("UPDATE privacy_requests SET state = 'completed', completed_at = now() WHERE id = $1", [p.id]);
      await audit(c, { kind: "worker" }, "account.erased", "user", uid);
    });
  }
  return pending.length;
}

/** Retention purge for rejected posters past their retention date. */
export async function purgeExpiredAssets() {
  const rows = await withWorker((c) => many<{ id: string; object_key: string }>(c, "SELECT id, object_key FROM submission_assets WHERE retention_until < now() LIMIT 100"));
  for (const r of rows) {
    await deleteObject(r.object_key);
    await withWorker(async (c) => {
      await c.query("DELETE FROM submission_assets WHERE id = $1", [r.id]);
      await audit(c, { kind: "worker" }, "asset.purged", "submission_asset", r.id, { reason: "retention" });
    });
  }
  return rows.length;
}
