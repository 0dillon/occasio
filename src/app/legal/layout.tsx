import type { ReactNode } from "react";
import { Footer, PublicHeader } from "@/components/PublicHeader";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="page" style={{ maxWidth: 760, paddingTop: 32 }}>
        <div className="alert warn" style={{ marginBottom: 24 }}><strong>Draft for review.</strong>This text has not been reviewed by a lawyer and is not final.</div>
        <article className="stack">{children}</article>
      </main>
      <Footer />
    </>
  );
}
