-- D14: an open board fed by web discovery, credits for sharing opportunities
-- you're applying to, and credits for bringing people to OCCASIO.
SET search_path = occasio, public;

-- Credits for a referred person confirming their email.
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'referral_award';

-- Devpost's public hackathon API as a discovery source type.
ALTER TABLE source_registry DROP CONSTRAINT IF EXISTS source_registry_adapter_check;
ALTER TABLE source_registry ADD CONSTRAINT source_registry_adapter_check
  CHECK (adapter IN ('fixture', 'json_feed', 'html_listing', 'devpost'));

-- No human review step: clean listings publish automatically.
UPDATE app_flags SET value = 'true' WHERE key = 'auto_publish_enabled';

-- Each member's personal invite code.
CREATE TABLE referral_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{6,16}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who brought whom. One referrer per account, never yourself.
CREATE TABLE referrals (
  referred_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  awarded_at timestamptz,
  award_note text,
  CHECK (referrer_id <> referred_id)
);
CREATE INDEX referrals_referrer_idx ON referrals(referrer_id, created_at DESC);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
-- Codes are looked up by anyone following an invite link; only the owner creates theirs.
CREATE POLICY referral_codes_read ON referral_codes FOR SELECT TO occasio_app USING (true);
CREATE POLICY referral_codes_insert ON referral_codes FOR INSERT TO occasio_app WITH CHECK (user_id = current_user_id());
CREATE POLICY referral_codes_worker ON referral_codes TO occasio_worker USING (true) WITH CHECK (true);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
-- A referrer sees the people they brought; the row is created at sign-up
-- (before a session exists) and awards are only written by the worker.
CREATE POLICY referrals_read ON referrals FOR SELECT TO occasio_app
  USING (referrer_id = current_user_id() OR referred_id = current_user_id() OR current_is_staff());
CREATE POLICY referrals_insert ON referrals FOR INSERT TO occasio_app
  WITH CHECK (referred_id = current_user_id() AND awarded_at IS NULL);
CREATE POLICY referrals_worker ON referrals TO occasio_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON referral_codes, referrals TO occasio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON referral_codes, referrals TO occasio_worker;

-- First discovery source. Access review recorded 2026-11-08: devpost.com
-- robots.txt allows all agents ("User-agent: * / Disallow:" with only named
-- bots blocked); the public JSON list at /api/hackathons is what devpost.com
-- itself loads. Each hackathon page is the organizer's official listing.
-- Polite limits: 2s between pages, at most 8 pages per crawl, twice a day.
INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, robots_status,
                            approved_at, enabled, min_interval_seconds, daily_fetch_budget, crawl_every_minutes)
SELECT 'Devpost open hackathons', 'https://devpost.com', 'devpost.com', 'devpost',
       '/api/hackathons?status[]=open',
       'robots.txt checked 2026-11-08: all agents allowed except named bots. Public JSON list used by devpost.com. Each hackathon page is verified individually before publishing.',
       'allowed', now(), true, 2, 20, 720
WHERE NOT EXISTS (SELECT 1 FROM source_registry WHERE domain = 'devpost.com' AND adapter = 'devpost');
