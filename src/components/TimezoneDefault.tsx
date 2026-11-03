"use client";
import { useEffect } from "react";

/** Preselects the browser's timezone when the profile still has the default. */
export function TimezoneDefault({ selectId, current }: { selectId: string; current: string }) {
  useEffect(() => {
    if (current !== "UTC") return;
    const el = document.getElementById(selectId) as HTMLSelectElement | null;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (el && tz && [...el.options].some((o) => o.value === tz)) el.value = tz;
  }, [selectId, current]);
  return null;
}
