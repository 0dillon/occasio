import Link from "next/link";
import type { ReactNode } from "react";
import { resendVerificationAction } from "@/app/actions/auth";
import { ActionForm, Submit } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { LiveBell, StaticBell } from "@/components/LiveBell";
import { Logo } from "@/components/Logo";
import { DesktopNav, MobileNav } from "@/components/Nav";
import { Footer } from "@/components/PublicHeader";
import { one } from "@/db/tx";
import { liveEnabled, sealUnread } from "@/server/live";
import { asSelf, requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const s = await asSelf(user, (c) =>
    one<{ balance: number; starter: boolean; unread: number }>(
      c,
      `SELECT w.balance, w.starter_available AS starter,
              (SELECT count(*)::int FROM notifications n WHERE n.user_id = $1 AND n.read_at IS NULL) AS unread
         FROM wallets w WHERE w.user_id = $1`,
      [user.id],
    ),
  );
  // Live unread count via Neon Realtime when configured; a sealing failure
  // must never take the page down, so it falls back to the static bell.
  const sealed = liveEnabled() ? await sealUnread(user.id).catch(() => null) : null;
  return (
    <>
      {!user.emailVerified ? (
        <div className="notice-bar" role="region" aria-label="Email confirmation">
          <div className="page">
            <span>Confirm your email to share opportunities and earn credits.</span>
            <ActionForm action={resendVerificationAction} className="row"><Submit className="btn small" pending="Sending…">Resend link</Submit></ActionForm>
          </div>
        </div>
      ) : null}
      {user.state === "frozen" ? (
        <div className="notice-bar" role="region" aria-label="Account status"><div className="page">Your account is paused while we review it. Your data is safe.</div></div>
      ) : null}
      <header className="topbar">
        <div className="page topbar-inner">
          <Link href="/home" className="brand-link" aria-label="OCCASIO home"><Logo variant="paper" className="brand-full" /><Logo variant="paper" kind="symbol" height={26} className="brand-compact" /></Link>
          <DesktopNav />
          <div className="topbar-actions">
            <Link href="/contribute" className="btn primary small hide-sm">
              <Icon name="plus" size={18} /> <span>Share</span>
            </Link>
            <Link href="/credits" className="balance-pill" aria-label={`${s?.balance ?? 0} credits available`}>
              {s?.balance ?? 0} <span className="muted">credit{s?.balance === 1 ? "" : "s"}</span>
            </Link>
            {sealed ? (
              <LiveBell url={process.env.NEXT_PUBLIC_NEON_REALTIME_URL!} sealed={sealed} userId={user.id} initial={s?.unread ?? 0} />
            ) : (
              <StaticBell unread={s?.unread ?? 0} />
            )}
            {user.role !== "member" ? <Link href="/admin" className="btn ghost small hide-sm">Admin</Link> : null}
          </div>
        </div>
      </header>
      <main id="main" className="app-main">{children}</main>
      <Footer />
      <MobileNav />
    </>
  );
}
