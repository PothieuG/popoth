-- Sprint Salary-Reception (2026-10-02).
--
-- Constat (récap de septembre 2026, compte réel) : un utilisateur payé le 28
-- saisit sa paie comme un revenu du mois en cours pour que son solde soit
-- juste. Or cette paie finance le mois SUIVANT, et le reste à vivre compte déjà
-- le salaire du mois automatiquement (`profiles.salary`). Résultat : la paie
-- comptait deux fois, le récap la prenait pour un excédent (2 703,81 € envoyés
-- en tirelire pour un vrai bilan de −56,37 €), et la ligne « Salaire »
-- automatique créée à la fin du récap l'aurait ajoutée une seconde fois au
-- solde.
--
-- « Réception du salaire » : une saisie dédiée (espace perso uniquement).
--
--   1. À la réception — `receive_salary_in_advance` : une ligne « Salaire » est
--      créée, déjà appliquée au solde, pour le montant RÉELLEMENT reçu. Elle
--      n'est ni exceptionnelle ni rattachée à un revenu estimé : elle ne touche
--      donc pas le reste à vivre du mois en cours.
--
--   2. À la fin du récap — `create_salary_income_for_recap` : au lieu de créer
--      une nouvelle ligne « Salaire » à valider, la RPC ADOPTE la réception.
--      Elle devient la ligne salaire du mois qui s'ouvre (déjà validée), ramenée
--      au salaire déclaré ; l'écart reçu − déclaré devient un « Équilibrage
--      salaire » exceptionnel du nouveau mois (revenu si plus, dépense si
--      moins). Le solde n'est PAS retouché : il a reçu le montant réel à la
--      réception. État final identique à « ligne automatique validée au montant
--      réel » (`validate_salary_with_delta`), seul le moment du crédit change.
--
--   3. `process_recap_transactions` ne doit ni supprimer ni reporter une
--      réception en attente d'adoption (elle appartient au mois suivant).
--
-- Colonne nullable SANS défaut (même choix que 20261001000000) : NULL = ligne
-- ordinaire. TRUE = réception en attente d'adoption ; remise à NULL à
-- l'adoption (la ligne est alors une ligne salaire classique, reconnue par
-- `recap_origin_id`).

ALTER TABLE real_income_entries
  ADD COLUMN salary_reception boolean;

COMMENT ON COLUMN real_income_entries.salary_reception IS
  'Sprint Salary-Reception (2026-10-02). TRUE = salaire reçu en avance, déjà '
  'appliqué au solde, en attente d''adoption par le prochain récap perso '
  '(create_salary_income_for_recap). Hors reste à vivre du mois en cours. '
  'NULL = ligne ordinaire (y compris une réception déjà adoptée).';

-- Une seule réception en attente par profil : le salaire du mois suivant ne se
-- reçoit qu'une fois.
CREATE UNIQUE INDEX real_income_entries_pending_salary_reception_uniq
  ON real_income_entries (profile_id)
  WHERE salary_reception IS TRUE;

