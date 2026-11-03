import { Field } from "@/components/Form";
import { CATEGORIES, CATEGORY_LABEL } from "@/domain/catalog";
import type { Draft } from "@/domain/exchange";

type D = Partial<Draft> & { notes?: string[] };

function Select({ name, id, value, options }: { name: string; id: string; value?: string | null; options: [string, string][] }) {
  return (
    <select id={id} name={name} className="select" defaultValue={value ?? undefined}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/**
 * The reviewed canonical facts. Every field is the reviewer's decision: the
 * extraction only pre-fills it. Nothing here is published until submitted.
 */
export function DraftFields({ d, prefix }: { d: D; prefix: string }) {
  const id = (k: string) => `${prefix}-${k}`;
  const rules = (d.rules ?? []).map((r) => `${r.rule_type}: ${(r.operand as string[] | undefined)?.join(", ") ?? ""} | ${r.source_text}`).join("\n");
  return (
    <div className="form-grid two">
      <Field name="title" label="Title" required defaultValue={d.title} maxLength={200} />
      <Field name="organizer" label="Organizer" required defaultValue={d.organizer} maxLength={120} />
      <Field name="programme" label="Programme" hint="The recurring thing this edition belongs to." defaultValue={d.programme} maxLength={160} />
      <Field name="editionKey" label="Edition" hint="Lowercase, e.g. 2026 or 2026-spring." required defaultValue={d.editionKey} maxLength={60} />
      <Field name="category" label="Category" inputId={id("cat")}>
        <Select id={id("cat")} name="category" value={d.category} options={CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]])} />
      </Field>
      <Field name="availability" label="Availability" inputId={id("av")}>
        <Select id={id("av")} name="availability" value={d.availability ?? "unknown"} options={[["open", "Open"], ["upcoming", "Upcoming"], ["rolling", "Rolling"], ["closed", "Closed"], ["unknown", "Unknown"]]} />
      </Field>
      <Field name="applicationUrl" label="Application link" type="url" required defaultValue={d.applicationUrl} />
      <Field name="officialUrl" label="Official page" type="url" defaultValue={d.officialUrl} />
      <div className="full"><Field name="summary" label="Summary" textarea maxLength={600} defaultValue={d.summary} /></div>
      <div className="full"><Field name="description" label="Description" textarea maxLength={5000} defaultValue={d.description} /></div>
      <Field name="tags" label="Tags" hint="Comma separated." defaultValue={(d.tags ?? []).join(", ")} />
      <Field name="locationMode" label="Location" inputId={id("loc")}>
        <Select id={id("loc")} name="locationMode" value={d.locationMode ?? "unknown"} options={[["remote", "Remote"], ["hybrid", "Hybrid"], ["on_site", "On site"], ["unknown", "Unknown"]]} />
      </Field>
      <Field name="locationText" label="Location detail" defaultValue={d.locationText} maxLength={200} />
      <Field name="fee" label="Fee" inputId={id("fee")}>
        <Select id={id("fee")} name="fee" value={d.fee ?? "unknown"} options={[["free", "Free to apply"], ["paid", "Fee to apply"], ["unknown", "Unknown"]]} />
      </Field>
      <Field name="feeText" label="Fee detail" defaultValue={d.feeText} maxLength={300} />
      <Field name="benefitsText" label="What applicants get" defaultValue={d.benefitsText} maxLength={600} />
      <div className="full"><Field name="requirements" label="Requirements" hint="One per line." textarea defaultValue={(d.requirements ?? []).join("\n")} /></div>

      <div className="full"><h3 style={{ margin: "8px 0 0" }}>Deadline</h3></div>
      <div className="full"><Field name="deadlineSourceText" label="Deadline as the source states it" hint="Quote the source. Leave empty if it doesn't give one." defaultValue={d.deadline?.sourceText} maxLength={300} /></div>
      <Field name="deadlineDate" label="Date" type="date" defaultValue={d.deadline?.date} />
      <Field name="deadlineTime" label="Time" type="time" hint="Leave empty if the source gives no time; it's treated as end of day." defaultValue={d.deadline?.time} />
      <Field name="deadlineTimezone" label="Timezone (IANA)" hint="Only if the source states or clearly implies it, e.g. Africa/Lagos." defaultValue={d.deadline?.timezone} />
      <label className="check"><input type="checkbox" name="deadlineRolling" defaultChecked={!!d.deadline?.rolling} /> Rolling: no fixed deadline</label>

      <div className="full"><h3 style={{ margin: "8px 0 0" }}>Eligibility</h3></div>
      <div className="full">
        <Field name="rules" label="Hard rules" textarea defaultValue={rules}
          hint="One per line: type: CODES | source text. Types: residence_country, citizenship, education_level, age_band, experience_level, other. Example: residence_country: NG, GH | Open to residents of Nigeria and Ghana" />
      </div>
      <Field name="eligibilitySummary" label="Eligibility summary" defaultValue={d.eligibilitySummary} maxLength={300} />
      <label className="check"><input type="checkbox" name="eligibilityComplete" defaultChecked={!!d.eligibilityComplete} /> These rules are the source&apos;s complete eligibility</label>

      <div className="full"><h3 style={{ margin: "8px 0 0" }}>Trust</h3></div>
      <Field name="organizerTrust" label="Organizer" inputId={id("trust")}>
        <Select id={id("trust")} name="organizerTrust" value={d.organizerTrust ?? "unassessed"} options={[["unassessed", "Not assessed"], ["supported", "Supported by evidence"], ["concern", "Concern"], ["blocked", "Blocked"]]} />
      </Field>
      <label className="check"><input type="checkbox" name="sourceConfirmed" /> I opened the official source and confirmed these facts now</label>
      <input type="hidden" name="evidenceSnapshotId" value={d.evidenceSnapshotId ?? ""} />
    </div>
  );
}
