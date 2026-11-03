import { z } from "zod";
import { excerptAround, type PageData } from "@/lib/html";
import { CATEGORIES, type Category } from "@/domain/catalog";

/**
 * Extraction contract (master plan §10.4). A schema-valid result is NOT proof
 * that facts are true; every field carries where it came from, and nulls stay
 * null when information is missing. Extractors have no tools and no side
 * effects: they cannot publish, award credits or send anything.
 */
export const extractionSchema = z.object({
  schema_version: z.literal("1"),
  extractor: z.string(),
  title: z.object({ value: z.string().max(200).nullable(), origin: z.string(), excerpt: z.string().nullable() }),
  organizer: z.object({ value: z.string().max(120).nullable(), origin: z.string() }),
  category: z.object({ value: z.enum(CATEGORIES).nullable(), origin: z.string() }),
  deadline: z.object({
    source_text: z.string().nullable(),
    local_date: z.string().nullable(),
    local_time: z.string().nullable(),
    timezone: z.string().nullable(),
    rolling: z.boolean(),
    origin: z.string(),
    excerpt: z.string().nullable(),
  }),
  location_mode: z.enum(["remote", "hybrid", "on_site", "unknown"]),
  fee: z.object({ status: z.enum(["free", "paid", "unknown"]), text: z.string().nullable(), excerpt: z.string().nullable() }),
  summary: z.string().max(600).nullable(),
  conflicts: z.array(z.string()),
  missing_information: z.array(z.string()),
  risk_flags: z.array(z.string()),
});
export type Extraction = z.infer<typeof extractionSchema>;

export type ExtractInput = {
  page: PageData | null;
  pageUrl: string | null;
  claims: { title: string | null; organizer: string | null; category: Category | null; deadline_text: string | null };
  hasPoster: boolean;
  now: Date;
};

