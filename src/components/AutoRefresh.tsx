"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders server data while a background check runs. Stops when the page changes state. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return <p className="sr-only" aria-live="polite">Checking. This page updates automatically.</p>;
}
