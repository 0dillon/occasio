import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FetchResult } from "@/adapters/fetch-client";
import { extractionSchema, type Extraction, type Extractor } from "@/adapters/extractor";
import { withAnon, withUser, withWorker } from "@/db/tx";
import { register, verifyEmail } from "@/domain/auth";
import { admissionsLink, crawlDueSources, devpostEndDate, leadFromPost, outboundLinks, triageCandidates } from "@/domain/discovery";
import { dispatchOutbox } from "@/domain/outbox";
import { awardReferral, referralCode } from "@/domain/referrals";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factory";

const NOW = new Date("2026-11-08T12:00:00Z");
beforeEach(async () => {
  await resetDb();
  await ownerQuery("UPDATE app_flags SET value = 'true' WHERE key = 'auto_publish_enabled'");
});
afterAll(closePools);

const ok = (url: string, body: string, contentType = "text/html"): FetchResult => ({
  outcome: "ok", requestedUrl: url, finalUrl: url, status: 200, contentType, body,
  contentHash: `h-${body.length}`, etag: null, lastModified: null, detail: null,
} as FetchResult);

/** Test data on reserved example domains, shaped like Devpost's public list. */
const LIST = {
  hackathons: [
    { title: "Example Open Hack 2026", url: "https://open-hack.example.com/", open_state: "open", invite_only: false, organization_name: "Example Org", submission_period_dates: "Nov 01 - Dec 04, 2026", displayed_location: { location: "Online" } },
    { title: "Example Private Hack", url: "https://private-hack.example.com/", open_state: "open", invite_only: true },
    { title: "Example Risky Hack", url: "https://risky-hack.example.com/", open_state: "open", invite_only: false },
  ],
};

function extraction(url: string): Extraction {
  const risky = url.includes("risky");
  return extractionSchema.parse({
    schema_version: "1", extractor: "rule-based-v1 (no AI)",
    title: { value: risky ? "Example Risky Hack" : "Example Open Hack 2026", origin: "source_page", excerpt: null },
    organizer: { value: "Example Org", origin: "source_page" },
    category: { value: "hackathon", origin: "source_page" },
    deadline: { source_text: "Deadline: Dec 4, 2026 @ 5:00pm", local_date: "2026-12-04", local_time: "17:00", timezone: null, rolling: false, origin: "source_page", excerpt: "Deadline: Dec 4, 2026" },
    location_mode: "remote", fee: { status: "free", text: null, excerpt: null }, summary: null,
    conflicts: [], missing_information: ["deadline_timezone"], risk_flags: risky ? ["Asks for payment to register"] : [],
  });
}

async function fetcher(url: string): Promise<FetchResult> {
  if (url.includes("/api/hackathons")) {
    const page = new URL(url).searchParams.get("page");
    return ok(url, JSON.stringify(page === "1" ? LIST : { hackathons: [] }), "application/json");
  }
  return ok(url, `<html><head><title>${url}</title></head><body>Deadline: Dec 4, 2026 @ 5:00pm</body></html>`);
}

describe("Devpost submission period", () => {
  it("reads the last day in every shape devpost.com shows", () => {
    expect(devpostEndDate("Oct 30 - Dec 04, 2026")).toBe("2026-12-04");
    expect(devpostEndDate("Nov 01 - 10, 2026")).toBe("2026-11-10");
    expect(devpostEndDate("Jul 16, 2026 - Jan 15, 2027")).toBe("2027-01-15");
    expect(devpostEndDate("Nov 08, 2026")).toBe("2026-11-08");
    expect(devpostEndDate("Rolling")).toBeNull();
    expect(devpostEndDate(null)).toBeNull();
  });
});

