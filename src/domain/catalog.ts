import { z } from "zod";
import { type Db, many, one } from "@/db/tx";
import type { DeadlineRecord } from "./deadlines";
import type { EligibilityRule } from "./eligibility";

export const CATEGORIES = [
  "hackathon", "scholarship", "grant", "fellowship", "job", "internship",
  "competition", "accelerator", "event", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  hackathon: "Hackathon", scholarship: "Scholarship", grant: "Grant", fellowship: "Fellowship", job: "Job",
  internship: "Internship", competition: "Competition", accelerator: "Accelerator", event: "Event", other: "Other",
};

export type OpportunityPreview = {
  id: string;
  title: string;
  category: Category;
  organizer: string;
  organizer_trust: string;
  summary: string | null;
  tags: string[];
  location_mode: string;
  location_text: string | null;
  fee: string;
  availability: string;
  availability_checked_at: Date | null;
  last_successful_check_at: Date | null;
  publication: string;
  redemption_blockers: string[];
  eligibility_summary: string | null;
  eligibility_complete: boolean;
  is_fixture: boolean;
  origin: string;
  revision: number;
  deadline: DeadlineRecord | null;
  unlocked: boolean;
};

export type OpportunityDetail = OpportunityPreview & {
  description: string | null;
  official_url: string | null;
  application_url: string;
  fee_text: string | null;
  benefits_text: string | null;
  requirements: string[];
  rules: EligibilityRule[];
  sources: { url: string; role: string; fetched_at: Date | null; outcome: string | null; excerpt: string | null }[];
  deadlines: DeadlineRecord[];
};

export const searchSchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  remote: z.enum(["1"]).optional().catch(undefined),
  free: z.enum(["1"]).optional().catch(undefined),
  open: z.enum(["1"]).optional().catch(undefined),
  cursor: z.string().max(80).optional(),
});
export type SearchInput = z.infer<typeof searchSchema>;

const PREVIEW_COLUMNS = `
  o.id, o.title, o.category, g.name AS organizer, g.trust AS organizer_trust, o.summary, o.tags,
  o.location_mode, o.location_text, o.fee, o.availability, o.availability_checked_at,
  o.last_successful_check_at, o.publication, o.redemption_blockers, o.eligibility_summary,
  o.eligibility_complete, o.is_fixture, o.origin, o.revision,
  (SELECT row_to_json(d) FROM opportunity_deadlines d
     WHERE d.opportunity_id = o.id AND d.is_current AND d.kind = 'application' LIMIT 1) AS deadline`;

function rowToPreview(r: any, unlocked: boolean): OpportunityPreview {
  return { ...r, deadline: r.deadline ?? null, unlocked };
}

/**
 * Bank previews. Only published records; links and full requirements stay
 * behind entitlement. Cursor pagination on (published_at, id).
 */
export async function searchBank(c: Db, input: SearchInput, userId: string | null, limit = 24) {
  const params: unknown[] = [];
  const where = ["o.publication = 'published'"];
  if (input.q) {
    params.push(input.q);
    where.push(`o.search @@ websearch_to_tsquery('english', $${params.length})`);
  }
  if (input.category) {
    params.push(input.category);
    where.push(`o.category = $${params.length}`);
  }
  if (input.remote) where.push("o.location_mode = 'remote'");
  if (input.free) where.push("o.fee = 'free'");
  if (input.open) where.push("o.availability IN ('open', 'rolling')");
  if (input.cursor) {
    const [ts, id] = input.cursor.split("_");
    if (ts && id && /^[0-9a-f-]{36}$/.test(id) && /^\d+$/.test(ts)) {
      params.push(new Date(Number(ts)), id);
      where.push(`(o.published_at, o.id) < ($${params.length - 1}, $${params.length})`);
    }
  }
  params.push(limit + 1);
  const rows = await many(
    c,
    `SELECT ${PREVIEW_COLUMNS}, o.published_at
       FROM opportunities o JOIN organizers g ON g.id = o.organizer_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${input.q ? `ts_rank(o.search, websearch_to_tsquery('english', $1)) DESC,` : ""} o.published_at DESC, o.id DESC
      LIMIT $${params.length}`,
    params,
  );
  const unlocked = userId ? await unlockedSet(c, userId, rows.map((r) => r.id)) : new Set<string>();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => rowToPreview(r, unlocked.has(r.id))),
    nextCursor: rows.length > limit && last && !input.q ? `${new Date(last.published_at).getTime()}_${last.id}` : null,
  };
}