-- ============================================================================
-- receive_salary_in_advance(p_profile_id, p_amount, p_entry_date)
--
-- Enregistre la paie du mois suivant : INSERT de la ligne + crédit du solde,
-- dans la même transaction. Refuse si le profil n'a pas de salaire déclaré, si
-- une ligne salaire automatique attend encore d'être validée (c'est elle qu'il
-- faut valider — `validate_salary_with_delta`), ou si une réception est déjà en
-- attente.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.receive_salary_in_advance(
  p_profile_id uuid,
  p_amount numeric(10, 2),
  p_entry_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_salary numeric(10, 2);
  v_income_id uuid;
  v_balance numeric;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'receive_salary_in_advance: p_profile_id is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'receive_salary_in_advance: p_amount must be positive';
  END IF;

  -- Verrou sur le profil : deux appels simultanés (double clic, deux onglets)
  -- passent l'un après l'autre ; le second tombe sur la garde ci-dessous.
  SELECT salary INTO v_salary
    FROM profiles
   WHERE id = p_profile_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receive_salary_in_advance: profile % not found', p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_salary IS NULL OR v_salary <= 0 THEN
    RAISE EXCEPTION 'receive_salary_in_advance: no salary declared for profile %', p_profile_id
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM real_income_entries
     WHERE profile_id = p_profile_id
       AND recap_origin_id IS NOT NULL
       AND applied_to_balance_at IS NULL
  ) THEN
    RAISE EXCEPTION 'receive_salary_in_advance: a salary line is still awaiting validation'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM real_income_entries
     WHERE profile_id = p_profile_id
       AND salary_reception IS TRUE
  ) THEN
    RAISE EXCEPTION 'receive_salary_in_advance: a salary reception is already pending'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO real_income_entries (
    profile_id,
    group_id,
    amount,
    description,
    entry_date,
    is_exceptional,
    is_carried_over,
    applied_to_balance_at,
    last_applied_amount,
    salary_reception,
    created_by_profile_id
  ) VALUES (
    p_profile_id,
    NULL,
    p_amount,
    'Salaire',
    COALESCE(p_entry_date, CURRENT_DATE),
    false,
    false,
    NOW(),
    p_amount,
    true,
    p_profile_id
  )
  RETURNING id INTO v_income_id;

  v_balance := update_bank_balance(p_amount, p_profile_id, NULL);

  RETURN jsonb_build_object(
    'income_id', v_income_id,
    'amount', p_amount,
    'expected_salary', v_salary,
    'delta', ROUND(p_amount - v_salary, 2),
    'balance', v_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_salary_in_advance(uuid, numeric, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_salary_in_advance(uuid, numeric, date) TO service_role;

-- ============================================================================
-- process_recap_transactions — même nom, même signature que 20260705000000.
-- Seul changement : les 2 instructions sur `real_income_entries` épargnent une
-- réception de salaire en attente (`salary_reception IS TRUE`). Sans ça, la
-- réception (validée) serait SUPPRIMÉE à la clôture du mois où elle a été
-- saisie, alors qu'elle doit devenir la ligne salaire du mois suivant.
-- ============================================================================
CREATE OR REPLACE FUNCTION process_recap_transactions(
  p_recap_id uuid,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_expenses int := 0;
  v_deleted_incomes int := 0;
  v_carried_expenses int := 0;
  v_carried_incomes int := 0;
BEGIN
  IF p_recap_id IS NULL THEN
    RAISE EXCEPTION 'process_recap_transactions: p_recap_id is required';
  END IF;

  -- Mutual-exclusivity guard : exactement 1 des 2 owner-ids doit être set
  -- (mirror de la CHECK constraint monthly_recaps_owner_exclusive_check).
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'process_recap_transactions: exactly one of p_profile_id / p_group_id must be non-null';
  END IF;

  -- 1. DELETE real_expenses validées (applied_to_balance_at IS NOT NULL) —
  --    exempte les mirrors contribution (perpétuels, jamais supprimés ici).
  WITH deleted AS (
    DELETE FROM real_expenses
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_expenses FROM deleted;

  -- 2. DELETE real_income_entries validées — idem, et épargne la réception de
  --    salaire en attente (adoptée juste après par create_salary_income_for_recap).
  WITH deleted AS (
    DELETE FROM real_income_entries
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND salary_reception IS NOT TRUE
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_incomes FROM deleted;

  -- 3. Flag non-validées (real_expenses) comme carried_over — idem (sinon
  --    un mirror non-validé se ferait exclure du RAV pour toujours, rien ne
  --    réinitialise carried_from_recap_id/is_carried_over pour ces rows).
  WITH updated AS (
    UPDATE real_expenses
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_expenses FROM updated;

  -- 4. Flag non-validées (real_income_entries) comme carried_over — idem. Une
  --    réception retirée du solde par l'utilisateur n'est pas « reportée » :
  --    elle redevient la ligne salaire à valider du mois suivant.
  WITH updated AS (
    UPDATE real_income_entries
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND salary_reception IS NOT TRUE
       AND (p_profile_id IS NULL OR profile_id = p_profile_id)
       AND (p_group_id   IS NULL OR group_id   = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_incomes FROM updated;

  RETURN json_build_object(
    'deleted_expenses', v_deleted_expenses,
    'deleted_incomes',  v_deleted_incomes,
    'carried_expenses', v_carried_expenses,
    'carried_incomes',  v_carried_incomes
  );
END;
$$;

REVOKE ALL ON FUNCTION process_recap_transactions(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_recap_transactions(uuid, uuid, uuid) TO service_role;

-- ============================================================================
-- create_salary_income_for_recap — même nom, même signature que
-- 20260605000001. Nouveau : si une réception de salaire est en attente, elle
-- est adoptée comme ligne salaire du récap au lieu d'en créer une nouvelle.
--
-- Retour (les clés historiques sont conservées) :
--   { created, reason?, income_id?, amount?, adopted?, validated?, received?, delta? }
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_salary_income_for_recap(
  p_recap_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_salary numeric(10, 2);
  v_inserted_id uuid;
  v_reception real_income_entries%ROWTYPE;
  v_received numeric(10, 2);
  v_delta numeric(10, 2);
BEGIN
  -- Lit le salaire (peut être NULL si profile incomplet ; le default
  -- applicatif est 0 mais la colonne est nullable côté schema).
  SELECT salary INTO v_salary
    FROM profiles
   WHERE id = p_profile_id;

  -- Idempotence : la ligne salaire de ce récap existe déjà (rejeu du finalize).
  -- Vérifié AVANT l'adoption, pour ne jamais adopter une seconde réception.
  IF EXISTS (SELECT 1 FROM real_income_entries WHERE recap_origin_id = p_recap_id) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already_exists');
  END IF;

  SELECT * INTO v_reception
    FROM real_income_entries
   WHERE profile_id = p_profile_id
     AND salary_reception IS TRUE
   ORDER BY entry_date, created_at
   LIMIT 1
     FOR UPDATE;

  IF FOUND THEN
    -- Plus de salaire déclaré (mis à 0 pendant le récap) : le reste à vivre du
    -- nouveau mois ne compte plus aucun salaire, tout le montant reçu devient
    -- donc un revenu exceptionnel de ce mois.
    IF v_salary IS NULL OR v_salary <= 0 THEN
      UPDATE real_income_entries
         SET salary_reception = NULL,
             is_exceptional = true,
             entry_date = CURRENT_DATE
       WHERE id = v_reception.id;
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'no_salary',
        'income_id', v_reception.id
      );
    END IF;

    -- Réception retirée du solde par l'utilisateur avant le récap : elle
    -- redevient une ligne salaire ordinaire, à valider (appui long).
    IF v_reception.applied_to_balance_at IS NULL THEN
      UPDATE real_income_entries
         SET amount = v_salary,
             last_applied_amount = NULL,
             salary_reception = NULL,
             recap_origin_id = p_recap_id,
             entry_date = CURRENT_DATE
       WHERE id = v_reception.id;
      RETURN jsonb_build_object(
        'created', true,
        'adopted', true,
        'validated', false,
        'income_id', v_reception.id,
        'amount', v_salary
      );
    END IF;

    -- Cas nominal. Le solde a déjà reçu `v_received` à la réception : on ne le
    -- retouche pas. La ligne est ramenée au salaire déclaré et l'écart devient
    -- un « Équilibrage salaire » exceptionnel, déjà appliqué (son
    -- `last_applied_amount` permet de le retirer du solde comme n'importe
    -- quelle transaction validée).
    v_received := COALESCE(v_reception.last_applied_amount, v_reception.amount);
    v_delta := ROUND(v_received - v_salary, 2);

    UPDATE real_income_entries
       SET amount = v_salary,
           last_applied_amount = v_salary,
           salary_reception = NULL,
           recap_origin_id = p_recap_id,
           entry_date = CURRENT_DATE
     WHERE id = v_reception.id;

    IF v_delta > 0 THEN
      INSERT INTO real_income_entries (
        profile_id, group_id, amount, description, entry_date,
        is_exceptional, is_carried_over, applied_to_balance_at,
        last_applied_amount, created_by_profile_id
      ) VALUES (
        p_profile_id, NULL, v_delta, 'Équilibrage salaire', CURRENT_DATE,
        true, false, NOW(),
        v_delta, p_profile_id
      );
    ELSIF v_delta < 0 THEN
      INSERT INTO real_expenses (
        profile_id, group_id, amount, description, expense_date,
        is_exceptional, is_carried_over, applied_to_balance_at,
        last_applied_amount, created_by_profile_id
      ) VALUES (
        p_profile_id, NULL, ABS(v_delta), 'Équilibrage salaire', CURRENT_DATE,
        true, false, NOW(),
        ABS(v_delta), p_profile_id
      );
    END IF;

    RETURN jsonb_build_object(
      'created', true,
      'adopted', true,
      'validated', true,
      'income_id', v_reception.id,
      'amount', v_salary,
      'received', v_received,
      'delta', v_delta
    );
  END IF;

  -- Pas de réception : comportement historique (ligne à valider).
  -- Skip silencieux si pas de salaire à matérialiser.
  IF v_salary IS NULL OR v_salary <= 0 THEN
    RETURN jsonb_build_object('created', false, 'reason', 'no_salary');
  END IF;

  INSERT INTO real_income_entries (
    profile_id,
    group_id,
    amount,
    description,
    entry_date,
    is_exceptional,
    is_carried_over,
    applied_to_balance_at,
    last_applied_amount,
    recap_origin_id,
    created_by_profile_id
  ) VALUES (
    p_profile_id,
    NULL,
    v_salary,
    'Salaire',
    CURRENT_DATE,
    false,
    false,
    NULL,
    NULL,
    p_recap_id,
    p_profile_id
  )
  ON CONFLICT (recap_origin_id) WHERE recap_origin_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    -- Conflit déjà résolu (rejoue idempotent).
    RETURN jsonb_build_object('created', false, 'reason', 'already_exists');
  END IF;

  RETURN jsonb_build_object('created', true, 'income_id', v_inserted_id, 'amount', v_salary);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_salary_income_for_recap(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_salary_income_for_recap(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
