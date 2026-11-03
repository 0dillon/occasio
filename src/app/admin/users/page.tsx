import { setRoleAction } from "@/app/actions/admin";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Users" };

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireStaff("admin");
  const { q = "" } = await searchParams;
  const rows = q.trim().length >= 3 || q === "" ? await asUser(u, (c) => many<any>(c,
    `SELECT id, email, role, state, created_at, email_verified_at FROM users
      WHERE deleted_at IS NULL AND ($1 = '' AND role <> 'member' OR $1 <> '' AND email ILIKE '%' || $1 || '%')
      ORDER BY created_at DESC LIMIT 50`, [q.trim().slice(0, 120)])) : [];
  return (
    <>
      <PageHead title="Users and roles" intro="Shows staff by default. Search by email to find a member. Changing a role ends that person's sessions." />
      <form className="row" role="search">
        <label className="sr-only" htmlFor="uq">Email</label>
        <input id="uq" name="q" className="input" defaultValue={q} placeholder="Email contains (3+ characters)" style={{ maxWidth: 320 }} />
        <button className="btn small">Search</button>
      </form>
      <Tile span="lg-12">
        {rows.length ? (
          <ul className="list">{rows.map((r) => (
            <li key={r.id} className="stack-sm">
              <div className="row-between"><strong>{r.email}</strong><span className="muted">{r.role} · {r.state}{r.email_verified_at ? "" : " · unverified"} · joined {when(r.created_at)}</span></div>
              {r.id !== u.id ? (
                <ActionForm action={setRoleAction} className="form-grid two">
                  <input type="hidden" name="userId" value={r.id} />
                  <Field name="role" label="Role" inputId={`r-${r.id}`}>
                    <select id={`r-${r.id}`} name="role" className="select" defaultValue={r.role}>
                      <option value="member">Member</option><option value="reviewer">Reviewer</option><option value="operator">Operator</option><option value="admin">Admin</option>
                    </select>
                  </Field>
                  <Field name="reason" label="Reason" required maxLength={300} />
                  <div className="full"><Submit className="btn small">Change role</Submit></div>
                </ActionForm>
              ) : <span className="muted">This is you. Another admin has to change your role.</span>}
            </li>
          ))}</ul>
        ) : <Empty title="No users found" />}
      </Tile>
    </>
  );
}
