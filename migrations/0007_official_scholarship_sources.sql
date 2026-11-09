-- D16: official scholarship sources. Each one is run by the funder itself, so
-- the pages it links to state their own deadlines.
SET search_path = occasio, public;

-- Catalogues that link out to programmes run by other organisations.
ALTER TABLE source_registry DROP CONSTRAINT IF EXISTS source_registry_adapter_check;
ALTER TABLE source_registry ADD CONSTRAINT source_registry_adapter_check
  CHECK (adapter IN ('fixture', 'json_feed', 'html_listing', 'devpost', 'wordpress_leads', 'outbound_listing'));

-- Access review 2026-11-09: cscuk.fcdo.gov.uk robots.txt is "User-agent: * / Disallow:"
-- (everything allowed). The /scholarships/ section is the Commission's own list
-- of its scholarships; each page states its own closing date.
INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, robots_status,
                            approved_at, enabled, min_interval_seconds, daily_fetch_budget, crawl_every_minutes)
SELECT 'Commonwealth Scholarships (UK)', 'https://cscuk.fcdo.gov.uk', 'cscuk.fcdo.gov.uk', 'html_listing',
       '/scholarships/',
       'robots.txt checked 2026-11-09: all agents allowed. Official Commonwealth Scholarship Commission list; each scholarship page is verified individually before publishing.',
       'allowed', now(), true, 5, 20, 1440
WHERE NOT EXISTS (SELECT 1 FROM source_registry WHERE domain = 'cscuk.fcdo.gov.uk');

-- Access review 2026-11-09: www.eacea.ec.europa.eu robots.txt disallows only
-- admin/system paths. The Erasmus Mundus catalogue is the EU agency's official
-- list of funded joint masters; it links to each consortium's own site.
INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, robots_status,
                            approved_at, enabled, min_interval_seconds, daily_fetch_budget, crawl_every_minutes)
SELECT 'Erasmus Mundus catalogue (EU)', 'https://www.eacea.ec.europa.eu', 'www.eacea.ec.europa.eu', 'outbound_listing',
       '/scholarships/erasmus-mundus-catalogue_en',
       'robots.txt checked 2026-11-09: only admin/system paths disallowed. Official EACEA catalogue of Erasmus Mundus Joint Masters; each programme site is verified individually before publishing.',
       'allowed', now(), true, 5, 20, 1440
WHERE NOT EXISTS (SELECT 1 FROM source_registry WHERE domain = 'www.eacea.ec.europa.eu');
