import type { ReactNode } from "react";
import { PublicHeader } from "@/components/PublicHeader";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="auth-wrap">{children}</main>
    </>
  );
}
