import { z } from "zod";
import { productRules } from "@/config/product-rules";
import { type Db, many, one } from "@/db/tx";
import { audit, emit } from "./audit";
import { CATEGORIES, type Category } from "./catalog";
import { planningCutoff, type DeadlineRecord } from "./deadlines";
import { evaluate, type EligibilityRule, type UserEligibility } from "./eligibility";
import { DomainError, fail } from "./errors";

export const matchInput = z.object({
  query: z.string().trim().max(500).default(""),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  remoteOnly: z.boolean().default(false),
  freeOnly: z.boolean().default(false),
});
export type MatchInput = z.infer<typeof matchInput>;

const STOP = new Set("a an the for in on of to and or with me my i im i'm looking want find need any some something opportunity opportunities".split(" "));

/** Parses free text into structured constraints. Deterministic and explainable. */
export function parseQuery(q: string): { category: Category | null; remote: boolean; free: boolean; keywords: string[] } {
  const t = q.toLowerCase();
  const syn: [Category, RegExp][] = [
    ["hackathon", /hackathon|hack\b/], ["scholarship", /scholarship|tuition|study abroad|masters?|degree/],
    ["fellowship", /fellowship/], ["grant", /\bgrants?\b|funding/], ["internship", /internship|intern\b/],
    ["job", /\bjobs?\b|role|position|work/], ["accelerator", /accelerator|incubator/],
    ["competition", /competition|contest|challenge|prize/], ["event", /event|conference|summit|workshop/],
  ];
  const category = syn.find(([, re]) => re.test(t))?.[0] ?? null;
  const keywords = t.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 8);
  return { category, remote: /remote|online|virtual/.test(t), free: /free|no (application )?fee/.test(t), keywords };
}

type Candidate = {
  id: string; title: string; category: Category; summary: string | null; tags: string[]; location_mode: string;
  fee: string; availability: string; last_successful_check_at: Date | null; revision: number; organizer_trust: string;
  eligibility_complete: boolean; redemption_blockers: string[]; publication: string; deadline: DeadlineRecord | null;
  rules: EligibilityRule[] | null; requirements: string[];
};

const CANDIDATE_SQL = `
  SELECT o.id, o.title, o.category, o.summary, o.tags, o.location_mode, o.fee, o.availability,
         o.last_successful_check_at, o.revision, g.trust AS organizer_trust, o.eligibility_complete,
         o.redemption_blockers, o.publication, o.requirements,
         (SELECT row_to_json(d) FROM opportunity_deadlines d WHERE d.opportunity_id = o.id AND d.is_current AND d.kind = 'application' LIMIT 1) AS deadline,
         (SELECT json_agg(json_build_object('rule_type', r.rule_type, 'operator', r.operator, 'operand', r.operand,
                  'source_text', r.source_text, 'is_hard', r.is_hard)) FROM eligibility_rules r WHERE r.opportunity_id = o.id) AS rules
    FROM opportunities o JOIN organizers g ON g.id = o.organizer_id`;

export type Gate = { ok: true } | { ok: false; reason: string };

/**
 * Redemption gate — evaluated at candidate selection AND again inside the
 * redemption transaction. Every condition is about whether we can stand
 * behind charging a credit for this record right now.
 */
export function redeemableGate(o: Candidate, now = new Date()): Gate {
  const p = productRules.proposed;
  if (o.publication !== "published") return { ok: false, reason: "Not currently published" };
  if (!["open", "rolling"].includes(o.availability)) return { ok: false, reason: "Not confirmed open" };
  if (o.redemption_blockers.length) return { ok: false, reason: o.redemption_blockers[0]! };
  if (!o.eligibility_complete) return { ok: false, reason: "Eligibility not fully confirmed" };
  if (o.organizer_trust === "concern" || o.organizer_trust === "blocked") return { ok: false, reason: "Organizer under review" };
  const checked = o.last_successful_check_at ? new Date(o.last_successful_check_at).getTime() : 0;
  if (now.getTime() - checked > p.redemptionFreshnessHours * 3_600_000) return { ok: false, reason: "Source check is stale" };
  const d = o.deadline;
  if (!d || d.precision === "unknown") return { ok: false, reason: "Deadline not confirmed" };
  const cut = planningCutoff(d);
  if (cut) {
    if (cut.at.getTime() <= now.getTime()) return { ok: false, reason: "Deadline has passed" };
    if (d.precision !== "instant" && cut.at.getTime() - now.getTime() < p.ambiguousDeadlineExclusionHours * 3_600_000) {
      return { ok: false, reason: "Ambiguous deadline too close to closing" };
    }
  }
  return { ok: true };
}

