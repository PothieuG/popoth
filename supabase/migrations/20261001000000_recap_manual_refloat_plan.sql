-- Sprint Recap-Manual-Refloat (2026-10-01).
--
-- Refonte de l'écran « Gestion du déficit » (étape 4 du récap quand le bilan
-- est négatif). L'ancienne cascade automatique et proportionnelle (tirelire →
-- économies → projets → budgets) est remplacée par une répartition MANUELLE :
-- l'utilisateur choisit, source par source, combien il prend dans la
-- tirelire, dans chaque budget (économies puis budget du mois suivant) et
-- dans chaque projet (mensualité du mois).
--
-- Deux changements de fond accompagnent la refonte :
--
--   1. Le surplus des budgets n'est plus perdu en bilan négatif. À l'entrée
--      de l'étape 4, le surplus de chaque budget (estimé − dépensé du mois
--      recapé) est versé dans ses économies (`cumulated_savings`) — comme le
--      fait déjà le flux positif au « Continuer ». Avant ce sprint, rien ne
--      le transformait : il disparaissait à la clôture du récap.
--
--   2. Les choix sont DIFFÉRÉS. « Valider » n'enregistre qu'un plan sur la
--      ligne du récap ; l'argent ne bouge (tirelire débitée, économies
--      retirées) qu'à la finalisation, via `apply_recap_refloat_plan`. Le
--      plan reste modifiable jusque-là. La part « budget du mois suivant »
--      réutilise `budget_snapshot_data` (appliqué au finalize en écrasement
--      de `carryover_spent_amount`) et la part projets réutilise
--      `project_snapshot_data` (appliqué par `apply_recap_projects_snapshot`).
--
-- Colonnes nullables SANS défaut (volontaire) : NULL = « pas encore fait ».
-- Les récaps antérieurs gardent NULL et calculent exactement le même déficit
-- qu'avant. Sans défaut, la prévisualisation d'une restauration de snapshot
-- mensuel ne voit pas de différence NULL vs défaut sur les anciens récaps.
--
-- Récupération d'un récap abandonné (`start_monthly_recap`, Part 41) : rien à
-- changer. Elle rembourse `refloated_from_piggy + refloated_from_savings`
-- (argent DÉJÀ débité par l'ancienne cascade). Le plan différé n'a rien
-- débité tant que le récap n'est pas finalisé, il n'y a donc rien à rendre.
-- Le versement surplus → économies n'est pas annulé (même règle que le flux
-- positif, qui n'est pas défait non plus).

ALTER TABLE monthly_recaps
  ADD COLUMN surplus_savings_data jsonb,
  ADD COLUMN planned_piggy_refloat numeric(14, 2),
  ADD COLUMN planned_savings_refloat jsonb,
  ADD COLUMN refloat_plan_applied_at timestamptz;

ALTER TABLE monthly_recaps
  ADD CONSTRAINT monthly_recaps_planned_piggy_refloat_check
  CHECK (planned_piggy_refloat IS NULL OR planned_piggy_refloat >= 0);

COMMENT ON COLUMN monthly_recaps.surplus_savings_data IS
  'Sprint Recap-Manual-Refloat (2026-10-01). JSONB { [budget_id]: amount } du '
  'surplus versé dans cumulated_savings à l''entrée de l''étape 4 (bilan négatif). '
  'NULL = pas encore fait. Consommé par computeRecapSummary comme '
  'piggy_transfers_data (le surplus versé ne réapparaît pas).';

COMMENT ON COLUMN monthly_recaps.planned_piggy_refloat IS
  'Sprint Recap-Manual-Refloat (2026-10-01). Montant à prendre dans la tirelire, '
  'choisi par l''utilisateur. Différé : débité au finalize par '
  'apply_recap_refloat_plan. NULL = 0.';

COMMENT ON COLUMN monthly_recaps.planned_savings_refloat IS
  'Sprint Recap-Manual-Refloat (2026-10-01). JSONB { [budget_id]: amount } à '
  'retirer des économies de chaque budget. Différé : débité au finalize par '
  'apply_recap_refloat_plan. La part « budget du mois suivant » vit dans '
  'budget_snapshot_data. NULL = {}.';

COMMENT ON COLUMN monthly_recaps.refloat_plan_applied_at IS
  'Sprint Recap-Manual-Refloat (2026-10-01). Horodatage de l''application du plan '
  '(tirelire + économies) par apply_recap_refloat_plan. Garde d''idempotence.';

-- ============================================================================
-- transfer_recap_surplus_to_savings(p_recap_id, p_allocations)
--
-- Verse le surplus de chaque budget dans ses économies, une seule fois par
-- récap. `p_allocations` = { [budget_id]: amount } calculé côté serveur
-- applicatif (computeRecapSummary reste l'unique source du calcul du surplus).
--
-- Idempotent et sûr en concurrence : la ligne du récap est verrouillée
-- (FOR UPDATE) ; si `surplus_savings_data` est déjà renseigné, la RPC ne fait
-- rien. Un double appel simultané (double montage React, deux onglets) ne
-- crédite donc jamais deux fois. Tout ou rien : un échec annule l'ensemble.
-- ============================================================================
CREATE OR REPLACE FUNCTION transfer_recap_surplus_to_savings(
  p_recap_id uuid,
  p_allocations jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recap monthly_recaps%ROWTYPE;
  v_budget_id text;
  v_amount_text text;
  v_amount numeric;
  v_applied jsonb := '{}'::jsonb;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'transfer_recap_surplus_to_savings: p_recap_id is required';
  END IF;

  SELECT * INTO v_recap FROM monthly_recaps WHERE id = p_recap_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_recap_surplus_to_savings: recap % not found', p_recap_id;
  END IF;

  IF v_recap.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'transfer_recap_surplus_to_savings: recap % already completed', p_recap_id;
  END IF;

  IF v_recap.surplus_savings_data IS NOT NULL THEN
    RETURN json_build_object('already_done', true, 'applied', v_recap.surplus_savings_data);
  END IF;

  IF p_allocations IS NOT NULL AND jsonb_typeof(p_allocations) = 'object' THEN
    FOR v_budget_id, v_amount_text IN
      SELECT key, value FROM jsonb_each_text(p_allocations)
    LOOP
      v_amount := round(v_amount_text::numeric, 2);
      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE estimated_budgets
         SET cumulated_savings = COALESCE(cumulated_savings, 0) + v_amount,
             last_savings_update = now()
       WHERE id = v_budget_id::uuid
         AND (
           (v_recap.profile_id IS NOT NULL AND profile_id = v_recap.profile_id)
           OR (v_recap.group_id IS NOT NULL AND group_id = v_recap.group_id)
         );

      IF FOUND THEN
        v_applied := v_applied || jsonb_build_object(v_budget_id, v_amount);
      END IF;
    END LOOP;
  END IF;

  UPDATE monthly_recaps SET surplus_savings_data = v_applied WHERE id = p_recap_id;

  RETURN json_build_object('already_done', false, 'applied', v_applied);
END;
$$;

-- `FROM PUBLIC` ne suffit pas sur Supabase : les privilèges par défaut du
-- schéma public accordent aussi EXECUTE explicitement à anon/authenticated
-- (constaté sur dev le 2026-10-01). Sans ce REVOKE, la fonction — SECURITY
-- DEFINER, donc hors RLS — serait appelable via l'API REST avec la clé publique.
REVOKE ALL ON FUNCTION transfer_recap_surplus_to_savings(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_recap_surplus_to_savings(uuid, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_recap_surplus_to_savings(uuid, jsonb) TO service_role;

-- ============================================================================
-- apply_recap_refloat_plan(p_recap_id)
--
-- Applique au finalize la part « argent réel » du plan de renflouement :
--   - débite la tirelire de `planned_piggy_refloat` ;
--   - débite les économies de chaque budget selon `planned_savings_refloat`.
-- (Les parts budget du mois suivant et projets sont appliquées par
-- finalize_recap_apply_snapshot et apply_recap_projects_snapshot.)
--
-- Atomique : tout ou rien. Si une économie ou la tirelire devenait négative,
-- l'exception annule tout (le finalize applicatif remonte un avertissement).
-- Idempotent : `refloat_plan_applied_at` est posé dans la même transaction ;
-- un second appel ne débite rien.
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_recap_refloat_plan(
  p_recap_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recap monthly_recaps%ROWTYPE;
  v_piggy numeric;
  v_budget_id text;
  v_amount_text text;
  v_amount numeric;
  v_new_savings numeric;
  v_savings_applied jsonb := '[]'::jsonb;
  v_savings_total numeric := 0;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'apply_recap_refloat_plan: p_recap_id is required';
  END IF;

  SELECT * INTO v_recap FROM monthly_recaps WHERE id = p_recap_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_recap_refloat_plan: recap % not found', p_recap_id;
  END IF;

  IF v_recap.refloat_plan_applied_at IS NOT NULL THEN
    RETURN json_build_object(
      'already_applied', true,
      'piggy_debited', 0,
      'savings_debited', '[]'::jsonb,
      'savings_total', 0
    );
  END IF;

  -- 1. Tirelire. update_piggy_bank_amount lève si la ligne manque ou si le
  --    montant deviendrait négatif → rollback de toute la transaction.
  v_piggy := round(COALESCE(v_recap.planned_piggy_refloat, 0), 2);
  IF v_piggy > 0 THEN
    PERFORM update_piggy_bank_amount(-v_piggy, v_recap.profile_id, v_recap.group_id);
  END IF;

  -- 2. Économies des budgets (owner-scoped).
  IF v_recap.planned_savings_refloat IS NOT NULL
     AND jsonb_typeof(v_recap.planned_savings_refloat) = 'object' THEN
    FOR v_budget_id, v_amount_text IN
      SELECT key, value FROM jsonb_each_text(v_recap.planned_savings_refloat)
    LOOP
      v_amount := round(v_amount_text::numeric, 2);
      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE estimated_budgets
         SET cumulated_savings = COALESCE(cumulated_savings, 0) - v_amount,
             last_savings_update = now()
       WHERE id = v_budget_id::uuid
         AND (
           (v_recap.profile_id IS NOT NULL AND profile_id = v_recap.profile_id)
           OR (v_recap.group_id IS NOT NULL AND group_id = v_recap.group_id)
         )
      RETURNING cumulated_savings INTO v_new_savings;

      IF FOUND THEN
        IF v_new_savings < 0 THEN
          RAISE EXCEPTION
            'apply_recap_refloat_plan: cumulated_savings would become negative for budget % (current: %)',
            v_budget_id, v_new_savings;
        END IF;
        v_savings_applied := v_savings_applied || jsonb_build_array(
          jsonb_build_object('budget_id', v_budget_id, 'amount', v_amount)
        );
        v_savings_total := v_savings_total + v_amount;
      END IF;
    END LOOP;
  END IF;

  UPDATE monthly_recaps SET refloat_plan_applied_at = now() WHERE id = p_recap_id;

  RETURN json_build_object(
    'already_applied', false,
    'piggy_debited', v_piggy,
    'savings_debited', v_savings_applied,
    'savings_total', v_savings_total
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_recap_refloat_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_recap_refloat_plan(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_recap_refloat_plan(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
