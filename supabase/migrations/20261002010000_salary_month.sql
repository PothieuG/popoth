-- Sprint Salary-Reception, suite (2026-10-02) — le mois financé devient explicite.
--
-- 20261002000000 supposait qu'une paie saisie par « Réception du salaire »
-- finance toujours le mois SUIVANT (cas d'une personne payée le 28). Faux pour
-- une personne payée le 3 : sa paie finance le mois EN COURS. Sans ligne
-- « Salaire » en attente (nouveau compte, récap jamais terminé), l'appli lui
-- annonçait « paie de novembre » un 3 octobre, reportait l'écart d'un mois, et
-- le décalage se reproduisait ensuite chaque mois.
--
-- Nouveau modèle : chaque ligne salaire porte le mois qu'elle FINANCE
-- (`salary_month`, 1er jour du mois), choisi par l'utilisateur parmi le mois
-- ouvert et le suivant. Une seule ligne salaire par profil et par mois.
--
--   - mois ouvert  → la ligne est créée au salaire déclaré, l'écart devient
--                    tout de suite un « Équilibrage salaire » (même résultat
--                    que valider la ligne du récap au montant réel) ;
--   - mois suivant → la ligne porte le montant reçu ; la fin du récap du mois
--                    ouvert l'adopte (inchangé depuis 20261002000000).
--
-- `salary_reception` (booléen « en attente d'adoption ») devient redondant :
-- une ligne attend son adoption quand son `salary_month` suit le mois recapé.
-- La colonne est supprimée — elle n'a jamais atteint la prod.

ALTER TABLE real_income_entries
  ADD COLUMN salary_month date;

ALTER TABLE real_income_entries
  ADD CONSTRAINT real_income_entries_salary_month_first_day_check
  CHECK (salary_month IS NULL OR EXTRACT(DAY FROM salary_month) = 1);

COMMENT ON COLUMN real_income_entries.salary_month IS
  'Sprint Salary-Reception (2026-10-02). 1er jour du mois que cette ligne '
  'salaire FINANCE (pas sa date de réception). NULL = pas une ligne salaire. '
  'Une seule ligne par (profile_id, salary_month). Les lignes salaire ne '
  'pèsent pas sur le reste à vivre : le salaire y entre déjà via profiles.salary.';

-- Reprise de l'existant.
--   1. lignes salaire créées par un récap : elles financent le mois qui suit
--      le mois recapé ;
--   2. réceptions en attente (base de test uniquement) : mois qui suit leur
--      date de réception.
UPDATE real_income_entries r
   SET salary_month = (make_date(m.recap_year::int, m.recap_month::int, 1) + interval '1 month')::date
  FROM monthly_recaps m
 WHERE r.recap_origin_id = m.id
   AND r.profile_id IS NOT NULL
   AND r.salary_month IS NULL;

UPDATE real_income_entries r
   SET salary_month = (date_trunc('month', r.entry_date) + interval '1 month')::date
 WHERE r.salary_reception IS TRUE
   AND r.salary_month IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM real_income_entries o
      WHERE o.profile_id = r.profile_id
        AND o.salary_month = (date_trunc('month', r.entry_date) + interval '1 month')::date
   );

CREATE UNIQUE INDEX real_income_entries_salary_month_uniq
  ON real_income_entries (profile_id, salary_month)
  WHERE salary_month IS NOT NULL;

-- ============================================================================
-- receive_salary(p_profile_id, p_amount, p_salary_month, p_entry_date,
--                p_apply_delta_now)
--
-- Enregistre la paie qui finance `p_salary_month` : ligne « Salaire » + crédit
-- du solde du montant reçu, en une transaction.
--
--   p_apply_delta_now = true  (mois ouvert) : ligne au salaire déclaré + écart
--     en « Équilibrage salaire » exceptionnel, appliqué tout de suite.
--   p_apply_delta_now = false (mois suivant) : ligne au montant reçu ; l'écart
--     sera créé par create_salary_income_for_recap à la fin du récap.
--
-- C'est l'appelant (route receive-salary) qui décide quel mois est « ouvert » :
-- la RPC ne connaît pas la date simulée de la base de test.
--
-- Refuse si le profil n'a pas de salaire déclaré ou si une ligne salaire
-- existe déjà pour ce mois (ERRCODE unique_violation → 409 côté route).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.receive_salary(
  p_profile_id uuid,
  p_amount numeric(10, 2),
  p_salary_month date,
  p_entry_date date DEFAULT NULL,
  p_apply_delta_now boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_salary numeric(10, 2);
  v_month date;
  v_entry_date date := COALESCE(p_entry_date, CURRENT_DATE);
  v_delta numeric(10, 2);
  v_income_id uuid;
  v_balance numeric;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'receive_salary: p_profile_id is required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'receive_salary: p_amount must be positive';
  END IF;

  IF p_salary_month IS NULL THEN
    RAISE EXCEPTION 'receive_salary: p_salary_month is required';
  END IF;

  v_month := date_trunc('month', p_salary_month)::date;

  -- Verrou sur le profil : deux appels simultanés (double clic, deux onglets)
  -- passent l'un après l'autre ; le second tombe sur la garde ci-dessous.
  SELECT salary INTO v_salary
    FROM profiles
   WHERE id = p_profile_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receive_salary: profile % not found', p_profile_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_salary IS NULL OR v_salary <= 0 THEN
    RAISE EXCEPTION 'receive_salary: no salary declared for profile %', p_profile_id
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM real_income_entries
     WHERE profile_id = p_profile_id
       AND salary_month = v_month
  ) THEN
    RAISE EXCEPTION 'receive_salary: a salary line already exists for %', v_month
      USING ERRCODE = 'unique_violation';
  END IF;

  v_delta := ROUND(p_amount - v_salary, 2);

  IF p_apply_delta_now THEN
    INSERT INTO real_income_entries (
      profile_id, group_id, amount, description, entry_date,
      is_exceptional, is_carried_over, applied_to_balance_at,
      last_applied_amount, salary_month, created_by_profile_id
    ) VALUES (
      p_profile_id, NULL, v_salary, 'Salaire', v_entry_date,
      false, false, NOW(),
      v_salary, v_month, p_profile_id
    )
    RETURNING id INTO v_income_id;

    v_balance := update_bank_balance(v_salary, p_profile_id, NULL);

    IF v_delta > 0 THEN
      INSERT INTO real_income_entries (
        profile_id, group_id, amount, description, entry_date,
        is_exceptional, is_carried_over, applied_to_balance_at,
        last_applied_amount, created_by_profile_id
      ) VALUES (
        p_profile_id, NULL, v_delta, 'Équilibrage salaire', v_entry_date,
        true, false, NOW(),
        v_delta, p_profile_id
      );
      v_balance := update_bank_balance(v_delta, p_profile_id, NULL);
    ELSIF v_delta < 0 THEN
      INSERT INTO real_expenses (
        profile_id, group_id, amount, description, expense_date,
        is_exceptional, is_carried_over, applied_to_balance_at,
        last_applied_amount, created_by_profile_id
      ) VALUES (
        p_profile_id, NULL, ABS(v_delta), 'Équilibrage salaire', v_entry_date,
        true, false, NOW(),
        ABS(v_delta), p_profile_id
      );
      v_balance := update_bank_balance(v_delta, p_profile_id, NULL);
    END IF;
  ELSE
    INSERT INTO real_income_entries (
      profile_id, group_id, amount, description, entry_date,
      is_exceptional, is_carried_over, applied_to_balance_at,
      last_applied_amount, salary_month, created_by_profile_id
    ) VALUES (
      p_profile_id, NULL, p_amount, 'Salaire', v_entry_date,
      false, false, NOW(),
      p_amount, v_month, p_profile_id
    )
    RETURNING id INTO v_income_id;

    v_balance := update_bank_balance(p_amount, p_profile_id, NULL);
  END IF;

  RETURN jsonb_build_object(
    'income_id', v_income_id,
    'amount', p_amount,
    'expected_salary', v_salary,
    'delta', v_delta,
    'delta_applied', p_apply_delta_now,
    'salary_month', v_month,
    'balance', v_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_salary(uuid, numeric, date, date, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_salary(uuid, numeric, date, date, boolean) TO service_role;

-- Remplacée par receive_salary (jamais arrivée en prod).
DROP FUNCTION IF EXISTS public.receive_salary_in_advance(uuid, numeric, date);

-- ============================================================================
-- process_recap_transactions — même nom, même signature. Les 2 instructions
-- sur `real_income_entries` épargnent désormais toute ligne salaire qui
-- finance un mois POSTÉRIEUR au mois recapé (au lieu de `salary_reception`).
-- Le salaire du mois recapé lui-même suit la règle générale (validé →
-- supprimé, non validé → reporté).
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
  v_next_month date;
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

  -- 1er jour du mois qui suit le mois recapé. NULL si le récap est introuvable :
  -- aucune ligne salaire n'est alors épargnée (comportement d'avant).
  SELECT (make_date(recap_year::int, recap_month::int, 1) + interval '1 month')::date
    INTO v_next_month
    FROM monthly_recaps
   WHERE id = p_recap_id;

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

  -- 2. DELETE real_income_entries validées — idem, et épargne le salaire d'un
  --    mois à venir (adopté juste après par create_salary_income_for_recap).
  WITH deleted AS (
    DELETE FROM real_income_entries
     WHERE applied_to_balance_at IS NOT NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (salary_month IS NULL OR v_next_month IS NULL OR salary_month < v_next_month)
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

  -- 4. Flag non-validées (real_income_entries) comme carried_over — idem. Le
  --    salaire d'un mois à venir retiré du solde par l'utilisateur n'est pas
  --    « reporté » : il redevient la ligne à valider de ce mois-là.
  WITH updated AS (
    UPDATE real_income_entries
       SET is_carried_over = true,
           carried_from_recap_id = p_recap_id
     WHERE applied_to_balance_at IS NULL
       AND is_carried_over = false
       AND contribution_id IS NULL
       AND (salary_month IS NULL OR v_next_month IS NULL OR salary_month < v_next_month)
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
-- create_salary_income_for_recap — même nom, même signature. La ligne salaire
-- du mois qui s'ouvre est repérée par `salary_month` (mois qui suit le mois
-- recapé) au lieu de `salary_reception`.
--
-- ⚠️ Une ligne déjà présente pour ce mois est forcément une réception « mois
-- suivant » (écart PAS encore appliqué) : tant que le récap n'est pas terminé,
-- ce mois n'est pas le mois ouvert, et la route receive-salary n'applique
-- l'écart immédiatement que pour le mois ouvert. C'est cet invariant qui
-- empêche de compter l'écart deux fois.
--
-- Retour (clés historiques conservées) :
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
  v_month date;
  v_inserted_id uuid;
  v_line real_income_entries%ROWTYPE;
  v_received numeric(10, 2);
  v_delta numeric(10, 2);
BEGIN
  -- Lit le salaire (peut être NULL si profile incomplet ; le default
  -- applicatif est 0 mais la colonne est nullable côté schema).
  SELECT salary INTO v_salary
    FROM profiles
   WHERE id = p_profile_id;

  -- Mois que finance la ligne salaire de ce récap : celui qui suit le mois
  -- recapé. Repli sur le mois courant si le récap est introuvable.
  SELECT (make_date(recap_year::int, recap_month::int, 1) + interval '1 month')::date
    INTO v_month
    FROM monthly_recaps
   WHERE id = p_recap_id;
  v_month := COALESCE(v_month, date_trunc('month', CURRENT_DATE)::date);

  -- Idempotence : la ligne salaire de ce récap existe déjà (rejeu du finalize).
  -- Vérifié AVANT l'adoption, pour ne jamais adopter deux fois.
  IF EXISTS (SELECT 1 FROM real_income_entries WHERE recap_origin_id = p_recap_id) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already_exists');
  END IF;

  SELECT * INTO v_line
    FROM real_income_entries
   WHERE profile_id = p_profile_id
     AND salary_month = v_month
     FOR UPDATE;

  IF FOUND THEN
    -- Plus de salaire déclaré (mis à 0 pendant le récap) : le reste à vivre du
    -- nouveau mois ne compte plus aucun salaire, tout le montant reçu devient
    -- donc un revenu exceptionnel de ce mois.
    IF v_salary IS NULL OR v_salary <= 0 THEN
      UPDATE real_income_entries
         SET salary_month = NULL,
             is_exceptional = true,
             entry_date = CURRENT_DATE
       WHERE id = v_line.id;
      RETURN jsonb_build_object(
        'created', false,
        'reason', 'no_salary',
        'income_id', v_line.id
      );
    END IF;

    -- Réception retirée du solde par l'utilisateur avant le récap : elle
    -- redevient une ligne salaire ordinaire, à valider (appui long).
    IF v_line.applied_to_balance_at IS NULL THEN
      UPDATE real_income_entries
         SET amount = v_salary,
             last_applied_amount = NULL,
             recap_origin_id = p_recap_id,
             entry_date = CURRENT_DATE
       WHERE id = v_line.id;
      RETURN jsonb_build_object(
        'created', true,
        'adopted', true,
        'validated', false,
        'income_id', v_line.id,
        'amount', v_salary
      );
    END IF;

    -- Cas nominal. Le solde a déjà reçu `v_received` à la réception : on ne le
    -- retouche pas. La ligne est ramenée au salaire déclaré et l'écart devient
    -- un « Équilibrage salaire » exceptionnel, déjà appliqué (son
    -- `last_applied_amount` permet de le retirer du solde comme n'importe
    -- quelle transaction validée).
    v_received := COALESCE(v_line.last_applied_amount, v_line.amount);
    v_delta := ROUND(v_received - v_salary, 2);

    UPDATE real_income_entries
       SET amount = v_salary,
           last_applied_amount = v_salary,
           recap_origin_id = p_recap_id,
           entry_date = CURRENT_DATE
     WHERE id = v_line.id;

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
      'income_id', v_line.id,
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
    salary_month,
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
    v_month,
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

-- Les 3 fonctions ne lisent plus `salary_reception` : la colonne peut partir.
DROP INDEX IF EXISTS real_income_entries_pending_salary_reception_uniq;

ALTER TABLE real_income_entries
  DROP COLUMN IF EXISTS salary_reception;

NOTIFY pgrst, 'reload schema';
