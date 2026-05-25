-- Relax the `bank_balances.balance >= 0` invariant.
--
-- Until this migration, both the DB CHECK constraint
-- (`bank_balances_balance_check`) and the RPC guard inside
-- `update_bank_balance` rejected any toggle / mutation that would push the
-- balance below zero. The intent was to prevent silent overdraft bugs in the
-- expense-allocation / income-toggle cascade (Sprint Hardening / H3).
--
-- In practice, the recap mensuel flow surfaces a legitimate scenario where
-- the bank balance must be allowed to go negative: a user can long-press a
-- contribution-au-groupe expense (montant = total des budgets groupe pour
-- ce mois) avant d'avoir appliqué le salaire correspondant au solde — le
-- solde temporaire devient négatif, mais c'est attendu : il remontera quand
-- le revenu salaire sera validé. La protection H3 transformait ce cas
-- nominal en erreur opaque pour l'utilisateur ("Erreur lors de la mise à
-- jour du solde").
--
-- Décision produit 2026-05-25 : autoriser le solde négatif. Le sprint H3
-- est retiré en faveur d'une UX qui accepte les overdrafts intentionnels.
-- Le Zod schema `editBalanceFormSchema` documentait déjà "Bank balance can
-- be negative (legitimate overdraft scenario)" — la DB rattrape l'intention.
--
-- Cleanup :
--   1. DROP CONSTRAINT `bank_balances_balance_check` (CHECK balance >= 0).
--   2. CREATE OR REPLACE `update_bank_balance` sans le guard
--      `IF v_new_balance < 0 THEN RAISE EXCEPTION`. La garde "row not
--      found" est conservée — c'est une vraie erreur applicative.
--   3. NOTIFY pgrst pour reload du schema cache.

-- ============================================================================
-- 1. Drop the CHECK constraint
-- ============================================================================
ALTER TABLE bank_balances
  DROP CONSTRAINT IF EXISTS bank_balances_balance_check;

-- ============================================================================
-- 2. Update the RPC to remove the negative-balance guard
-- ============================================================================
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

  -- Sprint Allow-Bank-Balance-Negative (2026-05-25) : no overdraft guard.
  -- The bank balance is allowed to become negative — the recap mensuel
  -- flow needs it for ordered apply (contribution debit avant salaire
  -- credit). Cf. CLAUDE.md §7 (H3 retired).

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION update_bank_balance(numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_bank_balance(numeric, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
