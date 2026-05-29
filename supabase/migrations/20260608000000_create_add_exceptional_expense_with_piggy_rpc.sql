-- Sprint Exceptional-Expense-Piggy-Funding (2026-05-29)
--
-- RPC composite atomique pour créer une dépense EXCEPTIONNELLE financée en
-- partie (ou totalement) par la tirelire. L'utilisateur choisit un montant à
-- prélever dans sa tirelire (≤ solde) ; le reste (« propre argent ») est porté
-- par le RAV. Le débit tirelire + l'INSERT real_expenses + l'INSERT de la trace
-- expense_savings_sources vivent dans une seule tx — un overdraft ou un INSERT
-- en échec roll back l'ensemble (aucun état partiel, pas d'argent perdu).
--
-- Modèle calqué sur `add_expense_with_breakdown` (20260531010000) ; la
-- différence : estimated_budget_id = NULL + is_exceptional = true, et seul le
-- débit tirelire est appliqué (pas de cumulated_savings budget).
--
-- Sémantique des colonnes sur la ligne créée :
--   - amount_from_piggy_bank = part tirelire (P)
--   - amount_from_budget     = part propre argent (amount - P) — porte le RAV
--   - amount_from_budget_savings = 0 (pas de budget rattaché)
--
-- Suppression : `delete_expense_with_sources_refund` recrédite la tirelire via
-- la trace 'piggy' (ou le fallback legacy amount_from_piggy_bank), sans budget.

CREATE OR REPLACE FUNCTION add_exceptional_expense_with_piggy(
  p_amount numeric,
  p_description text,
  p_expense_date date,
  p_amount_from_piggy_bank numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_created_by_profile_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;
  IF p_amount_from_piggy_bank < 0 OR p_amount_from_piggy_bank > p_amount + 0.01 THEN
    RAISE EXCEPTION 'Piggy amount (%) out of range [0, %]', p_amount_from_piggy_bank, p_amount;
  END IF;

  -- Débit tirelire (si > 0). Ensure-row d'abord pour les comptes neufs sans
  -- ligne piggy_bank — pattern inline INSERT...EXCEPTION (cf.
  -- delete_carried_expense_to_piggy, 20260527000000). update_piggy_bank_amount
  -- RAISE si le solde deviendrait négatif → toute la tx roll back.
  IF p_amount_from_piggy_bank > 0 THEN
    BEGIN
      IF p_profile_id IS NOT NULL THEN
        INSERT INTO piggy_bank (profile_id, group_id, amount) VALUES (p_profile_id, NULL, 0);
      ELSE
        INSERT INTO piggy_bank (profile_id, group_id, amount) VALUES (NULL, p_group_id, 0);
      END IF;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    PERFORM update_piggy_bank_amount(-p_amount_from_piggy_bank, p_profile_id, p_group_id);
  END IF;

  INSERT INTO real_expenses (
    profile_id,
    group_id,
    estimated_budget_id,
    amount,
    description,
    expense_date,
    is_exceptional,
    amount_from_piggy_bank,
    amount_from_budget_savings,
    amount_from_budget,
    created_by_profile_id
  ) VALUES (
    p_profile_id,
    p_group_id,
    NULL,
    p_amount,
    p_description,
    p_expense_date,
    true,
    p_amount_from_piggy_bank,
    0,
    p_amount - p_amount_from_piggy_bank,
    p_created_by_profile_id
  ) RETURNING id INTO v_expense_id;

  -- Trace la source débitée → refund précis au DELETE (chemin tracé de
  -- delete_expense_with_sources_refund, identique aux dépenses budgétées).
  IF p_amount_from_piggy_bank > 0 THEN
    INSERT INTO expense_savings_sources (real_expense_id, source_type, source_budget_id, amount)
      VALUES (v_expense_id, 'piggy', NULL, p_amount_from_piggy_bank);
  END IF;

  RETURN json_build_object('expense_id', v_expense_id);
END;
$$;

REVOKE ALL ON FUNCTION add_exceptional_expense_with_piggy(
  numeric, text, date, numeric, uuid, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_exceptional_expense_with_piggy(
  numeric, text, date, numeric, uuid, uuid, uuid
) TO service_role;

NOTIFY pgrst, 'reload schema';
