"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; min: number }[] = [
  { href: "/admin", label: "Overview", min: 1 },
  { href: "/admin/reviews", label: "Reviews", min: 1 },
  { href: "/admin/discovery", label: "Discovery", min: 1 },
  { href: "/admin/reports", label: "Reports", min: 1 },
  { href: "/admin/catalog", label: "Catalog", min: 2 },
  { href: "/admin/refunds", label: "Refunds", min: 2 },
  { href: "/admin/sources", label: "Sources", min: 2 },
  { href: "/admin/jobs", label: "Jobs", min: 2 },
  { href: "/admin/audit", label: "Audit", min: 2 },
  { href: "/admin/users", label: "Users", min: 3 },
  { href: "/admin/flags", label: "Flags", min: 3 },
];

export function AdminNav({ rank, devMail }: { rank: number; devMail: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => rank >= i.min);
  if (devMail) items.push({ href: "/admin/mail", label: "Dev mail", min: 1 });
  return (
    <nav className="chips subnav" aria-label="Admin sections">
      {items.map((i) => {
        const on = i.href === "/admin" ? path === "/admin" : path === i.href || path.startsWith(i.href + "/");
        return <Link key={i.href} href={i.href} className={`chip${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>{i.label}</Link>;
      })}
    </nav>
  );
}
