-- Sprint Carryover-Self-Healing 2026-05-26 — réécrit
-- `finalize_recap_apply_snapshot` en sémantique OVERWRITE :
--
--   - Reset à 0 de `carryover_spent_amount` pour TOUS les budgets de l'owner
--     du recap (XOR profile_id / group_id, miroir
--     `monthly_recaps_owner_exclusive_check`).
--   - Pour chaque entry du snapshot, SET carryover_spent_amount = v_amount
--     (PAS `+= v_amount`). Le snapshot est la dette authoritative reportée
--     au mois suivant.
--
-- Mécanique self-healing (lib/finance/financial-data.ts L168-184) :
--   bilan_deficit(N+1) = max(0, old_carryover + spent_this_month - estimated)
--   La "marge libre" du budget (estimated - spent) absorbe le carryover en
--   cours de mois ; seul le résidu (si dépassement) est capturé dans le
--   nouveau snapshot. Trajectoire (carryover=800, estimated=200, spent=0) :
--   800 → 600 → 400 → 200 → 0 (linéaire à estimated/mois).
--
-- Précédent additive `+= v_amount` introduit Sprint 08 V3 2026-05-26
-- (migration 20260526000000_create_recap_finalize_rpcs.sql L70) — bug
-- runaway exponentiel quand snapshot non plafonné fait franchir
-- `estimated_amount`. Voir operational-rules.md §5 "NE PAS réintroduire +="
-- pour la règle de garde.
--
-- Signature inchangée (uuid, jsonb) RETURNS json. Owner récupéré en interne
-- via SELECT sur monthly_recaps depuis p_recap_id (PAS de nouveau paramètre
-- — préserve compat call sites + tests existants).
--
-- Retour étendu : { applied: [...], reset_count: N } pour traçabilité.
--   - applied     : entries effectivement UPDATE-ées du snapshot
--   - reset_count : nombre de budgets owner réinitialisés à 0
--
-- Idempotent : re-exécution avec mêmes args = même état final.

CREATE OR REPLACE FUNCTION finalize_recap_apply_snapshot(
  p_recap_id uuid,
  p_snapshot jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_profile_id uuid;
  v_owner_group_id uuid;
  v_budget_id text;
  v_amount_text text;
  v_amount numeric;
  v_applied jsonb := '[]'::jsonb;
  v_reset_count int := 0;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'finalize_recap_apply_snapshot: p_recap_id is required';
  END IF;

  -- 1. Récupère l'owner du recap (XOR exclusif profile/group).
  SELECT profile_id, group_id
    INTO v_owner_profile_id, v_owner_group_id
    FROM monthly_recaps
   WHERE id = p_recap_id;

  IF v_owner_profile_id IS NULL AND v_owner_group_id IS NULL THEN
    RAISE EXCEPTION
      'finalize_recap_apply_snapshot: recap % not found or owner-less', p_recap_id;
  END IF;

  -- 2. Reset OWNER-SCOPED de carryover_spent_amount → 0 pour tous les budgets
  --    de l'owner. Filtrage XOR miroir exact de monthly_recaps.
  WITH reset AS (
    UPDATE estimated_budgets
       SET carryover_spent_amount = 0,
           carryover_applied_date = now()
     WHERE (v_owner_profile_id IS NOT NULL AND profile_id = v_owner_profile_id)
        OR (v_owner_group_id   IS NOT NULL AND group_id   = v_owner_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_reset_count FROM reset;

  -- 3. Applique le snapshot OVERWRITE (SET, pas +=) sur les budgets listés.
  --    La sécurité d'isolation owner est portée par l'étape 1+2 (les budgets
  --    hors-owner ne sont pas reset, et l'authoring de
  --    monthly_recaps.budget_snapshot_data côté serveur
  --    `executeSaveBudgetSnapshot` est lui-même owner-scoped via
  --    loadRecapSummary). Pas de re-filter inline pour rester cohérent avec
  --    le shape v1 de la RPC.
  IF p_snapshot IS NOT NULL AND jsonb_typeof(p_snapshot) = 'object' THEN
    FOR v_budget_id, v_amount_text IN
      SELECT key, value::text FROM jsonb_each_text(p_snapshot)
    LOOP
      v_amount := v_amount_text::numeric;

      UPDATE estimated_budgets
         SET carryover_spent_amount = v_amount,
             carryover_applied_date = now()
       WHERE id = v_budget_id::uuid;

      IF FOUND THEN
        v_applied := v_applied || jsonb_build_array(
          jsonb_build_object('budget_id', v_budget_id, 'amount', v_amount)
        );
      END IF;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'applied', v_applied,
    'reset_count', v_reset_count
  );
END;
$$;

REVOKE ALL ON FUNCTION finalize_recap_apply_snapshot(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_recap_apply_snapshot(uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
