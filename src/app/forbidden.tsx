import Link from "next/link";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main id="main" className="auth-wrap">
      <div className="auth-card stack">
        <h1>You don&apos;t have access to this page</h1>
        <p className="muted" style={{ margin: 0 }}>This area is for the OCCASIO team. If you think you should have access, ask an administrator.</p>
        <Link href="/home" className="btn primary">Go to your home</Link>
      </div>
    </main>
  );
}
