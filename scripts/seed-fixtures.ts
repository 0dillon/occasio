import { closePools } from "../src/db/pool";
import { one, withWorker } from "../src/db/tx";
import { draftSchema, publishWithoutAward } from "../src/domain/exchange";

/**
 * SAMPLE DATA ONLY. Publishes clearly labelled, fictional opportunities on
 * reserved example domains (RFC 2606) so a local or preview database has
 * something to browse. Every row is is_fixture = true and the UI marks it
 * "Sample data". Never run this against production.
 *
 *   npm run db:seed-fixtures
 */
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

const SAMPLES = [
  { title: "Sample Open Data Hackathon", organizer: "Example Civic Lab (sample)", category: "hackathon", locationMode: "remote", fee: "free", days: 21, tz: "Africa/Lagos", rules: [] },
  { title: "Sample Undergraduate STEM Scholarship", organizer: "Example Education Trust (sample)", category: "scholarship", locationMode: "unknown", fee: "free", days: 45, tz: "Europe/London",
    rules: [{ rule_type: "education_level", operator: "in", operand: ["undergraduate"], source_text: "Open to undergraduate students (sample rule)", is_hard: true }] },
  { title: "Sample Early-Stage Founder Grant", organizer: "Example Founders Fund (sample)", category: "grant", locationMode: "remote", fee: "free", days: 10, tz: "America/New_York", rules: [] },
  { title: "Sample Design Fellowship", organizer: "Example Studio Collective (sample)", category: "fellowship", locationMode: "hybrid", fee: "free", days: 60, tz: "Africa/Nairobi",
    rules: [{ rule_type: "residence_country", operator: "in", operand: ["KE", "NG", "GH"], source_text: "Residents of Kenya, Nigeria or Ghana (sample rule)", is_hard: true }] },
  { title: "Sample Product Internship", organizer: "Example Software Co. (sample)", category: "internship", locationMode: "on_site", fee: "free", days: 30, tz: "Asia/Singapore", rules: [] },
  { title: "Sample Climate Pitch Competition", organizer: "Example Climate Network (sample)", category: "competition", locationMode: "remote", fee: "unknown", days: 5, tz: "Europe/Berlin", rules: [] },
] as const;

async function main() {
  if (process.env.OCCASIO_MODE === "production") throw new Error("Refusing to seed sample data in production mode.");
  let published = 0;
  for (const [i, s] of SAMPLES.entries()) {
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const date = iso(s.days);
    const draft = draftSchema.parse({
      title: s.title, organizer: s.organizer, programme: s.title, editionKey: date.slice(0, 4), category: s.category,
      summary: `SAMPLE DATA. A fictional ${s.category} used to demonstrate OCCASIO. It does not exist and cannot be applied to.`,
      description: "This listing is labelled fixture data. The organizer, link and deadline are invented for local development and demos.",
      tags: ["sample"], officialUrl: `https://example.org/${slug}`, applicationUrl: `https://example.org/${slug}/apply`,
      locationMode: s.locationMode, fee: s.fee, availability: "open",
      requirements: ["Sample requirement: a short application form"],
      deadline: { sourceText: `Applications close ${date} 23:59 (${s.tz}) [sample]`, date, time: "23:59", timezone: s.tz, rolling: false },
      rules: s.rules, eligibilityComplete: true, eligibilitySummary: s.rules.length ? s.rules[0]!.source_text : "Open to everyone (sample)",
      organizerTrust: "unassessed", sourceCheckedAt: null,
    });
    const r = await withWorker((c) => publishWithoutAward(c, draft, "fixture", { kind: "system" }, true));
    console.log(`${i + 1}. ${r.kind}: ${s.title}`);
    if (r.kind === "published") published++;
  }
  // A fixture discovery source: reads fixtures/sources/<domain>.json, never the network.
  await withWorker(async (c) => {
    const exists = await one(c, "SELECT 1 FROM source_registry WHERE domain = 'sample-listings.example'");
    if (!exists) {
      await c.query(
        `INSERT INTO source_registry(name, base_url, domain, adapter, access_review, approved_at, enabled, next_crawl_at, is_fixture)
         VALUES ('Sample listings (fixture)', 'https://sample-listings.example', 'sample-listings.example', 'fixture',
                 'Fixture source shipped in the repository. No network access; data is fictional.', now(), true, now(), true)`,
      );
      console.log("fixture discovery source added");
    }
  });
  console.log(`done: ${published} sample opportunities published (labelled is_fixture)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => closePools());
