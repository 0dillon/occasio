-- OCCASIO initial schema.
-- Product tables live in the non-public "occasio" schema. The runtime roles
-- (occasio_app, occasio_worker) are NOT owners and do NOT have BYPASSRLS, so
-- row policies apply to them. Migrations run as occasio_owner.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS occasio;
SET search_path = occasio, public;

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role AS ENUM ('member', 'reviewer', 'operator', 'admin');
CREATE TYPE account_state AS ENUM ('active', 'frozen', 'deleted');
CREATE TYPE opportunity_category AS ENUM (
  'hackathon', 'scholarship', 'grant', 'fellowship', 'job', 'internship',
  'competition', 'accelerator', 'event', 'other');
CREATE TYPE submission_status AS ENUM (
  'received', 'queued', 'fetching', 'extracting', 'validating',
  'needs_information', 'review_required', 'accepted', 'duplicate',
  'rejected', 'failed', 'withdrawn');
CREATE TYPE publication_state AS ENUM ('draft', 'review_required', 'published', 'hidden', 'archived');
CREATE TYPE availability_state AS ENUM ('upcoming', 'open', 'closed', 'rolling', 'unknown');
CREATE TYPE organizer_trust AS ENUM ('unassessed', 'supported', 'concern', 'blocked');
CREATE TYPE deadline_precision AS ENUM ('instant', 'date_only', 'rolling', 'unknown');
CREATE TYPE deadline_kind AS ENUM ('registration', 'application', 'document', 'interview');
CREATE TYPE fee_status AS ENUM ('free', 'paid', 'unknown');
CREATE TYPE location_mode AS ENUM ('remote', 'hybrid', 'on_site', 'unknown');
CREATE TYPE opportunity_origin AS ENUM ('user_submission', 'discovery', 'operator', 'fixture');
CREATE TYPE ledger_reason AS ENUM ('contribution_award', 'match_redemption', 'refund', 'correction');
CREATE TYPE entitlement_via AS ENUM ('credit', 'starter', 'contribution', 'operator');
CREATE TYPE application_status AS ENUM ('saved', 'preparing', 'submitted', 'selected', 'unsuccessful', 'withdrawn');
CREATE TYPE reminder_state AS ENUM ('scheduled', 'claimed', 'sent', 'suppressed', 'cancelled', 'failed', 'uncertain');
CREATE TYPE notify_channel AS ENUM ('email', 'in_app');
CREATE TYPE attempt_status AS ENUM ('pending', 'accepted', 'failed', 'uncertain');
CREATE TYPE match_state AS ENUM ('open', 'needs_clarification', 'candidate_ready', 'no_match', 'redeemed', 'cancelled');
CREATE TYPE eligibility_outcome AS ENUM ('eligible', 'ineligible', 'unknown');

-- ---------------------------------------------------------------- helpers
-- Transaction-local identity, set by the server after it has authenticated
-- the request (see src/db/tx.ts). current_setting(..., true) returns NULL
-- when unset, so an unset context matches nothing.
CREATE FUNCTION current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('occasio.user_id', true), '')::uuid
$$;
CREATE FUNCTION current_is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('occasio.staff', true), '') IN ('reviewer', 'operator', 'admin')
$$;

CREATE FUNCTION tags_text(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_to_string($1, ' '), '')
$$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text,
  email_verified_at timestamptz,
  role user_role NOT NULL DEFAULT 'member',
  state account_state NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text CHECK (char_length(display_name) <= 80),
  country text CHECK (country ~ '^[A-Z]{2}$'),
  timezone text NOT NULL DEFAULT 'UTC',
  onboarded_at timestamptz,
  revision int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories opportunity_category[] NOT NULL DEFAULT '{}',
  interests text[] NOT NULL DEFAULT '{}',
  locations text[] NOT NULL DEFAULT '{}',
  remote_ok boolean NOT NULL DEFAULT true,
  free_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER prefs_touch BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Every attribute is optional; NULL means "unknown", never "eligible".
