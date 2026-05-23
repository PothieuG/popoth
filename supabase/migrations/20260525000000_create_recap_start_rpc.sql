-- Sprint 05 Monthly Recap V3 — RPC atomique start_monthly_recap.
--
-- Sémantique : un appel doit produire exactement un des 4 résultats discrets
-- en 1 transaction (atomicité garantie par les 2 partial unique indexes
-- existants sur monthly_recaps — profile_id+month+year et group_id+month+year) :
--
--   - 'created'         : INSERT réussi (aucune ligne pré-existante)
--   - 'resumed'         : ligne pré-existante en cours, initiateur = caller
--                         (inclut le cas "ligne orpheline" started_by IS NULL
--                          — le caller re-claim avec started_at = now())
--   - 'completed'       : ligne pré-existante avec completed_at NOT NULL
--   - 'locked_by_other' : ligne pré-existante en cours, initiateur ≠ caller
--                         (cas group context uniquement — en profile context
--                          le profile_id matche l'unique constraint donc on
--                          atteint toujours 'resumed')
--
-- Race condition : si 2 membres groupe POST simultanément alors qu'aucune
-- ligne n'existe, un seul INSERT gagne. Le second observe la ligne et reçoit
-- 'locked_by_other'. Pas de lock manuel nécessaire grâce à l'ON CONFLICT
-- DO NOTHING + l'unique index partiel.
--
-- Naming pattern : mirror des autres RPC composites du fichier
-- 20260506000000_create_finance_rpcs.sql (p_ prefix paramètres, SECURITY
-- DEFINER, SET search_path = public, REVOKE PUBLIC / GRANT service_role).
--
-- Param ordering : les paramètres NOT NULL (p_month, p_year, p_started_by_profile_id)
-- sont en premier, puis les paramètres DEFAULT NULL (p_profile_id, p_group_id)
-- en fin de signature. Postgres exige cet ordre quand on mixe avec/sans default,
-- et Supabase codegen s'appuie sur les defaults pour marquer les params TS
-- comme optionnels (pattern miroir de `transfer_savings_between_budgets` et
-- les autres RPC composites finance qui acceptent un seul contexte non-null).

-- Idempotence DROP : tolère les ré-applications de versions itérées (passage
-- antérieur d'un draft sans DEFAULT NULL → signature uuid,uuid,smallint,smallint,uuid).
DROP FUNCTION IF EXISTS start_monthly_recap(uuid, uuid, smallint, smallint, uuid);

CREATE OR REPLACE FUNCTION start_monthly_recap(
  p_month smallint,
  p_year smallint,
  p_started_by_profile_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recap monthly_recaps%ROWTYPE;
BEGIN
  -- Mutual-exclusivity guard : exactement 1 des 2 ownerships doit être set,
  -- aligne avec la contrainte monthly_recaps_owner_exclusive_check.
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'start_monthly_recap: exactly one of p_profile_id / p_group_id must be non-null';
  END IF;

  IF p_started_by_profile_id IS NULL THEN
    RAISE EXCEPTION 'start_monthly_recap: p_started_by_profile_id is required';
  END IF;

  -- Tentative INSERT : succès si aucune ligne ne matche les partial unique
  -- indexes (profile ou group + month + year). En cas de conflit DO NOTHING,
  -- v_recap.id reste NULL et on entre dans la branche de lecture.
  INSERT INTO monthly_recaps (
    profile_id, group_id, recap_month, recap_year,
    current_step, started_by_profile_id, started_at
  )
  VALUES (
    p_profile_id, p_group_id, p_month, p_year,
    'summary', p_started_by_profile_id, now()
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_recap;

  IF v_recap.id IS NOT NULL THEN
    RETURN json_build_object('result', 'created', 'recap', row_to_json(v_recap));
  END IF;

  -- Ligne déjà existante : la lire pour discriminer entre 'completed',
  -- 'resumed' (caller == initiateur OU orpheline), et 'locked_by_other'.
  SELECT * INTO v_recap FROM monthly_recaps
   WHERE recap_month = p_month
     AND recap_year = p_year
     AND ( (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
        OR (p_group_id   IS NOT NULL AND group_id   = p_group_id) );

  IF v_recap.id IS NULL THEN
    -- Théoriquement impossible (ON CONFLICT a fired donc une ligne existe)
    -- mais belt-and-suspenders : si on arrive ici, signaler clairement.
    RAISE EXCEPTION 'start_monthly_recap: inconsistent state — conflict on insert but no row found on select';
  END IF;

  IF v_recap.completed_at IS NOT NULL THEN
    RETURN json_build_object('result', 'completed', 'recap', row_to_json(v_recap));
  END IF;

  -- Branche 'resumed' : caller est l'initiateur OU la ligne est orpheline
  -- (started_by_profile_id IS NULL, cas d'un INSERT précédent ayant flagué
  -- la FK en SET NULL via cascade DELETE sur profiles). Dans les 2 cas on
  -- re-claim la ligne avec le caller comme initiateur. started_at reste
  -- inchangé si déjà set (idempotent).
  IF v_recap.started_by_profile_id IS NULL
     OR v_recap.started_by_profile_id = p_started_by_profile_id THEN
    UPDATE monthly_recaps
       SET started_by_profile_id = p_started_by_profile_id,
           started_at = COALESCE(started_at, now())
     WHERE id = v_recap.id
    RETURNING * INTO v_recap;
    RETURN json_build_object('result', 'resumed', 'recap', row_to_json(v_recap));
  END IF;

  -- Verrou actif d'un autre initiateur (group context uniquement).
  RETURN json_build_object('result', 'locked_by_other', 'recap', row_to_json(v_recap));
END;
$$;

REVOKE ALL ON FUNCTION start_monthly_recap(smallint, smallint, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_monthly_recap(smallint, smallint, uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
