import Link from "next/link";
import { Logo } from "./Logo";

export function PublicHeader({ signedIn }: { signedIn?: boolean }) {
  return (
    <header className="topbar">
      <div className="page topbar-inner">
        <Link href="/" className="brand-link" aria-label="OCCASIO home"><Logo variant="paper" /></Link>
        <div className="topbar-actions">
          {signedIn ? (
            <Link href="/home" className="btn primary small">Open OCCASIO</Link>
          ) : (
            <>
              <Link href="/auth/sign-in" className="btn ghost small">Sign in</Link>
              <Link href="/auth/sign-up" className="btn primary small">Create account</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="page footer-grid">
        <div className="stack-sm">
          <Logo variant="paper" height={22} />
          <span>Opportunity exchange. Share what you find; unlock what fits.</span>
        </div>
        <nav aria-label="Footer" className="row" style={{ gap: 20 }}>
          <Link href="/legal/terms">Terms (draft)</Link>
          <Link href="/legal/privacy">Privacy (draft)</Link>
          <Link href="/legal/sources">Source policy</Link>
          <Link href="/licenses/manrope-OFL.txt">Font licence</Link>
        </nav>
      </div>
    </footer>
  );
}
