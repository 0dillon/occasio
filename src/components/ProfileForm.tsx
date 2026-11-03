import { saveProfileAction } from "@/app/actions/profile";
import { CATEGORIES, CATEGORY_LABEL } from "@/domain/catalog";
import { ActionForm, Field, Submit } from "./Form";
import { TimezoneDefault } from "./TimezoneDefault";

const ZONES = Intl.supportedValuesOf("timeZone");
const sel = (name: string, label: string, value: string | null, opts: [string, string][], hint?: string) => (
  <Field name={name} label={label} hint={hint} inputId={`f-${name}`}>
    <select className="select" name={name} id={`f-${name}`} defaultValue={value ?? ""}>
      <option value="">Prefer not to say</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </Field>
);

export function ProfileForm({ p, onboarding }: { p: any; onboarding?: boolean }) {
  return (
    <ActionForm action={saveProfileAction} className="stack">
      {onboarding ? <input type="hidden" name="onboarding" value="1" /> : null}
      <section className="tile">
        <h2>About you</h2>
        <div className="form-grid two">
          <Field name="displayName" label="Name to show" defaultValue={p.display_name} maxLength={80} />
          <Field name="timezone" label="Your timezone" hint="Deadlines and reminders use this." required inputId="f-timezone">
            <select className="select" name="timezone" id="f-timezone" defaultValue={p.timezone}>
              {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
        </div>
        <TimezoneDefault selectId="f-timezone" current={p.timezone} />
      </section>

      <section className="tile">
        <h2>What you're looking for</h2>
        <fieldset>
          <legend>Kinds of opportunity</legend>
          <div className="chips">
            {CATEGORIES.filter((c) => c !== "other").map((c) => (
              <label key={c} className="chip"><input type="checkbox" name="categories" value={c} defaultChecked={p.categories?.includes(c)} />{CATEGORY_LABEL[c]}</label>
            ))}
          </div>
        </fieldset>
        <Field name="interests" label="Topics you care about" hint="Separate with commas, for example: fintech, climate, design" defaultValue={(p.interests ?? []).join(", ")} />
        <div className="stack-sm">
          <label className="check"><input type="checkbox" name="remoteOk" defaultChecked={p.remote_ok} /> Remote opportunities are fine</label>
          <label className="check"><input type="checkbox" name="freeOnly" defaultChecked={p.free_only} /> Only show opportunities with no application fee</label>
        </div>
      </section>

      <section className="tile">
        <div className="stack-sm">
          <h2>Eligibility</h2>
          <p className="muted" style={{ margin: 0 }}>Used only to check fit before you spend a credit. Skip anything you'd rather not share; we'll ask instead of guessing.</p>
        </div>
        <div className="form-grid two">
          <Field name="residenceCountry" label="Country you live in" hint="Two-letter code, e.g. NG, GB, KE" defaultValue={p.residence_country} maxLength={2} />
          <Field name="citizenships" label="Citizenship(s)" hint="Two-letter codes, comma separated" defaultValue={(p.citizenships ?? []).join(", ")} />
          {sel("educationLevel", "Study level", p.education_level, [["secondary", "Secondary school"], ["undergraduate", "Undergraduate"], ["graduate", "Graduate"], ["not_studying", "Not studying"]])}
          {sel("ageBand", "Age", p.age_band, [["under_18", "Under 18"], ["18_24", "18–24"], ["25_34", "25–34"], ["35_plus", "35 or older"]])}
          {sel("experienceLevel", "Work experience", p.experience_level, [["none", "None yet"], ["early", "Early career"], ["mid", "Mid career"], ["senior", "Senior"]])}
        </div>
      </section>
      <div className="row">
        <Submit pending="Saving…">{onboarding ? "Save and continue" : "Save changes"}</Submit>
      </div>
    </ActionForm>
  );
}