CREATE TABLE user_eligibility (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  residence_country text CHECK (residence_country ~ '^[A-Z]{2}$'),
  citizenships text[],
  education_level text CHECK (education_level IN ('secondary', 'undergraduate', 'graduate', 'not_studying')),
  age_band text CHECK (age_band IN ('under_18', '18_24', '25_34', '35_plus')),
  experience_level text CHECK (experience_level IN ('none', 'early', 'mid', 'senior')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER elig_touch BEFORE UPDATE ON user_eligibility FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  in_app_enabled boolean NOT NULL DEFAULT true,
  quiet_start time,
  quiet_end time,
  offsets_minutes int[] NOT NULL DEFAULT '{10080,4320,1440}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- ---------------------------------------------------------------- catalog
CREATE TABLE organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  domains text[] NOT NULL DEFAULT '{}',
  trust organizer_trust NOT NULL DEFAULT 'unassessed',
  trust_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  name text NOT NULL,
  normalized_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_id, normalized_key)
);

CREATE TABLE opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES programmes(id),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  edition_key text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  category opportunity_category NOT NULL,
  summary text,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  official_url text,
  application_url text NOT NULL,
  location_mode location_mode NOT NULL DEFAULT 'unknown',
  location_text text,
  fee fee_status NOT NULL DEFAULT 'unknown',
  fee_text text,
  benefits_text text,
  requirements text[] NOT NULL DEFAULT '{}',
  opens_at timestamptz,
  availability availability_state NOT NULL DEFAULT 'unknown',
  availability_checked_at timestamptz,
  last_successful_check_at timestamptz,
  next_check_at timestamptz,
  consecutive_check_failures int NOT NULL DEFAULT 0,
  publication publication_state NOT NULL DEFAULT 'draft',
  -- A record can be browsable with explicit uncertainty while still being
  -- excluded from credit redemption until its gates are met.
  redemption_blockers text[] NOT NULL DEFAULT '{}',
  origin opportunity_origin NOT NULL,
  is_fixture boolean NOT NULL DEFAULT false,
  revision int NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', tags_text(tags)), 'C') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) STORED,
  UNIQUE (programme_id, edition_key)
);
CREATE TRIGGER opp_touch BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX opp_search_idx ON opportunities USING gin(search);
CREATE INDEX opp_catalog_idx ON opportunities(publication, availability, category);
CREATE INDEX opp_recheck_idx ON opportunities(next_check_at) WHERE publication = 'published';

CREATE TABLE evidence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_url text NOT NULL,
  final_url text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  http_status int,
  content_type text,
  content_hash text,
  title text,
  excerpt text CHECK (char_length(excerpt) <= 4000),
  outcome text NOT NULL CHECK (outcome IN ('ok', 'blocked', 'not_found', 'error', 'denied_by_policy', 'unsupported', 'fixture')),
  error_detail text
);

CREATE TABLE opportunity_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  kind deadline_kind NOT NULL DEFAULT 'application',
  source_text text NOT NULL,
  source_local_date date,
  source_local_time time,
  timezone text,
  utc_instant timestamptz,
  precision deadline_precision NOT NULL,
  evidence_id uuid REFERENCES evidence_snapshots(id),
  verified_at timestamptz,
  revision int NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- An instant must carry both its UTC value and the source timezone; we
  -- never invent midnight UTC for a date-only deadline.
  CHECK (precision <> 'instant' OR (utc_instant IS NOT NULL AND timezone IS NOT NULL)),
  CHECK (precision <> 'date_only' OR (source_local_date IS NOT NULL AND utc_instant IS NULL))
);
CREATE UNIQUE INDEX deadline_current_uniq ON opportunity_deadlines(opportunity_id, kind) WHERE is_current;

