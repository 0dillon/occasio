-- Contributor perks (D13): saved searches become opt-in alerts.
SET search_path = occasio, public;

ALTER TABLE saved_searches
  ADD COLUMN label text CHECK (label IS NULL OR char_length(label) <= 120),
  ADD COLUMN alerts_enabled boolean NOT NULL DEFAULT true;
CREATE INDEX saved_searches_user_idx ON saved_searches(user_id);
CREATE INDEX saved_searches_alerts_idx ON saved_searches(alerts_enabled) WHERE alerts_enabled;
