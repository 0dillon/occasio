/** Timezone helpers built on Intl (IANA data shipped with Node/browsers). */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second!,
  };
}

/** Offset (ms) of tz at instant d: local wall time minus UTC. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = partsInZone(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock date/time in an IANA zone to a UTC instant.
 * Handles DST by re-evaluating the offset at the candidate instant. For a
 * non-existent local time (spring-forward gap) the result moves forward.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s = 0] = time.split(":").map(Number) as [number, number, number?];
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Local wall-clock HH:MM (24h) of an instant in a zone. */
export function localTime(d: Date, tz: string): { date: string; minutes: number } {
  const p = partsInZone(d, tz);
  const date = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return { date, minutes: p.h * 60 + p.mi };
}

export function formatInZone(d: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZoneName: "short", ...opts,
  }).format(d);
}

export function formatDate(d: Date | string, tz = "UTC") {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(
    typeof d === "string" ? new Date(d) : d,
  );
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
