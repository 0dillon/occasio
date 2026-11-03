import Link from "next/link";
import { requestResetAction, resetPasswordAction } from "@/app/actions/auth";
import { ActionForm, Field, Submit } from "@/components/Form";

export const metadata = { title: "Reset password" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="tile auth-card fade-in">
      <h1 style={{ fontSize: 32 }}>{token ? "Choose a new password" : "Reset your password"}</h1>
      {token ? (
        <ActionForm action={resetPasswordAction}>
          <input type="hidden" name="token" value={token} />
          <Field name="password" label="New password" type="password" autoComplete="new-password" required hint="At least 10 characters. This signs you out everywhere else." />
          <Submit pending="Saving…">Save password</Submit>
        </ActionForm>
      ) : (
        <ActionForm action={requestResetAction}>
          <Field name="email" label="Email" type="email" autoComplete="email" required />
          <Submit pending="Sending…">Send reset link</Submit>
        </ActionForm>
      )}
      <Link href="/auth/sign-in" className="meta">Back to sign in</Link>
    </div>
  );
}
