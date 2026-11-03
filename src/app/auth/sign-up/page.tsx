import Link from "next/link";
import { redirect } from "next/navigation";
import { signUpAction } from "@/app/actions/auth";
import { ActionForm, Field, Submit } from "@/components/Form";
import { currentUser } from "@/server/session";

export const metadata = { title: "Create account" };

export default async function SignUp() {
  if (await currentUser()) redirect("/home");
  return (
    <div className="tile auth-card fade-in">
      <div className="stack-sm">
        <h1 style={{ fontSize: 32 }}>Create your account</h1>
        <p className="muted">Share opportunities you find and unlock ones that fit you. You'll confirm your email before sharing or unlocking.</p>
      </div>
      <ActionForm action={signUpAction}>
        <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" required />
        <Field name="password" label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters. A short phrase works well." />
        <label className="check">
          <input type="checkbox" name="terms" required />
          <span>I agree to the <Link href="/legal/terms">terms</Link> and <Link href="/legal/privacy">privacy notice</Link> (drafts pending legal review).</span>
        </label>
        <Submit pending="Creating account…">Create account</Submit>
      </ActionForm>
      <p className="meta">Already have an account? <Link href="/auth/sign-in">Sign in</Link></p>
    </div>
  );
}
