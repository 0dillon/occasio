"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

const ITEMS = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/discover", label: "Discover", icon: "search" },
  { href: "/applications", label: "My applications", short: "Applications", icon: "list" },
  { href: "/settings/profile", label: "Profile", icon: "user", match: "/settings" },
];

function active(path: string, href: string, match?: string) {
  const base = match ?? href;
  return path === base || path.startsWith(base + "/");
}

export function DesktopNav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(path, i.href, i.match) ? "page" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const path = usePathname();
  const [home, discover, apps, profile] = ITEMS;
  const items = [home!, discover!, { href: "/contribute", label: "Share", icon: "plus", share: true }, apps!, profile!];
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={"share" in i ? "share" : undefined} aria-current={active(path, i.href, (i as any).match) ? "page" : undefined}>
          <Icon name={i.icon} />
          <span>{(i as any).short ?? i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