CREATE TABLE eligibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('residence_country', 'citizenship', 'education_level', 'age_band', 'experience_level', 'other')),
  operator text NOT NULL CHECK (operator IN ('in', 'not_in', 'note')),
  operand jsonb NOT NULL DEFAULT '[]',
  source_text text NOT NULL,
  is_hard boolean NOT NULL DEFAULT true,
  evidence_id uuid REFERENCES evidence_snapshots(id),
  ruleset_version text NOT NULL DEFAULT 'v1'
);
CREATE INDEX elig_rules_opp_idx ON eligibility_rules(opportunity_id);

CREATE TABLE opportunity_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  url text NOT NULL,
  role text NOT NULL CHECK (role IN ('official', 'application', 'listing', 'poster')),
  latest_evidence_id uuid REFERENCES evidence_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, url, role)
);

-- Not globally unique: one URL can be reused across editions.
CREATE TABLE url_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_url text NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  UNIQUE (normalized_url, opportunity_id)
);
CREATE INDEX url_alias_idx ON url_aliases(normalized_url);

CREATE TABLE opportunity_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  revision int NOT NULL,
  changed_fields text[] NOT NULL,
  before jsonb,
  after jsonb,
  actor_kind text NOT NULL,
  actor_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, revision)
);

-- ---------------------------------------------------------------- submissions
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_url text NOT NULL CHECK (char_length(application_url) <= 2048),
  normalized_url text NOT NULL,
  user_note text CHECK (char_length(user_note) <= 1000),
  claimed jsonb NOT NULL DEFAULT '{}',
  status submission_status NOT NULL DEFAULT 'received',
  status_reason text,
  missing_information text[] NOT NULL DEFAULT '{}',
  opportunity_id uuid REFERENCES opportunities(id),
  candidate jsonb,
  attempts int NOT NULL DEFAULT 0,
  lease_until timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);
CREATE TRIGGER sub_touch BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX sub_queue_idx ON submissions(status, created_at) WHERE status IN ('received', 'queued');
CREATE INDEX sub_user_idx ON submissions(user_id, created_at DESC);

CREATE TABLE submission_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  width int NOT NULL,
  height int NOT NULL,
  bytes int NOT NULL,
  sha256 text NOT NULL,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  field_path text NOT NULL,
  value jsonb,
  origin text NOT NULL CHECK (origin IN ('source_page', 'poster_claim', 'user_claim', 'operator', 'fixture')),
  snapshot_id uuid REFERENCES evidence_snapshots(id),
  excerpt text CHECK (char_length(excerpt) <= 600),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  ruleset_version text NOT NULL,
  extractor text NOT NULL,
  checks jsonb NOT NULL,
  decision text NOT NULL,
  cost_microusd bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- exchange
CREATE TABLE wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance int NOT NULL DEFAULT 0 CHECK (balance >= 0),
  starter_available boolean NOT NULL DEFAULT true,
  frozen boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  delta int NOT NULL CHECK (delta <> 0),
  reason ledger_reason NOT NULL,
  -- e.g. award:<opportunity>, redeem:<entitlement>, refund:<ledger entry>
  business_key text NOT NULL UNIQUE,
  reference_id uuid,
  actor_kind text NOT NULL,
  actor_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON credit_ledger(user_id, created_at DESC);
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE contribution_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL UNIQUE REFERENCES opportunities(id),
  user_id uuid NOT NULL REFERENCES users(id),
  submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES credit_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text text CHECK (char_length(query_text) <= 500),
  constraints jsonb NOT NULL DEFAULT '{}',
  state match_state NOT NULL DEFAULT 'open',
  selected_opportunity_id uuid REFERENCES opportunities(id),
  selected_revision int,
  explanation jsonb,
  clarifications text[] NOT NULL DEFAULT '{}',
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER mr_touch BEFORE UPDATE ON match_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX mr_user_idx ON match_requests(user_id, created_at DESC);