describe("opportunity blog leads (D15)", () => {
  const post = (title: string, html: string) => ({ link: "https://blog.example.net/post", title: { rendered: title }, content: { rendered: html } });
  it("takes the organizer link and the claimed deadline from a post", () => {
    const lead = leadFromPost(post("2027 Example Studentship in UK | Fully Funded",
      `<p><strong>Deadline:</strong> February 2, 2027</p><a href="https://twitter.com/blog">@blog</a>
       <a href="https://scholarsregion.com/scholarship/x">READ HOW TO APPLY</a>
       <a href="https://www.example.ac.uk/research/how-to-apply">How to apply | Example School</a>`));
    expect(lead).toMatchObject({ title: "2027 Example Studentship in UK", url: "https://www.example.ac.uk/research/how-to-apply", deadline: "February 2, 2027", category: "scholarship", structured: "lead" });
  });
  it("retries a lead whose page hit a network error instead of rejecting it", async () => {
    const [src] = await ownerQuery(
      `INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, approved_at, enabled)
       VALUES ('Blog (test)', 'https://blog.example.net', 'blog.example.net', 'wordpress_leads', '/wp-json/wp/v2/posts', 'test fixture source', now(), true) RETURNING id`);
    await ownerQuery(`INSERT INTO discovery_candidates(source_id, dedupe_key, url, payload) VALUES ($1, 'k1', 'https://www.example.ac.uk/apply', '{"title":"Example","structured":"lead"}')`, [src.id]);
    const down = async (url: string) => ({ outcome: "error", requestedUrl: url, finalUrl: null, status: null, contentType: null, body: null, contentHash: null, etag: null, lastModified: null, detail: "getaddrinfo EAI_AGAIN" } as FetchResult);
    await triageCandidates(5, down, NOW);
    const [row] = await ownerQuery("SELECT state, payload->>'fetch_attempts' AS n, reason FROM discovery_candidates");
    expect(row).toMatchObject({ state: "pending", n: "1" });
    expect(row.reason).toMatch(/EAI_AGAIN/);
  });
  it("skips guides with no deadline, posts with no outside link, homepages and logins", () => {
    expect(leadFromPost(post("7 Universities in Example", `<a href="https://www.example.ac.uk/courses/">courses</a>`))).toBeNull();
    expect(leadFromPost(post("Example Internship", `Deadline: November 16, 2026 <a href="https://scholarsregion.com/s/1">apply</a>`))).toBeNull();
    expect(leadFromPost(post("Example Grant", `Deadline: November 16, 2026 <a href="https://example.org/">site</a> <a href="https://example.org/account/login">apply</a>`))).toBeNull();
  });
});

describe("discovery without review (D14)", () => {
  it("crawls Devpost, skips invite-only, publishes clean pages and records why others weren't", async () => {
    await ownerQuery(
      `INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, approved_at, enabled, min_interval_seconds)
       VALUES ('Devpost (test)', 'https://devpost.com', 'devpost.com', 'devpost', '/api/hackathons?status[]=open', 'test fixture source', now(), true, 1)`,
    );
    const crawl = await crawlDueSources(fetcher, NOW);
    expect(crawl.candidates).toBe(2); // the invite-only one is skipped
    let x: Extractor = { name: "test", extract: async ({ pageUrl }) => extraction(pageUrl ?? "") };
    const r = await triageCandidates(10, fetcher, NOW, x);
    expect(r).toEqual({ processed: 2, published: 1 });

    const opps = await ownerQuery("SELECT title, origin, publication FROM opportunities");
    expect(opps).toEqual([{ title: "Example Open Hack 2026", origin: "discovery", publication: "published" }]);
    const [risky] = await ownerQuery("SELECT state, reason FROM discovery_candidates WHERE url LIKE '%risky%'");
    expect(risky.state).toBe("rejected");
    expect(risky.reason).toMatch(/Risk signals/);
    // Discovery never mints credits.
    expect(await ownerQuery("SELECT 1 FROM credit_ledger")).toHaveLength(0);

    // A second crawl finds the same listing again; it isn't published twice.
    await ownerQuery("UPDATE source_registry SET next_crawl_at = NULL");
    await ownerQuery("DELETE FROM discovery_candidates");
    await crawlDueSources(fetcher, NOW);
    x = { name: "test", extract: async ({ pageUrl }) => extraction(pageUrl ?? "") };
    await triageCandidates(10, fetcher, NOW, x);
    expect(await ownerQuery("SELECT 1 FROM opportunities")).toHaveLength(1);
  });

  it("publishes from Devpost's own record when the hackathon page refuses automated requests", async () => {
    await ownerQuery(
      `INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, approved_at, enabled, min_interval_seconds)
       VALUES ('Devpost (test)', 'https://devpost.com', 'devpost.com', 'devpost', '/api/hackathons?status[]=open', 'test fixture source', now(), true, 1)`,
    );
    const blocked = async (url: string): Promise<FetchResult> => url.includes("/api/hackathons") ? fetcher(url)
      : ({ outcome: "blocked", requestedUrl: url, finalUrl: url, status: 403, contentType: "text/html", body: null, contentHash: null, etag: null, lastModified: null, detail: "HTTP 403" } as FetchResult);
    await crawlDueSources(blocked, NOW);
    const r = await triageCandidates(10, blocked, NOW);
    expect(r.published).toBe(1); // the other public one has no submission period, so no deadline: not published
    const rows = await ownerQuery(
      `SELECT o.title, o.location_mode, d.source_local_date::text AS date, d.timezone, d.precision::text AS precision FROM opportunities o
         JOIN opportunity_deadlines d ON d.opportunity_id = o.id AND d.is_current ORDER BY o.title`);
    expect(rows[0]).toMatchObject({ title: "Example Open Hack 2026", location_mode: "remote", date: "2026-12-04", timezone: null, precision: "date_only" });
  });
});

