import { setFlagAction } from "@/app/actions/admin";
import { PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Flags" };
const ABOUT: Record<string, string> = {
  discovery_enabled: "Stop switch for crawling approved sources.",
  ai_extraction_enabled: "Use a model for extraction when a provider key is configured. Off means rule-based extraction plus human review.",
  email_enabled: "Stop switch for all outgoing email.",
  auto_publish_enabled: "Publish high-confidence submissions without a person. Off by default (founder decision pending).",
};

export default async function Flags() {
  const u = await requireStaff("admin");
  const rows = await asUser(u, (c) => many<any>(c, "SELECT key, value, updated_at FROM app_flags ORDER BY key"));
  return (
    <>
      <PageHead title="Operational flags" intro="Every change is audited with a reason." />
      <Tile span="lg-12">
        <ul className="list">{rows.map((f) => (
          <li key={f.key} className="stack-sm">
            <div className="row-between"><strong className="mono">{f.key}</strong><span className="badge">{f.value === true ? "On" : "Off"}</span></div>
            <span className="muted">{ABOUT[f.key]} Last changed {when(f.updated_at)}.</span>
            <ActionForm action={setFlagAction} className="form-grid two">
              <input type="hidden" name="key" value={f.key} />
              <input type="hidden" name="value" value={f.value === true ? "false" : "true"} />
              <Field name="reason" label="Reason" required maxLength={300} />
              <div className="full"><Submit className="btn small">{f.value === true ? "Turn off" : "Turn on"}</Submit></div>
            </ActionForm>
          </li>
        ))}</ul>
      </Tile>
    </>
  );
}
