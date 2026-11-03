import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <header className="page-head">
        <div><h1>Profile and settings</h1></div>
        <form action={signOutAction}><button type="submit" className="btn ghost">Sign out</button></form>
      </header>
      <nav className="chips" aria-label="Settings sections" style={{ marginBottom: 24 }}>
        <Link className="chip" href="/settings/profile">Profile and eligibility</Link>
        <Link className="chip" href="/settings/notifications">Reminders</Link>
        <Link className="chip" href="/settings/account">Account and data</Link>
      </nav>
      {children}
    </div>
  );
}