function score(o: Candidate, parsed: ReturnType<typeof parseQuery>, prefs: { interests: string[]; categories: string[]; remote_ok: boolean; free_only: boolean }, now: Date) {
  const w = productRules.proposed.rankingWeights;
  const hay = `${o.title} ${o.summary ?? ""} ${o.tags.join(" ")}`.toLowerCase();
  const kw = parsed.keywords.length ? parsed.keywords.filter((k) => hay.includes(k)).length / parsed.keywords.length : 0.5;
  const interests = prefs.interests.length ? prefs.interests.filter((i) => hay.includes(i.toLowerCase())).length / prefs.interests.length : 0.3;
  const interest = Math.max(kw, interests);
  const goal = parsed.category ? (o.category === parsed.category ? 1 : 0) : prefs.categories.includes(o.category) ? 1 : 0.4;
  const quality = (o.organizer_trust === "supported" ? 0.6 : 0.3) + (o.fee !== "unknown" ? 0.2 : 0) + (o.summary ? 0.2 : 0);
  const cut = o.deadline ? planningCutoff(o.deadline) : null;
  const daysLeft = cut ? (cut.at.getTime() - now.getTime()) / 86_400_000 : 30;
  // Enough time to prepare well scores highest; "closes soon" does not win by default.
  const feasibility = daysLeft >= 14 ? 1 : daysLeft >= 7 ? 0.8 : daysLeft >= 3 ? 0.5 : 0.2;
  const preference = (prefs.remote_ok || o.location_mode !== "remote" ? 0.5 : 0) + (!prefs.free_only || o.fee === "free" ? 0.5 : 0);
  const total = w.interest * interest + w.goal * goal + w.quality * quality + w.feasibility * feasibility + w.preference * preference;
  return { total: Math.round(total * 1000) / 1000, factors: { interest, goal, quality, feasibility, preference } };
}

/**
 * Creates a match request and selects a candidate. Never debits: the user
 * reviews the fit first and explicitly unlocks it.
 */