CREATE TABLE match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_request_id uuid NOT NULL REFERENCES match_requests(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  revision int NOT NULL,
  eligibility eligibility_outcome NOT NULL,
  score numeric NOT NULL,
  reasons jsonb NOT NULL,
  rank int NOT NULL,
  UNIQUE (match_request_id, opportunity_id)
);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  via entitlement_via NOT NULL,
  match_request_id uuid REFERENCES match_requests(id),
  ledger_entry_id uuid UNIQUE REFERENCES credit_ledger(id),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opportunity_id)
);

CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL UNIQUE REFERENCES entitlements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('expired_at_redemption', 'duplicate', 'clearly_ineligible')),
  detail text CHECK (char_length(detail) <= 1000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'approved', 'rejected')),
  decided_by uuid REFERENCES users(id),
  decision_reason text,
  decided_at timestamptz,
  ledger_entry_id uuid REFERENCES credit_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- applications
CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  status application_status NOT NULL DEFAULT 'saved',
  -- A user's own assertion; never set by opening an external link.
  submitted_at timestamptz,
  submission_reported_by text CHECK (submission_reported_by IN ('user')),
  user_reference text CHECK (char_length(user_reference) <= 200),
  notes text CHECK (char_length(notes) <= 5000),
  target_at timestamptz,
  revision int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opportunity_id),
  CHECK ((status = 'submitted') <= (submitted_at IS NOT NULL))
);
CREATE TRIGGER app_touch BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE application_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'source_requirement', 'suggested')),
  target_date date,
  done_at timestamptz,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_app_idx ON application_tasks(application_id, position);

CREATE TABLE application_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status application_status,
  to_status application_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- reminders
CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('official_deadline', 'preparation_target', 'date_only_deadline', 'check_in')),
  deadline_id uuid REFERENCES opportunity_deadlines(id),
  deadline_revision int,
  offset_minutes int NOT NULL,
  channel notify_channel NOT NULL,
  due_at timestamptz NOT NULL,
  cutoff_at timestamptz,
  state reminder_state NOT NULL DEFAULT 'scheduled',
  state_reason text,
  lease_until timestamptz,
  attempts int NOT NULL DEFAULT 0,
  logical_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER rem_touch BEFORE UPDATE ON reminders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX reminders_due_idx ON reminders(due_at) WHERE state IN ('scheduled', 'claimed');

CREATE TABLE notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid REFERENCES reminders(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  channel notify_channel NOT NULL,
  provider text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status attempt_status NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text CHECK (link IS NULL OR link LIKE '/%'),
  dedupe_key text UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notif_user_idx ON notifications(user_id, created_at DESC);

-- Development mail sink. Real providers write their own records; this table
-- exists so local runs can show what *would* have been sent.
CREATE TABLE dev_mail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_address text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- discovery
CREATE TABLE source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_url text NOT NULL,
  domain text NOT NULL,
  adapter text NOT NULL CHECK (adapter IN ('fixture', 'json_feed', 'html_listing')),
  scope_path text NOT NULL DEFAULT '/',
  access_review text,
  robots_status text NOT NULL DEFAULT 'unchecked' CHECK (robots_status IN ('unchecked', 'allowed', 'disallowed')),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  enabled boolean NOT NULL DEFAULT false,
  min_interval_seconds int NOT NULL DEFAULT 5 CHECK (min_interval_seconds >= 1),
  daily_fetch_budget int NOT NULL DEFAULT 50 CHECK (daily_fetch_budget >= 0),
  crawl_every_minutes int NOT NULL DEFAULT 720,
  next_crawl_at timestamptz,
  last_crawl_at timestamptz,
  last_etag text,
  last_modified text,
  is_fixture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A source cannot run without an approval record.
  CHECK (NOT enabled OR approved_at IS NOT NULL)
);