async function signUpWith(ref: string | null) {
  const email = `t-${Math.random().toString(36).slice(2, 10)}@example.test`;
  const r = await register({ email, password: "correct horse battery", ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, origin: "http://localhost:3000", ref });
  return { id: r.userId!, email };
}
const balance = async (id: string) => Number((await ownerQuery("SELECT balance FROM wallets WHERE user_id = $1", [id]))[0].balance);

describe("referral credits (D14)", () => {
  it("awards the referrer once, when the invited person confirms their email", async () => {
    const referrer = await makeUser();
    const code = await withUser(referrer.id, (c) => referralCode(c, referrer.id));
    expect(await withUser(referrer.id, (c) => referralCode(c, referrer.id))).toBe(code); // stable
    const friend = await signUpWith(code);
    expect(await ownerQuery("SELECT referrer_id FROM referrals WHERE referred_id = $1", [friend.id])).toEqual([{ referrer_id: referrer.id }]);

    // Joining alone earns nothing.
    await dispatchOutbox();
    expect(await balance(referrer.id)).toBe(0);

    // Confirming the email (the real link from the outgoing email) earns one credit.
    const [mail] = await ownerQuery("SELECT payload FROM notification_attempts WHERE user_id = $1 AND payload->>'kind' = 'verify_email'", [friend.id]);
    const token = String(mail.payload.text).match(/token=([A-Za-z0-9_-]+)/)![1]!;
    await verifyEmail(token);
    await dispatchOutbox();
    await dispatchOutbox();
    expect(await balance(referrer.id)).toBe(1);
    const [l] = await ownerQuery("SELECT reason, delta FROM credit_ledger WHERE user_id = $1", [referrer.id]);
    expect(l).toEqual({ reason: "referral_award", delta: 1 });

    // Retried award is a no-op.
    await withWorker((c) => awardReferral(c, friend.id));
    expect(await balance(referrer.id)).toBe(1);
  });

  it("ignores unknown codes and never lets the app role award itself", async () => {
    const someone = await signUpWith("zzzzzzzz");
    expect(await ownerQuery("SELECT 1 FROM referrals WHERE referred_id = $1", [someone.id])).toHaveLength(0);
    const u = await makeUser();
    await expect(withUser(u.id, (c) => c.query(
      "INSERT INTO credit_ledger(user_id, delta, reason, business_key, actor_kind) VALUES ($1, 1, 'referral_award', 'self-ref', 'user')", [u.id],
    ))).rejects.toThrow();
    await expect(withAnon((c) => c.query("UPDATE referrals SET awarded_at = now()"))).rejects.toThrow(/permission denied/);
  });

  it("stops awarding past the monthly limit", async () => {
    const referrer = await makeUser();
    const code = await withUser(referrer.id, (c) => referralCode(c, referrer.id));
    for (let i = 0; i < 11; i++) {
      const f = await signUpWith(code);
      await ownerQuery("UPDATE users SET email_verified_at = now() WHERE id = $1", [f.id]);
      await withWorker((c) => awardReferral(c, f.id));
    }
    expect(await balance(referrer.id)).toBe(10);
    expect(await ownerQuery("SELECT 1 FROM referrals WHERE award_note = 'Monthly referral limit reached'")).toHaveLength(1);
  });
});

describe("official catalogue links (D16)", () => {
  it("keeps programme links that leave the catalogue and drops its own, social and bare-URL links", () => {
    const html = `<html><body>
      <a href="https://epsmaster.eu/"><span>European Politics and Society Joint Master</span></a>
      <a href="https://epsmaster.eu/">European Politics and Society Joint Master</a>
      <a href="https://erasmus-plus.ec.europa.eu/projects/1">Project overview page</a>
      <a href="/scholarships_en">All scholarships here</a>
      <a href="https://www.linkedin.com/company/x">Follow us on LinkedIn</a>
      <a href="https://master-cne.eu/">https://master-cne.eu/</a>
    </body></html>`;
    const items = outboundLinks(html, "https://www.eacea.ec.europa.eu/scholarships/erasmus-mundus-catalogue_en", "www.eacea.ec.europa.eu");
    expect(items).toEqual([{ title: "European Politics and Society Joint Master", url: "https://epsmaster.eu/", category: "scholarship" }]);
  });
});

describe("admissions page hop (D16)", () => {
  it("picks a same-site admissions link and ignores other sites and logins", () => {
    const links = [
      { href: "https://other.org/admissions", text: "Admissions" },
      { href: "https://www.example.eu/login", text: "Apply now" },
      { href: "https://www.example.eu/about", text: "About the programme" },
      { href: "https://example.eu/admission/", text: "Admission" },
    ];
    expect(admissionsLink(links, "https://www.example.eu/")).toBe("https://example.eu/admission/");
    expect(admissionsLink(links.slice(0, 3), "https://www.example.eu/")).toBeNull();
  });
});