export async function createMatch(c: Db, userId: string, raw: MatchInput, now = new Date()) {
  const input = matchInput.parse(raw);
  const parsed = parseQuery(input.query);
  const category = input.category ?? parsed.category;
  const prefs = (await one(c, "SELECT interests, categories, remote_ok, free_only FROM user_preferences WHERE user_id = $1", [userId])) ?? {
    interests: [], categories: [], remote_ok: true, free_only: false,
  };
  const elig = ((await one<UserEligibility>(
    c, "SELECT residence_country, citizenships, education_level, age_band, experience_level FROM user_eligibility WHERE user_id = $1", [userId],
  )) ?? { residence_country: null, citizenships: null, education_level: null, age_band: null, experience_level: null }) as UserEligibility;

  const params: unknown[] = [userId];
  const where = [
    "o.publication = 'published'",
    "o.availability IN ('open','rolling')",
    "NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = $1 AND e.opportunity_id = o.id)",
  ];
  if (category) { params.push(category); where.push(`o.category = $${params.length}`); }
  if (input.remoteOnly || parsed.remote) where.push("o.location_mode = 'remote'");
  if (input.freeOnly || parsed.free || prefs.free_only) where.push("o.fee = 'free'");
  const rows = await many<Candidate>(c, `${CANDIDATE_SQL} WHERE ${where.join(" AND ")} LIMIT 300`, params);

  const excluded: Record<string, number> = {};
  const unknownElig: { o: Candidate; questions: string[] }[] = [];
  const scored: { o: Candidate; s: ReturnType<typeof score>; reasons: string[] }[] = [];
  for (const o of rows) {
    const gate = redeemableGate(o, now);
    if (!gate.ok) { excluded[gate.reason] = (excluded[gate.reason] ?? 0) + 1; continue; }
    const e = evaluate(o.rules ?? [], elig);
    if (e.outcome === "ineligible") { excluded["Doesn't fit your eligibility"] = (excluded["Doesn't fit your eligibility"] ?? 0) + 1; continue; }
    if (e.outcome === "unknown") {
      unknownElig.push({ o, questions: e.results.filter((r) => r.outcome === "unknown").map((r) => r.reason) });
      continue;
    }
    const s = score(o, parsed, prefs, now);
    scored.push({ o, s, reasons: e.results.filter((r) => r.outcome === "eligible").map((r) => r.reason) });
  }
  scored.sort((a, b) => b.s.total - a.s.total);
  const mr = await one<{ id: string }>(
    c,
    `INSERT INTO match_requests(user_id, query_text, constraints, state) VALUES ($1,$2,$3,'open') RETURNING id`,
    [userId, input.query || null, JSON.stringify({ category, remote: input.remoteOnly || parsed.remote, free: input.freeOnly || parsed.free || prefs.free_only, keywords: parsed.keywords })],
  );
  const id = mr!.id;
  for (const [i, x] of scored.slice(0, 5).entries()) {
    await c.query(
      `INSERT INTO match_candidates(match_request_id, opportunity_id, revision, eligibility, score, reasons, rank) VALUES ($1,$2,$3,'eligible',$4,$5,$6)`,
      [id, x.o.id, x.o.revision, x.s.total, JSON.stringify({ factors: x.s.factors, eligibility: x.reasons }), i + 1],
    );
  }
  if (scored.length) {
    const top = scored[0]!;
    const why = explain(top.o, top.s.factors, top.reasons, category);
    await c.query(
      "UPDATE match_requests SET state = 'candidate_ready', selected_opportunity_id = $2, selected_revision = $3, explanation = $4 WHERE id = $1",
      [id, top.o.id, top.o.revision, JSON.stringify(why)],
    );
  } else if (unknownElig.length) {
    const qs = [...new Set(unknownElig.flatMap((u) => u.questions))].slice(0, 4);
    await c.query("UPDATE match_requests SET state = 'needs_clarification', clarifications = $2, explanation = $3 WHERE id = $1", [
      id, qs, JSON.stringify({ excluded, unknownCount: unknownElig.length }),
    ]);
  } else {
    await c.query("UPDATE match_requests SET state = 'no_match', explanation = $2 WHERE id = $1", [id, JSON.stringify({ excluded, considered: rows.length })]);
  }
  await audit(c, { kind: "user", id: userId }, "match.requested", "match_request", id);
  return id;
}

function explain(o: Candidate, f: Record<string, number>, eligibilityReasons: string[], category: string | null) {
  const out: string[] = [];
  if (category && o.category === category) out.push(`It's a ${o.category}, which is what you asked for.`);
  if ((f.interest ?? 0) >= 0.5) out.push("It matches the interests and words you gave us.");
  if (o.location_mode === "remote") out.push("You can take part remotely.");
  if (o.fee === "free") out.push("The source says there's no application fee.");
  if ((f.feasibility ?? 0) >= 0.8) out.push("There's enough time to prepare a strong application.");
  else out.push("Time is short. Plan to start today.");
  return { reasons: out, eligibility: eligibilityReasons, requirements: o.requirements.slice(0, 5) };
}

export async function getMatch(c: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await one(c, "SELECT * FROM match_requests WHERE id = $1", [id])) ?? null;
}

export type RedeemResult = { entitlementId: string; opportunityId: string; charged: boolean; via: string; replay: boolean };

