import { DAY, formatDate, formatInZone, HOUR, isValidTimeZone, zonedToUtc } from "@/lib/time";

export type Precision = "instant" | "date_only" | "rolling" | "unknown";

export type DeadlineRecord = {
  id?: string;
  kind: "registration" | "application" | "document" | "interview";
  source_text: string;
  source_local_date: string | null; // YYYY-MM-DD
  source_local_time: string | null; // HH:MM[:SS]
  timezone: string | null;
  utc_instant: Date | null;
  precision: Precision;
  revision?: number;
  verified_at?: Date | null;
};

/**
 * Builds a deadline record from source facts. It never invents a timezone or
 * a time: a date without a time is "date_only"; a time without a timezone is
 * also kept as date_only (the time is preserved as source text only).
 */
export function buildDeadline(input: {
  sourceText: string; date?: string | null; time?: string | null; timezone?: string | null; rolling?: boolean;
  kind?: DeadlineRecord["kind"];
}): DeadlineRecord {
  const kind = input.kind ?? "application";
  if (input.rolling) {
    return { kind, source_text: input.sourceText, source_local_date: null, source_local_time: null, timezone: null, utc_instant: null, precision: "rolling" };
  }
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  if (!date) {
    return { kind, source_text: input.sourceText, source_local_date: null, source_local_time: null, timezone: null, utc_instant: null, precision: "unknown" };
  }
  const time = input.time && /^\d{2}:\d{2}(:\d{2})?$/.test(input.time) ? input.time : null;
  const tz = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : null;
  if (time && tz) {
    return { kind, source_text: input.sourceText, source_local_date: date, source_local_time: time, timezone: tz, utc_instant: zonedToUtc(date, time, tz), precision: "instant" };
  }
  return { kind, source_text: input.sourceText, source_local_date: date, source_local_time: time, timezone: tz, utc_instant: null, precision: "date_only" };
}

/**
 * A conservative planning cutoff for reminders and exclusion windows. For a
 * date-only deadline with no timezone we assume the earliest possible end of
 * that calendar day anywhere (23:59:59 at UTC+14 = 09:59:59Z). This is an
 * internal estimate, labelled as such, never shown as the official close.
 */
export function planningCutoff(d: DeadlineRecord): { at: Date; estimated: boolean } | null {
  if (d.precision === "instant" && d.utc_instant) return { at: new Date(d.utc_instant), estimated: false };
  if (d.precision === "date_only" && d.source_local_date) {
    if (d.timezone) return { at: zonedToUtc(d.source_local_date, "23:59:59", d.timezone), estimated: true };
    return { at: new Date(`${d.source_local_date}T09:59:59Z`), estimated: true };
  }
  return null;
}

export type DeadlineDisplay = { primary: string; caution: string | null; precision: Precision };

/** Human statement of the official deadline: always explicit about precision. */
export function describeDeadline(d: DeadlineRecord | null | undefined, viewerTz = "UTC"): DeadlineDisplay {
  if (!d) return { primary: "No deadline recorded", caution: "Check the official source before planning.", precision: "unknown" };
  switch (d.precision) {
    case "instant":
      return {
        primary: `${formatInZone(new Date(d.utc_instant!), d.timezone!)}`,
        caution: d.timezone !== viewerTz ? `That's ${formatInZone(new Date(d.utc_instant!), viewerTz)} your time.` : null,
        precision: "instant",
      };
    case "date_only":
      return {
        primary: formatDate(`${d.source_local_date}T12:00:00Z`, "UTC"),
        caution: d.timezone
          ? `The organizer gives a date but no closing time (${d.timezone}). Plan to submit early.`
          : "The organizer hasn't specified a timezone. Plan to submit early.",
        precision: "date_only",
      };
    case "rolling":
      return { primary: "Rolling applications", caution: "No fixed closing date. Rounds can close without notice.", precision: "rolling" };
    default:
      return { primary: "Deadline not confirmed", caution: "We couldn't confirm a closing date from the source.", precision: "unknown" };
  }
}

/** Time left until the planning cutoff, as a supplement to the explicit date. */
export function timeLeft(d: DeadlineRecord | null | undefined, now = new Date()): string | null {
  const cut = d ? planningCutoff(d) : null;
  if (!cut) return null;
  const ms = cut.at.getTime() - now.getTime();
  if (ms <= 0) return "Closed";
  if (ms < HOUR) return "Under an hour left";
  if (ms < DAY) return `${Math.floor(ms / HOUR)} hours left`;
  const days = Math.floor(ms / DAY);
  return `${days} day${days === 1 ? "" : "s"} left${cut.estimated ? " (estimate)" : ""}`;
}