export interface Extractor {
  name: string;
  extract(input: ExtractInput): Promise<Extraction>;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const TZ_ABBR: Record<string, string> = {
  wat: "Africa/Lagos", gmt: "UTC", utc: "UTC", eat: "Africa/Nairobi", cat: "Africa/Maputo", sast: "Africa/Johannesburg",
  est: "America/New_York", edt: "America/New_York", et: "America/New_York", pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles", pt: "America/Los_Angeles", cet: "Europe/Berlin", cest: "Europe/Berlin",
  bst: "Europe/London", aoe: "Etc/GMT+12", "anywhere on earth": "Etc/GMT+12",
};
// Deliberately excluded as ambiguous: IST (India/Ireland/Israel), CST (US/China), AST.

const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
const pad = (n: number) => String(n).padStart(2, "0");

export type FoundDate = { date: string | null; time: string | null; timezone: string | null; text: string; index: number; yearMissing: boolean };

/** Finds explicit dates. Never guesses a missing year. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const res = [
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}\\.?,?\\s*(\\d{4})?`, "gi"),
    new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})?`, "gi"),
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  ];
  for (const [i, re] of res.entries()) {
    for (const m of text.matchAll(re)) {
      let y: number | null, mo: number, d: number;
      if (i === 0) { d = +m[1]!; mo = monthIndex(m[2]!); y = m[3] ? +m[3] : null; }
      else if (i === 1) { mo = monthIndex(m[1]!); d = +m[2]!; y = m[3] ? +m[3] : null; }
      else { y = +m[1]!; mo = +m[2]! - 1; d = +m[3]!; }
      if (mo < 0 || d < 1 || d > 31) continue;
      const tail = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
      const tm = tail.match(/^\s*(?:at|,|by|before)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(?\s*([a-z]{2,4}|anywhere on earth)?\b/i);
      let time: string | null = null;
      let tz: string | null = null;
      if (tm && (tm[2] || tm[3])) {
        let h = +tm[1]!;
        if (tm[3]?.toLowerCase() === "pm" && h < 12) h += 12;
        if (tm[3]?.toLowerCase() === "am" && h === 12) h = 0;
        if (h <= 23) time = `${pad(h)}:${tm[2] ?? "00"}`;
        tz = tm[4] ? TZ_ABBR[tm[4].toLowerCase()] ?? null : null;
      }
      out.push({
        date: y ? `${y}-${pad(mo + 1)}-${pad(d)}` : null, time, timezone: tz,
        text: (m[0] + (tm?.[0] ?? "")).trim(), index: m.index!, yearMissing: !y,
      });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_CUE = /(deadline|closes?|closing|apply by|applications? (?:close|due|end)|due (?:date|by)|submit by|last day|until)/gi;

export function findDeadline(text: string): FoundDate & { excerpt: string } | null {
  let best: (FoundDate & { excerpt: string; dist: number }) | null = null;
  const dates = findDates(text);
  for (const cue of text.matchAll(DEADLINE_CUE)) {
    for (const d of dates) {
      const dist = d.index - cue.index!;
      if (dist >= 0 && dist < 140 && (!best || dist < best.dist)) best = { ...d, excerpt: excerptAround(text, d.index), dist };
    }
  }
  return best;
}

function guessCategory(text: string): Category | null {
  const t = text.toLowerCase();
  const pairs: [Category, RegExp][] = [
    ["hackathon", /hackathon|hack day|buildathon/], ["scholarship", /scholarship|tuition|bursary/],
    ["fellowship", /fellowship|fellows programme|fellows program/], ["grant", /\bgrants?\b|funding call|seed fund/],
    ["internship", /internship|intern\b/], ["accelerator", /accelerator|incubator|cohort for startups/],
    ["competition", /competition|challenge|contest|prize/], ["job", /\bjob\b|vacancy|we're hiring|full-time role/],
    ["event", /conference|summit|workshop|bootcamp|meetup/],
  ];
  return pairs.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** Deterministic extractor used when no model is configured. Labelled as such everywhere. */
export const ruleBasedExtractor: Extractor = {
  name: "rule-based-v1 (no AI)",
  async extract({ page, claims, now }) {
    const text = page?.text ?? "";
    const conflicts: string[] = [];
    const missing: string[] = [];
    const risks: string[] = [];

    const ogTitle = page?.meta["og:title"] ?? null;
    const titleVal = ogTitle || page?.title || claims.title;
    const title = {
      value: titleVal ? titleVal.slice(0, 200) : null,
      origin: ogTitle || page?.title ? "source_page" : claims.title ? "user_claim" : "none",
      excerpt: titleVal ?? null,
    };
    if (!title.value) missing.push("title");

    const site = page?.meta["og:site_name"] ?? null;
    const organizer = { value: (site || claims.organizer || null)?.slice(0, 120) ?? null, origin: site ? "source_page" : claims.organizer ? "user_claim" : "none" };
    if (!organizer.value) missing.push("organizer");
    if (site && claims.organizer && !site.toLowerCase().includes(claims.organizer.toLowerCase().slice(0, 6))) {
      conflicts.push(`Organizer on page ("${site}") differs from the one you entered ("${claims.organizer}")`);
    }

    const pageCat = guessCategory(`${title.value ?? ""} ${text.slice(0, 5000)}`);
    const category = { value: claims.category ?? pageCat, origin: claims.category ? "user_claim" : pageCat ? "source_page" : "none" };

    const rolling = /rolling (basis|applications|admissions)/i.test(text);
    const found = text ? findDeadline(text) : null;
    const claimFound = claims.deadline_text ? findDates(claims.deadline_text)[0] ?? null : null;
    let deadline: Extraction["deadline"] = { source_text: null, local_date: null, local_time: null, timezone: null, rolling, origin: "none", excerpt: null };
    if (found) {
      deadline = { source_text: found.text, local_date: found.date, local_time: found.time, timezone: found.timezone, rolling, origin: "source_page", excerpt: found.excerpt };
      if (found.yearMissing) missing.push("deadline_year");
      if (claimFound?.date && found.date && claimFound.date !== found.date) {
        conflicts.push(`Deadline on page (${found.text}) differs from the poster/claim (${claimFound.text})`);
      }
    } else if (claimFound) {
      deadline = { source_text: claimFound.text, local_date: claimFound.date, local_time: claimFound.time, timezone: claimFound.timezone, rolling, origin: "user_claim", excerpt: null };
      if (claimFound.yearMissing) missing.push("deadline_year");
    } else if (!rolling) {
      missing.push("deadline");
    }
    if (deadline.local_date && !deadline.timezone) missing.push("deadline_timezone");
    if (deadline.local_date && new Date(`${deadline.local_date}T23:59:59Z`).getTime() + 14 * 3_600_000 < now.getTime()) {
      conflicts.push("The deadline found appears to have passed");
    }

    const lower = text.toLowerCase();
    const location_mode = /\bhybrid\b/.test(lower) ? "hybrid" : /\b(remote|online|virtual)\b/.test(lower) ? "remote" : /\b(in-person|on-site|onsite)\b/.test(lower) ? "on_site" : "unknown";

    let fee: Extraction["fee"] = { status: "unknown", text: null, excerpt: null };
    const free = lower.search(/(no application fee|free to apply|free of charge|no fee)/);
    const paid = lower.search(/application fee/);
    if (free >= 0) fee = { status: "free", text: "No application fee stated", excerpt: excerptAround(text, free) };
    else if (paid >= 0) fee = { status: "paid", text: "Application fee mentioned", excerpt: excerptAround(text, paid) };

    if (/(western union|gift card|bitcoin|send (the )?money|processing fee to)/i.test(text)) risks.push("Unusual payment instructions on the page");
    if (/(guaranteed (selection|admission|funding)|100% (acceptance|guaranteed))/i.test(text)) risks.push("Page promises guaranteed outcomes");

    const summary = (page?.meta["og:description"] ?? page?.meta["description"] ?? null)?.slice(0, 600) ?? null;
    return extractionSchema.parse({
      schema_version: "1", extractor: this.name, title, organizer, category, deadline, location_mode, fee, summary,
      conflicts, missing_information: [...new Set(missing)], risk_flags: risks,
    });
  },
};

export function getExtractor(): Extractor {
  // A model-backed extractor plugs in here behind the same contract once a
  // provider is configured and evaluated (see docs/BUILD_STATUS.md).
  return ruleBasedExtractor;
}
