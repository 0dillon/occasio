"use client";
import { useEffect, useState } from "react";

/** Invite link with copy and (where supported) the phone's share sheet. */
export function InviteLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("share" in navigator), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  async function share() {
    try {
      await navigator.share({ title: "OCCASIO", text: "Open opportunities, checked on the organizer's page. Free to join.", url });
    } catch { /* closed the share sheet */ }
  }
  return (
    <div className="stack-sm">
      <label htmlFor="invite-url" className="sr-only">Your invite link</label>
      <div className="row" style={{ alignItems: "stretch", flexWrap: "wrap" }}>
        <input id="invite-url" className="input mono grow" style={{ flex: "1 1 220px" }} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn ink" onClick={copy}>Copy link</button>
        {canShare ? <button type="button" className="btn" onClick={share}>Share</button> : null}
      </div>
      <span className="meta" role="status" aria-live="polite">
        {state === "copied" ? "Copied. Send it to someone hunting for their next opening." : state === "failed" ? "Couldn't copy. Select the link and copy it yourself." : " "}
      </span>
    </div>
  );
}