CREATE TABLE crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result text CHECK (result IN ('changed', 'unchanged', 'blocked', 'error', 'budget_exhausted', 'stopped')),
  http_status int,
  content_hash text,
  candidates int NOT NULL DEFAULT 0,
  detail text
);

CREATE TABLE discovery_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES source_registry(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  url text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published', 'review_required', 'duplicate', 'rejected', 'error')),
  opportunity_id uuid REFERENCES opportunities(id),
  reason text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- trust & ops
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('suspected_scam', 'wrong_deadline', 'closed', 'wrong_eligibility', 'broken_link', 'other')),
  detail text CHECK (char_length(detail) <= 2000),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'actioned', 'dismissed')),
  resolution text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'staff', 'worker', 'system')),
  actor_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  changes jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_target_idx ON audit_events(target_type, target_id);
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  aggregate_id uuid NOT NULL,
  aggregate_revision int,
  payload jsonb NOT NULL DEFAULT '{}',
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  lease_until timestamptz
);
CREATE INDEX events_pending_idx ON domain_events(occurred_at) WHERE dispatched_at IS NULL;

CREATE TABLE processed_events (
  consumer text NOT NULL,
  event_id uuid NOT NULL REFERENCES domain_events(id) ON DELETE CASCADE,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE api_idempotency (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status_code int,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);

CREATE TABLE job_runs (
  id bigserial PRIMARY KEY,
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  items int NOT NULL DEFAULT 0,
  detail text
);
CREATE INDEX job_runs_job_idx ON job_runs(job, started_at DESC);

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('export', 'delete')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'failed')),
  result jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Operator stop switches and tunables. Defaults are proposals (see src/config).
CREATE TABLE app_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_flags(key, value) VALUES
  ('discovery_enabled', 'true'),
  ('ai_extraction_enabled', 'true'),
  ('email_enabled', 'true'),
  ('auto_publish_enabled', 'false');

-- ---------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA occasio TO occasio_app, occasio_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA occasio TO occasio_app, occasio_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA occasio TO occasio_app, occasio_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA occasio TO occasio_app, occasio_worker;
-- Append-only tables: no UPDATE/DELETE for runtime roles at all.
REVOKE UPDATE, DELETE ON credit_ledger, audit_events FROM occasio_app, occasio_worker;
-- Only the worker writes the dev mail sink and job records.
REVOKE INSERT, UPDATE, DELETE ON dev_mail FROM occasio_app;

-- ---------------------------------------------------------------- row security
-- Applies to occasio_app (request-scoped). The worker role is a trusted
-- module identity and gets explicit permissive policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'user_preferences', 'user_eligibility', 'notification_preferences',
    'user_consents', 'submissions', 'submission_assets', 'wallets', 'credit_ledger',
    'match_requests', 'entitlements', 'refund_requests', 'saved_searches',
    'applications', 'application_tasks', 'application_status_history',
    'reminders', 'notifications', 'privacy_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I TO occasio_app USING (%s = current_user_id() OR current_is_staff()) WITH CHECK (%s = current_user_id() OR current_is_staff())',
      t || '_owner', t,
      CASE WHEN t = 'submission_assets' THEN 'owner_id' ELSE 'user_id' END,
      CASE WHEN t = 'submission_assets' THEN 'owner_id' ELSE 'user_id' END);
    EXECUTE format('CREATE POLICY %I ON %I TO occasio_worker USING (true) WITH CHECK (true)', t || '_worker', t);
  END LOOP;
END $$;

-- match_candidates inherit visibility from their request.
ALTER TABLE match_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY mc_owner ON match_candidates TO occasio_app
  USING (EXISTS (SELECT 1 FROM match_requests m WHERE m.id = match_request_id))
  WITH CHECK (EXISTS (SELECT 1 FROM match_requests m WHERE m.id = match_request_id));
CREATE POLICY mc_worker ON match_candidates TO occasio_worker USING (true) WITH CHECK (true);
