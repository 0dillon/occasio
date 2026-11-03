import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { Logo } from "@/components/Logo";
import { requireStaff } from "@/server/session";

export const metadata = { title: { default: "Admin", template: "%s · Admin · OCCASIO" } };
const RANK = { member: 0, reviewer: 1, operator: 2, admin: 3 } as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireStaff("reviewer");
  return (
    <>
      <header className="topbar">
        <div className="page topbar-inner">
          <Link href="/admin" className="brand-link" aria-label="OCCASIO admin"><Logo variant="paper" /></Link>
          <span className="badge">Staff · {user.role}</span>
          <div className="topbar-actions"><Link href="/home" className="btn ghost small">Back to app</Link></div>
        </div>
      </header>
      <main id="main" className="app-main">
        <div className="page stack">
          <AdminNav rank={RANK[user.role]} devMail={process.env.OCCASIO_MODE === "development"} />
          {children}
        </div>
      </main>
    </>
  );
}
