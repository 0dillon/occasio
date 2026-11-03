-- Defence in depth for request-scoped (occasio_app) sessions. The server code
-- already only performs these writes on the right paths; these guards make a
-- bug or injected query unable to mint credits or escalate a role.

SET search_path = occasio, public;

-- Ledger: members may only append their own redemption debits. Awards,
-- refunds and corrections need a staff context (or the worker role).
DROP POLICY credit_ledger_owner ON credit_ledger;
CREATE POLICY credit_ledger_read ON credit_ledger FOR SELECT TO occasio_app
  USING (user_id = current_user_id() OR current_is_staff());
CREATE POLICY credit_ledger_append ON credit_ledger FOR INSERT TO occasio_app
  WITH CHECK (
    current_is_staff()
    OR (user_id = current_user_id() AND delta < 0 AND reason = 'match_redemption')
  );

-- Entitlements: members create them only through credit or starter redemption.
DROP POLICY entitlements_owner ON entitlements;
CREATE POLICY entitlements_read ON entitlements FOR SELECT TO occasio_app
  USING (user_id = current_user_id() OR current_is_staff());
CREATE POLICY entitlements_insert ON entitlements FOR INSERT TO occasio_app
  WITH CHECK (current_is_staff() OR (user_id = current_user_id() AND via IN ('credit', 'starter')));
CREATE POLICY entitlements_update ON entitlements FOR UPDATE TO occasio_app
  USING (user_id = current_user_id() OR current_is_staff())
  WITH CHECK (user_id = current_user_id() OR current_is_staff());

-- Wallets: outside a staff context a balance can only go down, the starter
-- match can only be used up, and the freeze flag cannot change.
CREATE FUNCTION guard_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'occasio_app' AND NOT current_is_staff() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.balance <> 0 OR NEW.frozen THEN
        RAISE EXCEPTION 'wallets start empty' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.balance > OLD.balance
       OR (NEW.starter_available AND NOT OLD.starter_available)
       OR NEW.frozen IS DISTINCT FROM OLD.frozen
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'wallet change requires staff' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_guard BEFORE INSERT OR UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION guard_wallet();

-- Users: only an admin context may change a role or freeze an account.
CREATE FUNCTION guard_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'occasio_app' AND coalesce(current_setting('occasio.staff', true), '') <> 'admin' THEN
    IF TG_OP = 'INSERT' AND NEW.role <> 'member' THEN
      RAISE EXCEPTION 'new accounts are members' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.role IS DISTINCT FROM OLD.role
        OR (NEW.state = 'frozen' AND OLD.state <> 'frozen')
        OR (OLD.state = 'frozen' AND NEW.state = 'active')) THEN
      RAISE EXCEPTION 'role and freeze changes require an admin' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_user();