/**
 * Atomic redemption (master plan §4.2–4.3). In one transaction:
 * lock wallet → lock request → replay/already-unlocked checks → re-run the
 * redemption gate and eligibility on CURRENT data → create unique
 * entitlement → append debit (unique business key) → update balance → event.
 * Any failure rolls everything back, so nothing is charged.
 */
export async function redeem(c: Db, userId: string, matchRequestId: string, now = new Date()): Promise<RedeemResult> {
  const wallet = await one<{ balance: number; starter_available: boolean; frozen: boolean }>(
    c, "SELECT balance, starter_available, frozen FROM wallets WHERE user_id = $1 FOR UPDATE", [userId]);
  if (!wallet) fail("not_found", "Wallet not found.");
  if (wallet!.frozen) fail("frozen", "Redemptions are paused on your account while we review it.");
  const mr = await one(c, "SELECT * FROM match_requests WHERE id = $1 AND user_id = $2 FOR UPDATE", [matchRequestId, userId]);
  if (!mr) fail("not_found", "Match not found.");
  if (!mr.selected_opportunity_id) fail("conflict", "This request has no match to unlock.");

  const existing = await one<{ id: string; via: string; match_request_id: string | null }>(
    c, "SELECT id, via, match_request_id FROM entitlements WHERE user_id = $1 AND opportunity_id = $2", [userId, mr.selected_opportunity_id]);
  if (existing) {
    // Replay or already unlocked: never charge again.
    if (mr.state !== "redeemed") await c.query("UPDATE match_requests SET state = 'redeemed' WHERE id = $1", [matchRequestId]);
    return { entitlementId: existing.id, opportunityId: mr.selected_opportunity_id, charged: false, via: existing.via, replay: true };
  }
  if (mr.state !== "candidate_ready") fail("conflict", "This match can't be unlocked any more. Ask for a new one.");

  const o = await one<Candidate>(c, `${CANDIDATE_SQL} WHERE o.id = $1 FOR SHARE OF o`, [mr.selected_opportunity_id]);
  const gate = o ? redeemableGate(o, now) : ({ ok: false, reason: "No longer available" } as Gate);
  // Throwing rolls back the whole transaction: no entitlement, no debit.
  if (!gate.ok) {
    throw new DomainError("unavailable", `This opportunity changed since we found it (${gate.reason.toLowerCase()}). You weren't charged.`, { revalidation: gate.reason });
  }
  const elig = (await one<UserEligibility>(
    c, "SELECT residence_country, citizenships, education_level, age_band, experience_level FROM user_eligibility WHERE user_id = $1", [userId],
  ))!;
  if (evaluate(o!.rules ?? [], elig).outcome !== "eligible") {
    throw new DomainError("unavailable", "Your profile or this opportunity's rules changed, so it's no longer a confirmed fit. You weren't charged.");
  }

  let via: "credit" | "starter";
  if (wallet!.starter_available && productRules.proposed.starterMatchEnabled) via = "starter";
  else if (wallet!.balance >= productRules.proposed.creditsPerRedemption) via = "credit";
  else throw new DomainError("insufficient_credit", "You need a credit to unlock this. Share an opportunity to earn one.");

  const ent = await one<{ id: string }>(
    c,
    "INSERT INTO entitlements(user_id, opportunity_id, via, match_request_id) VALUES ($1,$2,$3,$4) RETURNING id",
    [userId, o!.id, via, matchRequestId],
  );
  if (via === "credit") {
    const entry = await one<{ id: string }>(
      c,
      `INSERT INTO credit_ledger(user_id, delta, reason, business_key, reference_id, actor_kind, actor_id, note)
       VALUES ($1,$2,'match_redemption',$3,$4,'user',$1,'Unlocked a new match') RETURNING id`,
      [userId, -productRules.proposed.creditsPerRedemption, `redeem:${ent!.id}`, ent!.id],
    );
    await c.query("UPDATE entitlements SET ledger_entry_id = $2 WHERE id = $1", [ent!.id, entry!.id]);
    // CHECK (balance >= 0) is the last line of defence against overspending.
    await c.query("UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE user_id = $1", [userId, productRules.proposed.creditsPerRedemption]);
  } else {
    await c.query("UPDATE wallets SET starter_available = false, updated_at = now() WHERE user_id = $1", [userId]);
  }
  await c.query("UPDATE match_requests SET state = 'redeemed' WHERE id = $1", [matchRequestId]);
  await emit(c, "match.redeemed.v1", matchRequestId, { opportunity_id: o!.id, via }, o!.revision);
  await audit(c, { kind: "user", id: userId }, "match.redeemed", "match_request", matchRequestId, { changes: { via, opportunity: o!.id } });
  return { entitlementId: ent!.id, opportunityId: o!.id, charged: via === "credit", via, replay: false };
}

