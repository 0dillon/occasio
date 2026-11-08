import Link from "next/link";
import { resendVerificationAction } from "@/app/actions/auth";
import { ActionForm, Submit } from "@/components/Form";
import { verifyEmail } from "@/domain/auth";
import { DomainError } from "@/domain/errors";
import { currentUser } from "@/server/session";

export const metadata = { title: "Confirm email" };

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const user = await currentUser();
  if (token) {
    let error: string | null = null;
    try {
      await verifyEmail(token);
    } catch (e) {
      error = e instanceof DomainError ? e.message : "We couldn't confirm that link.";
    }
    return (
      <div className="tile auth-card fade-in">
        <h1 style={{ fontSize: 32 }}>{error ? "That link didn't work" : "Email confirmed"}</h1>
        <p className="muted">{error ?? "You can now share opportunities and earn credits."}</p>
        <Link className="btn primary" href={user ? "/home" : "/auth/sign-in?verified=1"}>{user ? "Continue" : "Sign in"}</Link>
        {error && user ? <ActionForm action={resendVerificationAction}><Submit className="btn">Send a new link</Submit></ActionForm> : null}
      </div>
    );
  }
  return (
    <div className="tile auth-card fade-in">
      <h1 style={{ fontSize: 32 }}>Confirm your email</h1>
      <p className="muted">We sent a link to {user?.email ?? "your inbox"}. It expires in 24 hours.</p>
      {user && !user.emailVerified ? (
        <ActionForm action={resendVerificationAction}><Submit className="btn">Send it again</Submit></ActionForm>
      ) : null}
      <Link href="/home" className="meta">Continue to OCCASIO</Link>
    </div>
  );
}
