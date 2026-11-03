"use client";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Icon } from "@/components/Icon";

type UnreadRow = { id: string };

function BellLink({ unread }: { unread: number }) {
  return (
    <Link href="/notifications" className="bell" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
      <Icon name="bell" />
      {unread ? <span className="dot" /> : null}
    </Link>
  );
}

/** Static bell, used when live updates are not configured. */
export function StaticBell({ unread }: { unread: number }) {
  return <BellLink unread={unread} />;
}

function LiveCount({ sealed, userId, initial }: { sealed: SealedLiveQuery<UnreadRow>; userId: string; initial: number }) {
  const refreshQuery = useCallback(async () => {
    const res = await fetch("/api/v1/live/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.status === 401 || res.status === 409) {
      // Signed out or a different account in another tab: leave with a full load.
      window.location.assign("/auth/sign-in");
    }
    if (!res.ok) throw new Error(`renew failed: ${res.status}`);
    return (await res.json()) as SealedLiveQuery<UnreadRow>;
  }, [userId]);
  const { data, status } = useLiveQuery(sealed, { refreshQuery });
  // Until the first live result (or if live updates stop), show the server count.
  const unread = status !== "error" && data ? data.length : initial;
  return <BellLink unread={unread} />;
}

/** Notification bell whose unread dot updates live through Neon Realtime. */
export function LiveBell({ url, sealed, userId, initial }: { url: string; sealed: SealedLiveQuery<UnreadRow>; userId: string; initial: number }) {
  const [client] = useState(() => createRealtimeClient({ url }));
  return (
    <RealtimeProvider client={client}>
      <LiveCount sealed={sealed} userId={userId} initial={initial} />
    </RealtimeProvider>
  );
}