export async function unlockedSet(c: Db, userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await many<{ opportunity_id: string }>(
    c, "SELECT opportunity_id FROM entitlements WHERE user_id = $1 AND opportunity_id = ANY($2)", [userId, ids]);
  return new Set(rows.map((r) => r.opportunity_id));
}

export async function getPreview(c: Db, id: string, userId: string | null, staff = false): Promise<OpportunityPreview | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await one(
    c,
    `SELECT ${PREVIEW_COLUMNS} FROM opportunities o JOIN organizers g ON g.id = o.organizer_id
      WHERE o.id = $1 ${staff ? "" : "AND o.publication IN ('published', 'archived')"}`,
    [id],
  );
  if (!r) return null;
  const unlocked = userId ? (await unlockedSet(c, userId, [id])).has(id) : false;
  return rowToPreview(r, unlocked);
}

/**
 * Full detail for any signed-in member (D12: the board is free). Published and
 * archived records are visible to everyone signed in; a withdrawn ("hidden")
 * record stays visible only to people who saved it before, and to staff, so
 * corrections and withdrawals still reach them.
 */
export async function getDetail(c: Db, id: string, userId: string | null, staff = false): Promise<OpportunityDetail | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  if (!userId && !staff) return null;
  const pub = await one<{ publication: string }>(c, "SELECT publication FROM opportunities WHERE id = $1", [id]);
  if (!pub) return null;
  const entitled = userId ? (await unlockedSet(c, userId, [id])).has(id) : false;
  const visible = staff || entitled || pub.publication === "published" || pub.publication === "archived";
  if (!visible) return null;
  const r = await one(
    c,
    `SELECT ${PREVIEW_COLUMNS}, o.description, o.official_url, o.application_url, o.fee_text,
            o.benefits_text, o.requirements
       FROM opportunities o JOIN organizers g ON g.id = o.organizer_id WHERE o.id = $1`,
    [id],
  );
  if (!r) return null;
  const rules = await many<EligibilityRule>(
    c, "SELECT rule_type, operator, operand, source_text, is_hard FROM eligibility_rules WHERE opportunity_id = $1", [id]);
  const sources = await many(
    c,
    `SELECT s.url, s.role, e.fetched_at, e.outcome, e.excerpt
       FROM opportunity_sources s LEFT JOIN evidence_snapshots e ON e.id = s.latest_evidence_id
      WHERE s.opportunity_id = $1 ORDER BY s.role`,
    [id],
  );
  const deadlines = await many<DeadlineRecord>(
    c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current ORDER BY kind", [id]);
  return { ...(r as Omit<OpportunityDetail, "rules" | "sources" | "deadlines">), ...rowToPreview(r, entitled), rules, sources, deadlines };
}

/** Plain-language trust/freshness statements; never a single "verified" badge. */
export function trustStatements(o: OpportunityPreview, now = new Date()): string[] {
  const out: string[] = [];
  const checked = o.last_successful_check_at ? new Date(o.last_successful_check_at) : null;
  const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d);
  const avail: Record<string, string> = {
    open: "Applications open", rolling: "Rolling applications", upcoming: "Opens soon", closed: "Applications closed", unknown: "Availability not confirmed",
  };
  out.push(`${avail[o.availability] ?? "Availability not confirmed"}${checked ? `; checked ${day(checked)}` : "; not yet checked"}`);
  if (checked && now.getTime() - checked.getTime() > 72 * 3_600_000) out.push("Source check is more than three days old");
  if (o.organizer_trust === "unassessed") out.push("Organizer identity not yet reviewed");
  if (o.organizer_trust === "concern") out.push("Organizer identity needs review");
  if (o.fee === "unknown") out.push("Application fee not confirmed");
  if (o.fee === "paid") out.push("Application fee required");
  if (!o.eligibility_complete) out.push("Eligibility not fully confirmed");
  return out;
}
