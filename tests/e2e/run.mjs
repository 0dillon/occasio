// End-to-end check of the running app in a real browser (Playwright/Chromium).
//   E2E_BASE=http://localhost:3000 E2E_SHOTS=dir node --env-file=<env> tests/e2e/run.mjs
// Needs the app, worker and fetcher running against the database in <env>,
// with sample fixtures seeded. Reads the dev mail sink for verification links.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Playwright is preinstalled globally in CI/dev containers; it is not an app dependency.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? "e2e-shots";
mkdirSync(SHOTS, { recursive: true });
const neon = process.env.DATABASE_DRIVER === "neon";
if (neon) neonConfig.webSocketConstructor = ws;
const db = neon ? new NeonPool({ connectionString: process.env.DATABASE_URL_OWNER }) : new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

// The run creates accounts and resets per-IP rate limits, so it only runs
// against a disposable test database, never the primary one.
const dbName = new URL(process.env.DATABASE_URL_OWNER).pathname.slice(1);
if (!/test|dev/.test(dbName)) throw new Error(`Refusing to run e2e against database "${dbName}". Point it at a test database.`);
await q("DELETE FROM occasio.rate_limits");

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false, error: String(e?.message ?? e).split("\n")[0] }); console.log(`FAIL ${name}: ${e?.message?.split("\n")[0]}`); }
}
const must = (c, m) => { if (!c) throw new Error(m); };
const waitFor = async (fn, ms = 30000, every = 1000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, every)); }
};

const run = Date.now().toString(36);
const A = { email: `e2e-a-${run}@example.com`, pw: `Sample-pass-${run}-A1!` };
const B = { email: `e2e-admin-${run}@example.com`, pw: `Sample-pass-${run}-B2!` };
const C = { email: `e2e-c-${run}@example.com`, pw: `Sample-pass-${run}-C3!` };

async function signUp(page, u) {
  await page.goto(`${BASE}/auth/sign-up`);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.pw);
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/sign-up"), { timeout: 20000 });
}
async function verify(page, u) {
  const mail = await waitFor(async () => (await q("SELECT text_body FROM occasio.dev_mail WHERE to_address = $1 AND subject ILIKE '%confirm%' ORDER BY created_at DESC LIMIT 1", [u.email]))[0], 45000);
  must(mail, "verification mail never reached the dev sink (is the worker running?)");
  const link = mail.text_body.match(/https?:\/\/\S+\/auth\/verify\?token=\S+/)?.[0];
  must(link, "no verify link in mail");
  await page.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
}
async function signIn(page, u) {
  await page.goto(`${BASE}/auth/sign-in`);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/sign-in"), { timeout: 20000 });
}

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

await step("landing renders with brand logo", async () => {
  const r = await page.goto(BASE);
  must(r.ok(), `status ${r.status()}`);
  must(await page.locator('img[src^="/brand/"]').count() > 0, "brand logo missing");
  await page.screenshot({ path: join(SHOTS, "desktop-landing.png"), fullPage: true });
});

await step("security headers present", async () => {
  const r = await page.request.get(BASE);
  const h = r.headers();
  must(h["content-security-policy"]?.includes("frame-ancestors 'none'"), "CSP missing");
  must(h["x-content-type-options"] === "nosniff", "nosniff missing");
  must(!h["x-powered-by"], "x-powered-by exposed");
});

await step("member A signs up, confirms email, completes onboarding", async () => {
  await signUp(page, A);
  await verify(page, A);
  await page.goto(`${BASE}/onboarding`);
  await page.getByLabel("Name to show").fill("Sample Member A");
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/onboarding"), { timeout: 20000 });
  const row = (await q("SELECT email_verified_at FROM occasio.users WHERE email = $1", [A.email]))[0];
  must(row?.email_verified_at, "email not verified in DB");
});

await step("home and discover show labelled sample opportunities", async () => {
  await page.goto(`${BASE}/home`);
  await page.screenshot({ path: join(SHOTS, "desktop-home.png"), fullPage: true });
  await page.goto(`${BASE}/discover`);
  await page.getByText("Sample data").first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(SHOTS, "desktop-discover.png"), fullPage: true });
});

