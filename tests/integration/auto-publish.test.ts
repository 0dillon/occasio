import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FetchResult } from "@/adapters/fetch-client";
import { extractionSchema, type Extraction, type Extractor } from "@/adapters/extractor";
import { autoPublishBlockers, assess, processNextSubmission } from "@/domain/verification";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factory";

const NOW = new Date("2026-11-06T12:00:00Z");
const URL_ = "https://events.example.org/builders-2026";

const page: FetchResult = {
  outcome: "ok", requestedUrl: URL_, finalUrl: URL_, status: 200, contentType: "text/html",
  body: "<html><head><title>Example Builders 2026</title></head><body>Applications close 4 December 2026 at 14:00 PT.</body></html>",
  contentHash: "h", etag: null, lastModified: null, detail: null,
} as FetchResult;

/** A clean extraction as the AI extractor would return it. Test data on a reserved example domain. */
function clean(over: Partial<Extraction> = {}): Extraction {
  return extractionSchema.parse({
    schema_version: "1", extractor: "claude:test",
    title: { value: "Example Builders 2026", origin: "source_page", excerpt: "Example Builders 2026" },
    organizer: { value: "Example Org", origin: "source_page" },
    category: { value: "hackathon", origin: "source_page" },
    deadline: { source_text: "Applications close 4 December 2026 at 14:00 PT.", local_date: "2026-12-04", local_time: "14:00", timezone: "America/Los_Angeles", rolling: false, origin: "source_page", excerpt: "close 4 December 2026" },
    location_mode: "remote", fee: { status: "free", text: "Free", excerpt: null }, summary: "A test event.",
    conflicts: [], missing_information: [], risk_flags: [], ...over,
  });
}
const fakeExtractor = (x: Extraction): Extractor => ({ name: x.extractor, extract: async () => x });

const ctx = { duplicateOf: null, knownOrganizerDomain: false, now: NOW };
const blockersFor = (x: Extraction) => autoPublishBlockers(page, x, assess(page, x, ctx).checks, NOW);

describe("auto-publish gate", () => {
  it("passes a clean AI extraction from a new organizer", () => {
    expect(blockersFor(clean())).toEqual([]);
  });
  it("blocks rule-based extraction", () => {
    expect(blockersFor(clean({ extractor: "rule-based-v1 (no AI)" }))).toContain("Page not read by the AI extractor");
  });
  it("blocks risk flags, conflicts, missing timezone and near deadlines", () => {
    expect(blockersFor(clean({ risk_flags: ["Unusual payment instructions"] })).join()).toMatch(/Risk signals/);
    expect(blockersFor(clean({ conflicts: ["Deadline on page differs"] })).join()).toMatch(/Conflicts/);
    const x = clean();
    expect(blockersFor({ ...x, deadline: { ...x.deadline, timezone: null } }).join()).toMatch(/timezone/i);
    expect(blockersFor({ ...x, deadline: { ...x.deadline, local_date: "2026-11-07" } }).join()).toMatch(/too close/);
  });
  it("blocks a deadline that only came from the contributor", () => {
    const x = clean();
    expect(blockersFor({ ...x, deadline: { ...x.deadline, origin: "user_claim" } }).join()).toMatch(/official page/);
  });
});

async function share(userId: string) {
  const [s] = await ownerQuery(
    `INSERT INTO submissions(user_id, application_url, normalized_url, idempotency_key, status, claimed)
     VALUES ($1,$2,$2,$3,'received','{}') RETURNING id`,
    [userId, URL_, `k-${Math.random()}`],
  );
  return s.id as string;
}
const setFlag = (v: boolean) => ownerQuery("UPDATE app_flags SET value = $1 WHERE key = 'auto_publish_enabled'", [JSON.stringify(v)]);
const status = async (id: string) => (await ownerQuery("SELECT status FROM submissions WHERE id = $1", [id]))[0].status;
const balance = async (id: string) => Number((await ownerQuery("SELECT balance FROM wallets WHERE user_id = $1", [id]))[0].balance);

beforeEach(resetDb);
afterAll(closePools);

describe("worker auto-publish", () => {
  it("publishes a clean submission and awards exactly one credit when the flag is on", async () => {
    await setFlag(true);
    const a = await makeUser();
    const before = await balance(a.id);
    const id = await share(a.id);
    await processNextSubmission(async () => page, NOW, fakeExtractor(clean()));
    expect(await status(id)).toBe("accepted");
    const [o] = await ownerQuery("SELECT publication, eligibility_complete FROM opportunities o JOIN submissions s ON s.opportunity_id = o.id WHERE s.id = $1", [id]);
    expect(o.publication).toBe("published");
    expect(o.eligibility_complete).toBe(false); // browse-only until a person confirms eligibility
    expect(await balance(a.id)).toBe(before + 1);
  });

  it("leaves it for a person when the flag is off", async () => {
    await setFlag(false);
    const a = await makeUser();
    const id = await share(a.id);
    await processNextSubmission(async () => page, NOW, fakeExtractor(clean()));
    expect(await status(id)).toBe("review_required");
  });

  it("leaves it for a person when any check is not clean", async () => {
    await setFlag(true);
    const a = await makeUser();
    const id = await share(a.id);
    await processNextSubmission(async () => page, NOW, fakeExtractor(clean({ risk_flags: ["Page promises guaranteed outcomes"] })));
    expect(await status(id)).toBe("review_required");
    const [run] = await ownerQuery("SELECT checks FROM verification_runs WHERE submission_id = $1", [id]);
    expect(JSON.stringify(run.checks)).toMatch(/Auto-publish/);
  });
});
