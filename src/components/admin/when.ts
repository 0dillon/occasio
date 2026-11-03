import { formatInZone } from "@/lib/time";

/** Staff screens show UTC so reviewers in different places read the same times. */
export const when = (d: Date | string | null | undefined) => (d ? `${formatInZone(new Date(d), "UTC")} UTC` : "—");
export const ago = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
