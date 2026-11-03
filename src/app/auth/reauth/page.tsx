import { reauthAction } from "@/app/actions/auth";
import { ActionForm, Field, Submit } from "@/components/Form";
import { safeReturnPath } from "@/lib/urls";
import { requireUser } from "@/server/session";

export const metadata = { title: "Confirm it's you" };

export default async function Reauth({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  await requireUser("/auth/reauth");
  return (
    <div className="tile auth-card fade-in">
      <h1 style={{ fontSize: 32 }}>Confirm it's you</h1>
      <p className="muted">For your security, enter your password again before this change.</p>
      <ActionForm action={reauthAction}>
        <input type="hidden" name="next" value={safeReturnPath(next, "/settings/account")} />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
        <Submit>Continue</Submit>
      </ActionForm>
    </div>
  );
}
