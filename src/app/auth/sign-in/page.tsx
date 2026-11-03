import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/app/actions/auth";
import { ActionForm, Field, Submit } from "@/components/Form";
import { safeReturnPath } from "@/lib/urls";
import { currentUser } from "@/server/session";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; verified?: string }> }) {
  const sp = await searchParams;
  const next = safeReturnPath(sp.next);
  if (await currentUser()) redirect(next);
  return (
    <div className="tile auth-card fade-in">
      <h1 style={{ fontSize: 32 }}>Welcome back</h1>
      {sp.reset ? <div className="alert success" role="status">Your password was changed. Sign in with the new one.</div> : null}
      {sp.verified ? <div className="alert success" role="status">Email confirmed. Sign in to continue.</div> : null}
      <ActionForm action={signInAction}>
        <input type="hidden" name="next" value={next} />
        <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" required />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
        <Submit pending="Signing in…">Sign in</Submit>
      </ActionForm>
      <div className="row-between meta">
        <Link href="/auth/reset">Forgot your password?</Link>
        <Link href="/auth/sign-up">Create an account</Link>
      </div>
    </div>
  );
}