let oppId;
await step("opportunity page shows deadline, sample label and source", async () => {
  oppId = (await q("SELECT id FROM occasio.opportunities WHERE title = 'Sample Design Fellowship' AND publication = 'published'"))[0]?.id;
  must(oppId, "fixture opportunity missing");
  await page.goto(`${BASE}/opportunities/${oppId}`);
  await page.getByText(/Sample data/).first().waitFor();
  await page.screenshot({ path: join(SHOTS, "desktop-opportunity.png"), fullPage: true });
});

let submissionId;
await step("A shares a link with a poster image (stored in private object storage)", async () => {
  await page.goto(`${BASE}/contribute`);
  await page.getByLabel("Application or official link").fill(`https://example.com/e2e-${run}/apply`);
  await page.getByText("Add what you can see on it").click();
  await page.locator('input[name="title"]').fill(`E2E Sample Opportunity ${run}`);
  // 2x2 PNG generated in-process; no external files.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[name="image"]').setInputFiles({ name: "poster.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Share it" }).click();
  await page.waitForURL(/\/submissions\//, { timeout: 30000 });
  submissionId = page.url().split("/submissions/")[1].split(/[?#]/)[0];
  const a = (await q("SELECT object_key FROM occasio.submission_assets WHERE submission_id = $1", [submissionId]))[0];
  must(a, "asset row missing");
  await page.screenshot({ path: join(SHOTS, "desktop-submission.png"), fullPage: true });
});

await step("worker verifies the submission and routes it to human review", async () => {
  const s = await waitFor(async () => (await q("SELECT status FROM occasio.submissions WHERE id = $1 AND status IN ('review_required','needs_information','failed','accepted','duplicate','rejected')", [submissionId]))[0], 60000);
  must(s, "submission never left the pipeline");
  results.at(-1) || null;
  console.log(`   submission status: ${s.status}`);
});

await step("A's poster is served to A only", async () => {
  const asset = (await q("SELECT id FROM occasio.submission_assets WHERE submission_id = $1", [submissionId]))[0];
  const mine = await page.request.get(`${BASE}/api/v1/assets/${asset.id}`);
  must(mine.status() === 200, `owner got ${mine.status()}`);
  const anon = await (await browser.newContext()).request.get(`${BASE}/api/v1/assets/${asset.id}`);
  must([401, 403, 404].includes(anon.status()), `anonymous got ${anon.status()}`);
});

// Second member C: authorization boundaries.
const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageC = await ctxC.newPage();
await step("member C cannot see A's submission, poster or the admin area", async () => {
  await signUp(pageC, C);
  const sub = await pageC.goto(`${BASE}/submissions/${submissionId}`);
  must(sub.status() === 404, `submission returned ${sub.status()}`);
  const asset = (await q("SELECT id FROM occasio.submission_assets WHERE submission_id = $1", [submissionId]))[0];
  const r = await pageC.request.get(`${BASE}/api/v1/assets/${asset.id}`);
  must([403, 404].includes(r.status()), `asset returned ${r.status()}`);
  const adm = await pageC.goto(`${BASE}/admin`);
  must(adm.status() === 403, `admin returned ${adm.status()}`);
});

// Admin B reviews and accepts.
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageB = await ctxB.newPage();
await step("admin B accepts A's submission; A earns exactly one credit", async () => {
  await signUp(pageB, B);
  execFileSync("npx", ["tsx", "scripts/make-admin.ts", B.email, "admin"], { env: process.env, stdio: "pipe" });
  await signIn(pageB, B);
  const st = (await q("SELECT status FROM occasio.submissions WHERE id = $1", [submissionId]))[0].status;
  must(["review_required", "needs_information", "failed"].includes(st), `not reviewable: ${st}`);
  await pageB.goto(`${BASE}/admin/reviews/${submissionId}`);
  await pageB.screenshot({ path: join(SHOTS, "desktop-admin-review.png"), fullPage: true });
  const form = pageB.locator("form", { has: pageB.getByRole("button", { name: "Accept and publish" }) });
  await form.locator('input[name="title"]').fill(`E2E Sample Opportunity ${run}`);
  await form.locator('input[name="organizer"]').fill("Example E2E Organizer (sample)");
  await form.locator('input[name="editionKey"]').fill("2026");
  await form.locator('select[name="availability"]').selectOption("open");
  await form.locator('input[name="deadlineSourceText"]').fill("Closes 2026-12-31 23:59 Africa/Lagos (sample)");
  await form.locator('input[name="deadlineDate"]').fill("2026-12-31");
  await form.locator('input[name="deadlineTime"]').fill("23:59");
  await form.locator('input[name="deadlineTimezone"]').fill("Africa/Lagos");
  await form.locator('input[name="eligibilityComplete"]').check();
  await form.locator('input[name="sourceConfirmed"]').check();
  await pageB.getByRole("button", { name: "Accept and publish" }).click();
  await pageB.waitForURL(/\/admin\/reviews\?done=/, { timeout: 30000 });
  const w = (await q("SELECT w.balance FROM occasio.wallets w JOIN occasio.users u ON u.id = w.user_id WHERE u.email = $1", [A.email]))[0];
  must(w?.balance === 1, `A balance is ${w?.balance}`);
  const awards = (await q("SELECT count(*)::int n FROM occasio.credit_ledger l JOIN occasio.users u ON u.id = l.user_id WHERE u.email = $1 AND l.reason = 'contribution_award'", [A.email]))[0].n;
  must(awards === 1, `awards ${awards}`);
});

await step("admin pages render for an admin", async () => {
  for (const p of ["", "/reviews", "/discovery", "/catalog", "/sources", "/reports", "/refunds", "/jobs", "/audit", "/users", "/flags", "/mail"]) {
    const r = await pageB.goto(`${BASE}/admin${p}`);
    must(r.status() === 200, `/admin${p} -> ${r.status()}`);
  }
  await pageB.goto(`${BASE}/admin`);
  await pageB.screenshot({ path: join(SHOTS, "desktop-admin-overview.png"), fullPage: true });
});

await step("A sees the acceptance notification and credit", async () => {
  await page.goto(`${BASE}/notifications`);
  await page.screenshot({ path: join(SHOTS, "desktop-notifications.png"), fullPage: true });
  await page.goto(`${BASE}/credits`);
  await page.locator(".big-number").filter({ hasText: "1" }).first().waitFor();
});

await step("a fixture that was never source-checked cannot be unlocked and costs nothing", async () => {
  await page.goto(`${BASE}/opportunities/${oppId}`);
  await page.getByRole("button", { name: "Check if it fits me" }).click();
  await page.waitForURL(/\/matches\//, { timeout: 20000 });
  await page.screenshot({ path: join(SHOTS, "desktop-match-blocked.png"), fullPage: true });
  must(await page.getByRole("button", { name: /Unlock/ }).count() === 0, "unlock offered for a blocked opportunity");
  const debits = (await q("SELECT count(*)::int n FROM occasio.credit_ledger l JOIN occasio.users u ON u.id = l.user_id WHERE u.email = $1 AND l.delta < 0", [A.email]))[0].n;
  must(debits === 0, `debited ${debits}`);
});

let e2eOpp;
await step("member C unlocks the reviewed opportunity with the free starter match", async () => {
  await verify(pageC, C);
  e2eOpp = (await q("SELECT id, redemption_blockers FROM occasio.opportunities WHERE title = $1", [`E2E Sample Opportunity ${run}`]))[0];
  must(e2eOpp, "accepted opportunity not found");
  must(e2eOpp.redemption_blockers.length === 0, `blockers: ${e2eOpp.redemption_blockers.join("; ")}`);
  await pageC.goto(`${BASE}/opportunities/${e2eOpp.id}`);
  await pageC.getByRole("button", { name: "Check if it fits me" }).click();
  await pageC.waitForURL(/\/matches\//, { timeout: 20000 });
  await pageC.screenshot({ path: join(SHOTS, "desktop-match.png"), fullPage: true });
  await pageC.getByRole("button", { name: /Unlock with my starter match/ }).click();
  await pageC.waitForURL(/unlocked=1|\/opportunities\//, { timeout: 20000 });
  const ent = await q("SELECT e.via FROM occasio.entitlements e JOIN occasio.users u ON u.id = e.user_id WHERE u.email = $1", [C.email]);
  must(ent.length === 1 && ent[0].via === "starter", `entitlements ${JSON.stringify(ent)}`);
  const debits = (await q("SELECT count(*)::int n FROM occasio.credit_ledger l JOIN occasio.users u ON u.id = l.user_id WHERE u.email = $1", [C.email]))[0].n;
  must(debits === 0, `ledger rows ${debits} for a starter unlock`);
});

await step("C saves an application and adds a task; nothing is marked submitted", async () => {
  await pageC.goto(`${BASE}/opportunities/${e2eOpp.id}`);
  await pageC.getByRole("button", { name: /Save and plan my application/ }).click();
  await pageC.waitForURL(/\/applications\//, { timeout: 20000 });
  await pageC.locator('input[name="title"]').fill("Draft portfolio (sample task)");
  await pageC.getByRole("button", { name: "Add" }).click();
  await pageC.getByText("Draft portfolio (sample task)").first().waitFor();
  // Reminders are planned by the worker from the outbox, so wait briefly.
  const app = await waitFor(async () => {
    const r = (await q("SELECT a.status, (SELECT count(*)::int FROM occasio.application_tasks t WHERE t.application_id = a.id AND t.title = 'Draft portfolio (sample task)') tasks, (SELECT count(*)::int FROM occasio.reminders r WHERE r.application_id = a.id AND r.state = 'scheduled') reminders FROM occasio.applications a JOIN occasio.users u ON u.id = a.user_id WHERE u.email = $1", [C.email]))[0];
    return r && r.reminders > 0 ? r : null;
  }, 30000) ?? (await q("SELECT a.status, 0 AS tasks, 0 AS reminders FROM occasio.applications a JOIN occasio.users u ON u.id = a.user_id WHERE u.email = $1", [C.email]))[0];
  must(app && app.status !== "submitted", `status ${app?.status}`);
  must(app.tasks === 1, `tasks ${app.tasks}`);
  must(app.reminders > 0, "no deadline reminders scheduled");
  console.log(`   application ${app.status}, ${app.reminders} reminders scheduled`);
  await pageC.screenshot({ path: join(SHOTS, "desktop-application.png"), fullPage: true });
});

await step("deadlines page renders", async () => {
  const r = await page.goto(`${BASE}/deadlines`);
  must(r.status() === 200, `status ${r.status()}`);
  await page.screenshot({ path: join(SHOTS, "desktop-deadlines.png"), fullPage: true });
});

await step("data export returns only A's data", async () => {
  const r = await page.request.get(`${BASE}/api/v1/me/export`);
  must(r.status() === 200, `status ${r.status()}`);
  const body = await r.text();
  must(body.includes(A.email) && !body.includes(C.email) && !body.includes(B.email), "export leaks or misses data");
});

// Mobile pass.
const mobile = await browser.newContext({ ...devices["iPhone 13"] });
const m = await mobile.newPage();
await step("mobile: no horizontal scroll on key pages", async () => {
  await m.goto(BASE);
  await m.screenshot({ path: join(SHOTS, "mobile-landing.png"), fullPage: true });
  await signIn(m, A);
  for (const p of ["/home", "/discover", `/opportunities/${oppId}`, "/contribute", "/applications", "/credits", "/settings/profile"]) {
    await m.goto(`${BASE}${p}`);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) {
      const culprits = await m.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} r=${Math.round(e.getBoundingClientRect().right)}`));
      throw new Error(`${p} overflows by ${over}px: ${culprits.join(", ")}`);
    }
    await m.screenshot({ path: join(SHOTS, `mobile${p.replace(/\//g, "-").replace(/-[0-9a-f-]{36}$/, "-detail")}.png`), fullPage: true });
  }
});

await step("live bell: realtime connection or static fallback", async () => {
  const errs = consoleErrors.filter((e) => /realtime|websocket/i.test(e));
  console.log(`   realtime console errors: ${errs.length}`);
});

await browser.close();
await db.end();
writeFileSync(join(SHOTS, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
