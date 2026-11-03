import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" className="auth-wrap">
      <div className="auth-card stack">
        <h1>We couldn&apos;t find that</h1>
        <p className="muted" style={{ margin: 0 }}>It may have been removed, or it isn&apos;t yours to see.</p>
        <Link href="/home" className="btn primary">Go to your home</Link>
      </div>
    </main>
  );
}
