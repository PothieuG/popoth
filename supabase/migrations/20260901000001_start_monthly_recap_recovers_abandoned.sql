-- Sprint Abandoned-Recap-Recovery (2026-09-01).
--
-- CREATE OR REPLACE de start_monthly_recap : SIGNATURE INCHANGEE (donc pas de
-- DROP FUNCTION, pas de regeneration de signature cote codegen Supabase, et
-- EXPECTED_RPCS reste a 29 dans scripts/check-rpcs.mjs).
--
-- Ce qui change : un bloc de BALAYAGE en tete du corps. Avant toute chose, la
-- fonction recupere les bilans du meme proprietaire restes ouverts sur des
-- periodes STRICTEMENT anterieures a celle demandee, recredite leurs refloats
-- sur la tirelire, et les marque `abandoned_at`. Cf. la migration
-- 20260901000000 pour le pourquoi complet.
--
-- Pourquoi FUSIONNER le balayage ici plutot qu'une RPC separee appelee avant :
-- `start_monthly_recap` est le SEUL point d'ouverture d'un bilan, et la fusion
-- fait tenir "credit tirelire + marquage abandonne + ecriture de recovery_data"
-- dans UNE SEULE transaction. Avec deux appels distincts, un crash entre les
-- deux laisserait un remboursement sans trace (ou une trace sans remboursement).
-- Consequence assumee : cette RPC deplace desormais de l'argent reel. Elle passe
-- par la RPC composite `update_piggy_bank_amount` -- jamais un UPDATE direct sur
-- `piggy_bank.amount` -- conformement a la regle des colonnes sensibles.
--
-- Le contrat des 4 resultats est preserve ('created' | 'resumed' | 'completed' |
-- 'locked_by_other'). La cle `recovered` est AJOUTEE au JSON de retour ; les
-- consommateurs qui l'ignorent ne voient aucun changement.
--
-- ATTENTION : ne PAS ajouter de filtre `abandoned_at IS NULL` dans
-- check-status.ts / active-recap.ts. Le predicat de balayage etant STRICTEMENT
-- anterieur (recap_year, recap_month) < (p_year, p_month), une ligne abandonnee
-- est toujours d'une periode passee, donc deja hors du filtre de periode de ces
-- lectures. Ajouter le filtre les ferait repondre `no_recap` sur une ligne
-- presente, puis buter sur l'index unique partiel au prochain start.

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
  v_abandoned_ids uuid[];
  v_recovered_total numeric(14,2);
  v_recovered_periods jsonb;
  v_recovered json;
