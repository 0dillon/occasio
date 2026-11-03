SET search_path = occasio, public;

-- An empty rule list is not proof that anyone can apply. Until a reviewer or
-- a supported source confirms the rule list is complete, overall eligibility
-- stays "unknown" and the record cannot be redeemed with a credit.
ALTER TABLE opportunities ADD COLUMN eligibility_complete boolean NOT NULL DEFAULT false;
ALTER TABLE opportunities ADD COLUMN eligibility_summary text;
