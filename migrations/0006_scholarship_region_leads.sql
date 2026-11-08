-- D15: opportunity blogs as lead sources (founder decision, 2026-11-08).
SET search_path = occasio, public;

ALTER TABLE source_registry DROP CONSTRAINT IF EXISTS source_registry_adapter_check;
ALTER TABLE source_registry ADD CONSTRAINT source_registry_adapter_check
  CHECK (adapter IN ('fixture', 'json_feed', 'html_listing', 'devpost', 'wordpress_leads'));

-- Access review 2026-11-08: www.scholarshipregion.com/robots.txt allows all
-- agents except /wp-admin/. Its public WordPress REST feed returns posts;
-- posts are leads only. Each candidate is the organizer page a post links
-- to, fetched and checked on its own before anything is published.
-- Polite limits: 5 posts a page, 2s between pages, at most 8 pages, twice a day.
INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, robots_status,
                            approved_at, enabled, min_interval_seconds, daily_fetch_budget, crawl_every_minutes)
SELECT 'Scholarship Region (leads)', 'https://www.scholarshipregion.com', 'scholarshipregion.com', 'wordpress_leads',
       '/wp-json/wp/v2/posts?per_page=5&_fields=link,title,content',
       'robots.txt checked 2026-11-08: all agents allowed except /wp-admin/. Public WordPress REST feed. Posts are leads only; the organizer page each links to is verified before publishing.',
       'allowed', now(), true, 2, 20, 720
WHERE NOT EXISTS (SELECT 1 FROM source_registry WHERE domain = 'scholarshipregion.com');