export async function matchFeedback(c: Db, userId: string, id: string, feedback: "useful" | "not_interested") {
  await c.query("UPDATE match_requests SET feedback = $3 WHERE id = $1 AND user_id = $2", [id, userId, feedback]);
}

/**
 * Direct request from a bank preview: the same redemption gate and
 * eligibility check run for the one record the person picked. Never debits;
 * the person still confirms the unlock on the match page.
 */
export async function createDirectMatch(c: Db, userId: string, opportunityId: string, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/.test(opportunityId)) fail("not_found", "Opportunity not found.");
  const o = await one<Candidate>(c, `${CANDIDATE_SQL} WHERE o.id = $1`, [opportunityId]);
  if (!o) fail("not_found", "Opportunity not found.");
  const elig = ((await one<UserEligibility>(
    c, "SELECT residence_country, citizenships, education_level, age_band, experience_level FROM user_eligibility WHERE user_id = $1", [userId],
  )) ?? { residence_country: null, citizenships: null, education_level: null, age_band: null, experience_level: null }) as UserEligibility;
  const gate = redeemableGate(o!, now);
  const e = evaluate(o!.rules ?? [], elig);
  const mr = await one<{ id: string }>(
    c,
    "INSERT INTO match_requests(user_id, query_text, constraints, state) VALUES ($1, NULL, $2, 'open') RETURNING id",
    [userId, JSON.stringify({ direct: opportunityId })],
  );
  const id = mr!.id;
  if (!gate.ok) {
    await c.query("UPDATE match_requests SET state = 'no_match', explanation = $2 WHERE id = $1", [id, JSON.stringify({ excluded: { [gate.reason]: 1 }, considered: 1, direct: true })]);
  } else if (e.outcome === "ineligible") {
    await c.query("UPDATE match_requests SET state = 'no_match', explanation = $2 WHERE id = $1", [id, JSON.stringify({ excluded: { "Doesn't fit your eligibility": 1 }, considered: 1, direct: true, reasons: e.results.filter((r) => r.outcome === "ineligible").map((r) => r.reason) })]);
  } else if (e.outcome === "unknown") {
    await c.query("UPDATE match_requests SET state = 'needs_clarification', clarifications = $2, explanation = $3 WHERE id = $1", [
      id, e.results.filter((r) => r.outcome === "unknown").map((r) => r.reason).slice(0, 4), JSON.stringify({ direct: true, opportunity: opportunityId }),
    ]);
  } else {
    await c.query(
      `INSERT INTO match_candidates(match_request_id, opportunity_id, revision, eligibility, score, reasons, rank) VALUES ($1,$2,$3,'eligible',1,$4,1)`,
      [id, o!.id, o!.revision, JSON.stringify({ eligibility: e.results.map((r) => r.reason) })],
    );
    await c.query(
      "UPDATE match_requests SET state = 'candidate_ready', selected_opportunity_id = $2, selected_revision = $3, explanation = $4 WHERE id = $1",
      [id, o!.id, o!.revision, JSON.stringify({ reasons: ["You picked this one from the bank."], eligibility: e.results.filter((r) => r.outcome === "eligible").map((r) => r.reason), requirements: o!.requirements.slice(0, 5), direct: true })],
    );
  }
  await audit(c, { kind: "user", id: userId }, "match.requested", "match_request", id, { changes: { direct: true } });
  return id;
}
