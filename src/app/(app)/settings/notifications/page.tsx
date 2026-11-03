import { saveNotificationsAction } from "@/app/actions/profile";
import { ActionForm, Field, Submit } from "@/components/Form";
import { currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Reminders" };
const OFFSETS: [number, string][] = [[10080, "7 days before"], [4320, "3 days before"], [1440, "1 day before"], [180, "3 hours before (exact deadlines only)"]];

export default async function NotificationSettings() {
  await requireUser("/settings/notifications");
  const p = await currentProfile();
  const hhmm = (t: string | null) => (t ? String(t).slice(0, 5) : "");
  return (
    <ActionForm action={saveNotificationsAction}>
      <section className="tile">
        <h2>How we remind you</h2>
        <label className="check"><input type="checkbox" name="emailEnabled" defaultChecked={p?.email_enabled} /> Email reminders</label>
        <label className="check"><input type="checkbox" name="inAppEnabled" defaultChecked={p?.in_app_enabled} /> In-app notifications</label>
        <fieldset>
          <legend>When, before an official deadline</legend>
          <div className="chips">
            {OFFSETS.map(([m, l]) => <label key={m} className="chip"><input type="checkbox" name="offsets" value={m} defaultChecked={p?.offsets_minutes?.includes(m)} />{l}</label>)}
          </div>
        </fieldset>
        <div className="form-grid two">
          <Field name="quietStart" label="Quiet hours start" type="time" defaultValue={hhmm(p?.quiet_start)} hint={`In ${p?.timezone}. Reminders that would land in quiet hours come earlier, never later.`} />
          <Field name="quietEnd" label="Quiet hours end" type="time" defaultValue={hhmm(p?.quiet_end)} />
        </div>
        <p className="meta" style={{ margin: 0 }}>Dates without a confirmed time or timezone are reminded against the earliest moment they could close.</p>
        <div><Submit pending="Saving…">Save reminder settings</Submit></div>
      </section>
    </ActionForm>
  );
}
