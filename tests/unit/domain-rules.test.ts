import { describe, expect, it } from "vitest";
import { findDates, findDeadline } from "@/adapters/extractor";
import { buildDeadline, describeDeadline, planningCutoff } from "@/domain/deadlines";
import { evaluate, type EligibilityRule, type UserEligibility } from "@/domain/eligibility";
import { parseQuery } from "@/domain/matching";
import { applyQuietHours } from "@/domain/reminders";
import { normalizeUrl, safeReturnPath } from "@/lib/urls";
import { zonedToUtc } from "@/lib/time";

describe("deadlines", () => {
  it("converts a zoned instant with DST awareness", () => {
    expect(zonedToUtc("2026-07-01", "17:00", "Europe/London").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "17:00", "Europe/London").toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "23:59", "Africa/Lagos").toISOString()).toBe("2026-12-01T22:59:00.000Z");
  });
  it("never invents a timezone: date-only without zone uses the earliest end of that day anywhere", () => {
    const d = buildDeadline({ sourceText: "Closes 5 Dec 2026", date: "2026-12-05", time: null, timezone: null });
    expect(d.precision).toBe("date_only");
    expect(d.utc_instant).toBeNull();
    expect(planningCutoff(d)).toEqual({ at: new Date("2026-12-05T09:59:59Z"), estimated: true });
    expect(describeDeadline(d).caution).toMatch(/hasn't specified a timezone/);
  });
  it("a time without a timezone is still date-only", () => {
    expect(buildDeadline({ sourceText: "5 Dec 17:00", date: "2026-12-05", time: "17:00", timezone: null }).precision).toBe("date_only");
  });
  it("rolling and unknown have no cutoff", () => {
    expect(planningCutoff(buildDeadline({ sourceText: "Rolling", date: null, time: null, timezone: null, rolling: true }))).toBeNull();
    expect(planningCutoff(buildDeadline({ sourceText: "", date: null, time: null, timezone: null }))).toBeNull();
  });
});

describe("extractor date finding", () => {
  it("never guesses a missing year", () => {
    const [d] = findDates("Applications close 5 December at 17:00");
    expect(d?.date).toBeNull();
    expect(d?.yearMissing).toBe(true);
  });
  it("finds a cued deadline with time and an unambiguous zone", () => {
    const d = findDeadline("Kickoff on 1 Nov 2026. Applications close 5 December 2026 at 5:00 pm UTC.");
    expect(d).toMatchObject({ date: "2026-12-05", time: "17:00", timezone: "UTC" });
  });
  it("ignores ambiguous abbreviations like IST", () => {
    const d = findDeadline("Deadline: 5 December 2026 at 17:00 IST");
    expect(d?.timezone).toBeNull();
  });
});

describe("eligibility", () => {
  const u: UserEligibility = { residence_country: "NG", citizenships: ["NG"], education_level: null, age_band: "18_24", experience_level: null };
  const rule = (o: Partial<EligibilityRule>): EligibilityRule => ({ rule_type: "residence_country", operator: "in", operand: ["NG", "GH"], source_text: "x", is_hard: true, ...o });
  it("eligible when every hard rule passes", () => expect(evaluate([rule({})], u).outcome).toBe("eligible"));
  it("ineligible when any hard rule fails", () => expect(evaluate([rule({ operand: ["KE"] })], u).outcome).toBe("ineligible"));
  it("unknown when the profile lacks the answer (never assumed eligible)", () =>
    expect(evaluate([rule({ rule_type: "education_level", operand: ["graduate"] })], u).outcome).toBe("unknown"));
});

describe("matching query parsing", () => {
  it("extracts category and constraints", () => {
    expect(parseQuery("remote fintech hackathon with no fee")).toMatchObject({ category: "hackathon", remote: true, free: true });
  });
});

describe("quiet hours", () => {
  it("moves a reminder inside quiet hours earlier, never later", () => {
    const due = new Date("2026-12-01T23:30:00Z");
    const out = applyQuietHours(due, "UTC", "22:00", "07:00");
    expect(out.getTime()).toBeLessThan(due.getTime());
    expect(out.toISOString()).toBe("2026-12-01T21:59:00.000Z");
  });
});

describe("urls", () => {
  it("strips tracking params and normalises host", () => {
    expect(normalizeUrl("https://WWW.Example.com/apply/?utm_source=x&b=2&a=1#top")).toBe("https://example.com/apply?a=1&b=2");
  });
  it("rejects open redirects", () => {
    expect(safeReturnPath("//evil.com")).toBe("/home");
    expect(safeReturnPath("https://evil.com")).toBe("/home");
    expect(safeReturnPath("/applications")).toBe("/applications");
  });
});