BEGIN
  -- Mutual-exclusivity guard : exactement 1 des 2 ownerships doit etre set,
  -- aligne avec la contrainte monthly_recaps_owner_exclusive_check.
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'start_monthly_recap: exactly one of p_profile_id / p_group_id must be non-null';
  END IF;

  IF p_started_by_profile_id IS NULL THEN
    RAISE EXCEPTION 'start_monthly_recap: p_started_by_profile_id is required';
  END IF;

  -- ==========================================================================
  -- BALAYAGE des bilans abandonnes (Sprint Abandoned-Recap-Recovery)
  -- ==========================================================================
  -- Verrou d'abord : FOR UPDATE est interdit dans une requete qui agrege, donc
  -- on verrouille en PERFORM puis on agrege dans un second temps. Les deux
  -- predicats DOIVENT rester identiques.
  --
  -- Le FILTER sur jsonb_agg plus bas ne garde dans `periods` que les periodes
  -- qui ont REELLEMENT coute de l'argent : une ligne abandonnee avant l'etape
  -- de renflouement est marquee `abandoned_at` comme les autres, mais ne doit
  -- rien declencher a l'ecran (decision produit 2026-09-01 : archivage
  -- silencieux a 0 EUR). array_agg(id) et SUM portent bien, eux, sur TOUTES
  -- les lignes balayees.
  PERFORM 1
     FROM monthly_recaps
    WHERE completed_at IS NULL
      AND abandoned_at IS NULL
      AND ( (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
         OR (p_group_id   IS NOT NULL AND group_id   = p_group_id) )
      AND (recap_year, recap_month) < (p_year, p_month)
      FOR UPDATE;

  SELECT
    COALESCE(SUM(refloated_from_piggy + refloated_from_savings), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'month',  recap_month,
          'year',   recap_year,
          'amount', refloated_from_piggy + refloated_from_savings
        )
        ORDER BY recap_year, recap_month
      ) FILTER (WHERE refloated_from_piggy + refloated_from_savings > 0),
      '[]'::jsonb
    ),
    COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_recovered_total, v_recovered_periods, v_abandoned_ids
    FROM monthly_recaps
   WHERE completed_at IS NULL
     AND abandoned_at IS NULL
     AND ( (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
        OR (p_group_id   IS NOT NULL AND group_id   = p_group_id) )
     AND (recap_year, recap_month) < (p_year, p_month);

  IF v_recovered_total > 0 THEN
    -- Miroir SQL de lib/finance/piggy-bank.ts::ensurePiggyBankRow : la RPC
    -- update_piggy_bank_amount RAISE explicitement quand son UPDATE touche
    -- 0 ligne (proprietaire sans historique de tirelire). L'INSERT idempotent
    -- est donc un PREREQUIS, pas une precaution. Le XOR d'ownership est deja
    -- garanti par la garde du haut, donc piggy_bank_owner_exclusive_check passe.
    INSERT INTO piggy_bank (profile_id, group_id, amount)
    VALUES (p_profile_id, p_group_id, 0)
    ON CONFLICT DO NOTHING;

    PERFORM update_piggy_bank_amount(v_recovered_total, p_profile_id, p_group_id);
  END IF;

  IF array_length(v_abandoned_ids, 1) IS NOT NULL THEN
    UPDATE monthly_recaps
       SET abandoned_at = now()
     WHERE id = ANY(v_abandoned_ids);
  END IF;

  v_recovered := json_build_object(
    'total', v_recovered_total,
    'periods', v_recovered_periods
  );
  -- ==========================================================================

  -- Tentative INSERT : succes si aucune ligne ne matche les partial unique
  -- indexes (profile ou group + month + year). En cas de conflit DO NOTHING,
  -- v_recap.id reste NULL et on entre dans la branche de lecture.
  INSERT INTO monthly_recaps (
    profile_id, group_id, recap_month, recap_year,
    current_step, started_by_profile_id, started_at
  )
  VALUES (
    p_profile_id, p_group_id, p_month, p_year,
    'welcome', p_started_by_profile_id, now()
  )
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_recap;

  IF v_recap.id IS NOT NULL THEN
    IF v_recovered_total > 0 THEN
      UPDATE monthly_recaps
         SET recovery_data = jsonb_build_object(
               'total',   COALESCE((recovery_data->>'total')::numeric, 0) + v_recovered_total,
               'periods', COALESCE(recovery_data->'periods', '[]'::jsonb) || v_recovered_periods
             )
       WHERE id = v_recap.id
      RETURNING * INTO v_recap;
    END IF;
    RETURN json_build_object('result', 'created', 'recap', row_to_json(v_recap), 'recovered', v_recovered);
  END IF;

  -- Ligne deja existante : la lire pour discriminer entre 'completed',
  -- 'resumed' (caller == initiateur OU orpheline), et 'locked_by_other'.
  SELECT * INTO v_recap FROM monthly_recaps
   WHERE recap_month = p_month
     AND recap_year = p_year
     AND ( (p_profile_id IS NOT NULL AND profile_id = p_profile_id)
        OR (p_group_id   IS NOT NULL AND group_id   = p_group_id) );

  IF v_recap.id IS NULL THEN
    -- Theoriquement impossible (ON CONFLICT a fired donc une ligne existe)
    -- mais belt-and-suspenders : si on arrive ici, signaler clairement.
    RAISE EXCEPTION 'start_monthly_recap: inconsistent state -- conflict on insert but no row found on select';
  END IF;

  -- 'completed' et 'locked_by_other' beneficient quand meme du balayage
  -- ci-dessus (l'argent est revenu dans la tirelire) mais n'ecrivent PAS de
  -- recovery_data : il n'y a pas de wizard a afficher dans ces deux cas.
  IF v_recap.completed_at IS NOT NULL THEN
    RETURN json_build_object('result', 'completed', 'recap', row_to_json(v_recap), 'recovered', v_recovered);
  END IF;

  -- Branche 'resumed' : caller est l'initiateur OU la ligne est orpheline
  -- (started_by_profile_id IS NULL, cas d'un INSERT precedent ayant flague
  -- la FK en SET NULL via cascade DELETE sur profiles). Dans les 2 cas on
  -- re-claim la ligne avec le caller comme initiateur. started_at reste
  -- inchange si deja set (idempotent).
  IF v_recap.started_by_profile_id IS NULL
     OR v_recap.started_by_profile_id = p_started_by_profile_id THEN
    UPDATE monthly_recaps
       SET started_by_profile_id = p_started_by_profile_id,
           started_at = COALESCE(started_at, now()),
           -- Fusion (et non ecrasement) : si la ligne portait deja une annonce
           -- non consommee, les montants et les periodes s'ajoutent.
           recovery_data = CASE
             WHEN v_recovered_total > 0 THEN jsonb_build_object(
               'total',   COALESCE((recovery_data->>'total')::numeric, 0) + v_recovered_total,
               'periods', COALESCE(recovery_data->'periods', '[]'::jsonb) || v_recovered_periods
             )
             ELSE recovery_data
           END
     WHERE id = v_recap.id
    RETURNING * INTO v_recap;
    RETURN json_build_object('result', 'resumed', 'recap', row_to_json(v_recap), 'recovered', v_recovered);
  END IF;

  -- Verrou actif d'un autre initiateur (group context uniquement).
  RETURN json_build_object('result', 'locked_by_other', 'recap', row_to_json(v_recap), 'recovered', v_recovered);
END;
$$;

REVOKE ALL ON FUNCTION start_monthly_recap(smallint, smallint, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_monthly_recap(smallint, smallint, uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
