import { deleteAccountAction } from "@/app/actions/profile";
import { ActionForm, Field, Submit } from "@/components/Form";
import { formatInZone } from "@/lib/time";
import { currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Account and data" };

export default async function AccountSettings() {
  const user = await requireUser("/settings/account");
  const p = await currentProfile();
  return (
    <div className="stack">
      <section className="tile">
        <h2>Account</h2>
        <dl className="kv">
          <dt>Email</dt><dd>{user.email} {user.emailVerified ? <span className="badge lime">Confirmed</span> : <span className="badge warn">Not confirmed</span>}</dd>
          <dt>Member since</dt><dd>{p ? formatInZone(new Date(p.created_at), p.timezone) : ""}</dd>
          {user.role !== "member" ? (<><dt>Role</dt><dd>{user.role}</dd></>) : null}
        </dl>
      </section>
      <section className="tile">
        <h2>Your data</h2>
        <p className="muted" style={{ margin: 0 }}>Download everything we hold about your account as JSON: profile, preferences, submissions, credit history, unlocks, applications and reminders.</p>
        <div><a className="btn" href="/api/v1/me/export" download>Download my data</a></div>
      </section>
      <section className="tile">
        <h2>Delete account</h2>
        <p className="muted" style={{ margin: 0 }}>This signs you out everywhere and erases your profile, applications, notes and uploaded images. Your credit history and audit records are kept without your email, because they protect other members' credits.</p>
        <ActionForm action={deleteAccountAction}>
          <Field name="confirm" label="Type DELETE to confirm" autoComplete="off" required />
          <Submit className="btn danger" pending="Deleting…">Delete my account</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
