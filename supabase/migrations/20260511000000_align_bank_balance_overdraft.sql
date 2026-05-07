-- Align update_bank_balance() with update_piggy_bank_amount() by raising
-- when the new balance would go negative. The CHECK (balance >= 0) on the
-- bank_balances table already rejects overdraft at the DB level, but the
-- RPC was the only one of the four C3 finance helpers without an explicit
-- guard — meaning callers got a generic 23514 CHECK violation instead of
-- a domain-specific message. update_piggy_bank_amount has had this guard
-- since the C3 sprint, this aligns the two so behavior is consistent.
--
-- CREATE OR REPLACE keeps the existing signature (numeric, uuid, uuid),
-- so PostgREST's schema cache and the augmented Database type in
-- lib/database.ts both stay valid without a schema reload.
--
-- Sprint Hardening / H3.

CREATE OR REPLACE FUNCTION update_bank_balance(
  p_delta numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;

  IF p_profile_id IS NOT NULL THEN
    UPDATE bank_balances
       SET balance = balance + p_delta
     WHERE profile_id = p_profile_id
       AND group_id IS NULL
    RETURNING balance INTO v_new_balance;
  ELSE
    UPDATE bank_balances
       SET balance = balance + p_delta
     WHERE group_id = p_group_id
       AND profile_id IS NULL
    RETURNING balance INTO v_new_balance;
  END IF;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'bank_balances row not found for the given context';
  END IF;

  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'bank_balances balance cannot become negative (current: %)', v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION update_bank_balance(numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_bank_balance(numeric, uuid, uuid) TO service_role;
