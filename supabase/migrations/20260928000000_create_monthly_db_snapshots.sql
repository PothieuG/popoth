-- Sprint Monthly-DB-Snapshot (2026-09-28) — snapshot automatique des données
-- financières le dernier jour de chaque mois à 23h45 (heure de Paris), et
-- restauration GLOBALE par commande (scripts/db-snapshot.mjs).
--
-- But : filet de sécurité du Monthly Recap. Si un bilan corrompt les données,
-- on remet toute l'appli dans l'état de la veille du récap et on le rejoue.
-- Tout ce qui a été saisi depuis le snapshot est perdu (listé par l'aperçu).
--
-- Choix de conception :
--
--   * Schéma dédié `snapshots`, hors PostgREST. Aucun accès pour anon /
--     authenticated / service_role : seul le propriétaire (postgres — pg_cron
--     et la Management API du script CLI) lit et écrit. Les fonctions restent
--     SECURITY INVOKER : rien à élever, donc aucun vecteur d'élévation. Ce ne
--     sont pas des RPC applicatives : EXPECTED_RPCS reste à 28.
--
--   * Stockage générique JSONB : 1 ligne par (snapshot, table) portant le
--     tableau des lignes. Ajouter ou retirer une colonne plus tard ne casse ni
--     la prise ni la restauration (colonne absente du snapshot → DEFAULT).
--
--   * La prise est UNE seule requête (INSERT ... SELECT ... UNION ALL) : une
--     requête voit une image MVCC unique, donc un état cohérent entre tables
--     même si l'app écrit pendant la prise — sans poser de verrou.
--
--   * Restauration en une transaction : verrou exclusif sur les tables
--     concernées, snapshot de sécurité 'pre_restore' (pour pouvoir annuler),
--     triggers métier coupés (sinon recalcul des contributions et lignes
--     miroir en cascade par-dessus les données restaurées), TRUNCATE puis
--     ré-insertion dans l'ordre des FK. Les FK restent vérifiées : seuls les
--     triggers « utilisateur » sont coupés, pas les triggers système.
--
--   * profiles / groups ne sont jamais supprimés ni recréés (comptes auth,
--     notes, sessions) : seules leurs colonnes financières sont remises
--     (salary, group_id ; monthly_budget_estimate, monthly_income_estimate).
--
--   * notes exclues : le récap n'y touche pas, et rembobiner effacerait les
--     pense-bêtes écrits depuis.
--
--   * Planification pg_cron (UTC uniquement) : le job tourne à 21h45 ET 22h45
--     UTC du 28 au 31. La fonction ne fait la copie que s'il est 23h ce
--     dernier jour du mois à Paris — une seule des deux exécutions passe, été
--     comme hiver. Rétention : 12 snapshots de fin de mois.
--
-- Garde-fou : `pnpm db:check-snapshots` (fonctions présentes, job actif,
-- aucune table publique oubliée, snapshot du mois écoulé bien pris).

-- ============================================================================
-- Schéma + tables
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS snapshots;
REVOKE ALL ON SCHEMA snapshots FROM PUBLIC;
REVOKE ALL ON SCHEMA snapshots FROM anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS snapshots.db_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- month_end : job pg_cron. manual : `db-snapshot.mjs take`.
  -- pre_restore : pris automatiquement juste avant une restauration.
  kind text NOT NULL CHECK (kind IN ('month_end', 'manual', 'pre_restore')),
  -- Mois (heure de Paris) au moment de la prise. Pour un month_end, c'est le
  -- mois qui se termine, donc celui que le prochain récap va traiter.
  period_year smallint NOT NULL,
  period_month smallint NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  taken_at timestamp with time zone NOT NULL DEFAULT now(),
  note text,
  table_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  restored_at timestamp with time zone
);

-- Un seul snapshot de fin de mois par période : rend le job idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS db_snapshots_month_end_unique
  ON snapshots.db_snapshots (period_year, period_month)
  WHERE kind = 'month_end';

CREATE TABLE IF NOT EXISTS snapshots.db_snapshot_tables (
  snapshot_id uuid NOT NULL REFERENCES snapshots.db_snapshots (id) ON DELETE CASCADE,
  table_name text NOT NULL,
  row_count integer NOT NULL,
  rows jsonb NOT NULL,
  PRIMARY KEY (snapshot_id, table_name)
);

-- Deny-all par défense en profondeur : le schéma n'est déjà pas exposé.
ALTER TABLE snapshots.db_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots.db_snapshot_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA snapshots FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- Périmètre
-- ============================================================================

-- Tables rembobinées (TRUNCATE + ré-insertion), dans l'ordre des FK : une
-- table n'apparaît qu'après toutes celles qu'elle référence. Toute nouvelle
-- table publique doit être ajoutée ici, ou dans les exclusions de
-- uncovered_tables() — `pnpm db:check-snapshots` échoue sinon.
CREATE OR REPLACE FUNCTION snapshots.restorable_tables()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'estimated_budgets',
    'estimated_incomes',
    'savings_projects',
    'piggy_bank',
    'bank_balances',
    'group_contributions',
    'monthly_recaps',
    'budget_transfers',
    'real_expenses',
    'real_income_entries',
    'expense_savings_sources',
    'remaining_to_live_snapshots'
  ]::text[]
$$;

-- Tables publiques ni rembobinées, ni partiellement remises (profiles,
-- groups), ni volontairement exclues (notes). Doit rester vide.
CREATE OR REPLACE FUNCTION snapshots.uncovered_tables()
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), '{}'::text[])
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relname::text <> ALL (
       snapshots.restorable_tables() || ARRAY['profiles', 'groups', 'notes']::text[]
     )
$$;

-- Lignes d'une table dans un snapshot ('[]' si la table n'y figure pas).
CREATE OR REPLACE FUNCTION snapshots.snapshot_rows(p_snapshot_id uuid, p_table text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.rows
       FROM snapshots.db_snapshot_tables s
      WHERE s.snapshot_id = p_snapshot_id AND s.table_name = p_table),
    '[]'::jsonb
  )
$$;

-- Libellé lisible d'un propriétaire, pour l'aperçu.
CREATE OR REPLACE FUNCTION snapshots.owner_label(p_profile_id uuid, p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_group_id IS NOT NULL THEN
      'Groupe ' || COALESCE((SELECT g.name FROM public.groups g WHERE g.id = p_group_id), p_group_id::text)
    WHEN p_profile_id IS NOT NULL THEN
      COALESCE(
        (SELECT trim(p.first_name || ' ' || p.last_name) FROM public.profiles p WHERE p.id = p_profile_id),
        p_profile_id::text
      )
    ELSE '?'
  END
$$;

-- ============================================================================
-- Prise
-- ============================================================================

-- p_period_at ne sert qu'à étiqueter la période (surchargé par les tests).
CREATE OR REPLACE FUNCTION snapshots.take_db_snapshot(
  p_kind text DEFAULT 'manual',
  p_note text DEFAULT NULL,
  p_period_at timestamp with time zone DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
SET timezone TO 'UTC'
AS $$
DECLARE
  v_id uuid;
  v_paris timestamp := p_period_at AT TIME ZONE 'Europe/Paris';
  v_select text;
BEGIN
  INSERT INTO snapshots.db_snapshots (kind, period_year, period_month, note)
  VALUES (p_kind, EXTRACT(YEAR FROM v_paris)::smallint, EXTRACT(MONTH FROM v_paris)::smallint, p_note)
  RETURNING id INTO v_id;

  SELECT string_agg(
           format(
             'SELECT %L::text AS table_name, count(*)::integer AS row_count, '
             'COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) AS rows FROM public.%I t',
             tbl, tbl
           ),
           ' UNION ALL '
         )
    INTO v_select
    FROM unnest(snapshots.restorable_tables()) AS tbl;

  -- profiles / groups : uniquement les colonnes que la restauration remet
  -- (pas de noms ni d'avatars dans le snapshot).
  v_select := v_select
    || ' UNION ALL SELECT ''profiles'', count(*)::integer, COALESCE(jsonb_agg(jsonb_build_object('
    || '''id'', p.id, ''salary'', p.salary, ''group_id'', p.group_id)), ''[]''::jsonb) FROM public.profiles p'
    || ' UNION ALL SELECT ''groups'', count(*)::integer, COALESCE(jsonb_agg(jsonb_build_object('
    || '''id'', g.id, ''monthly_budget_estimate'', g.monthly_budget_estimate, '
    || '''monthly_income_estimate'', g.monthly_income_estimate)), ''[]''::jsonb) FROM public.groups g';

  -- Une seule instruction = une seule image MVCC : cohérence entre tables.
  EXECUTE format(
    'INSERT INTO snapshots.db_snapshot_tables (snapshot_id, table_name, row_count, rows) '
    'SELECT %L::uuid, s.table_name, s.row_count, s.rows FROM (%s) s',
    v_id, v_select
  );

  UPDATE snapshots.db_snapshots d
     SET table_counts = (
       SELECT jsonb_object_agg(st.table_name, st.row_count)
         FROM snapshots.db_snapshot_tables st
        WHERE st.snapshot_id = v_id
     )
   WHERE d.id = v_id;

  RETURN v_id;
END;
$$;

-- Rétention : 12 snapshots de fin de mois ; les manuels et pre_restore
-- partent au bout de 12 mois.
CREATE OR REPLACE FUNCTION snapshots.purge_old_snapshots(p_now timestamp with time zone DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH ranked AS (
    SELECT d.id, d.kind, d.taken_at,
           row_number() OVER (
             PARTITION BY (d.kind = 'month_end')
             ORDER BY d.period_year DESC, d.period_month DESC, d.taken_at DESC
           ) AS rn
      FROM snapshots.db_snapshots d
  )
  DELETE FROM snapshots.db_snapshots d
   USING ranked r
   WHERE d.id = r.id
     AND ((r.kind = 'month_end' AND r.rn > 12)
       OR (r.kind <> 'month_end' AND r.taken_at < p_now - interval '12 months'));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Point d'entrée du job pg_cron. Renvoie l'id du snapshot pris, ou NULL quand
-- l'exécution ne tombe pas à 23h le dernier jour du mois (heure de Paris) ou
-- que le snapshot de la période existe déjà.
CREATE OR REPLACE FUNCTION snapshots.take_month_end_snapshot(p_now timestamp with time zone DEFAULT now())
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_paris timestamp := p_now AT TIME ZONE 'Europe/Paris';
  v_id uuid;
BEGIN
  IF EXTRACT(HOUR FROM v_paris) <> 23 OR EXTRACT(DAY FROM v_paris + interval '1 day') <> 1 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM snapshots.db_snapshots d
     WHERE d.kind = 'month_end'
       AND d.period_year = EXTRACT(YEAR FROM v_paris)
       AND d.period_month = EXTRACT(MONTH FROM v_paris)
  ) THEN
    RETURN NULL;
  END IF;

  v_id := snapshots.take_db_snapshot(
    'month_end',
    format('Fin de mois %s/%s', lpad(EXTRACT(MONTH FROM v_paris)::text, 2, '0'), EXTRACT(YEAR FROM v_paris)),
    p_now
  );
  PERFORM snapshots.purge_old_snapshots(p_now);
  RETURN v_id;
END;
$$;

-- ============================================================================
-- Restauration
-- ============================================================================

-- Ce qui empêcherait la ré-insertion : une valeur du snapshot pointant vers un
-- compte, un groupe ou un utilisateur auth supprimé depuis (FK vers une table
-- qui n'est pas rembobinée), ou une table rembobinable absente du snapshot
-- (snapshot plus ancien que la table — la vider sans rien remettre effacerait
-- ses données). Renvoie '[]' quand la restauration est possible.
CREATE OR REPLACE FUNCTION snapshots.restore_blockers(p_snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_fk record;
  v_missing jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('table', t, 'reason', 'absente du snapshot')), '[]'::jsonb)
    INTO v_out
    FROM unnest(snapshots.restorable_tables()) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM snapshots.db_snapshot_tables s
      WHERE s.snapshot_id = p_snapshot_id AND s.table_name = t
   );

  FOR v_fk IN
    SELECT src.relname::text AS src_table,
           a.attname::text AS src_column,
           c.confrelid AS target_oid,
           ta.attname::text AS target_column
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute ta ON ta.attrelid = c.confrelid AND ta.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND cardinality(c.conkey) = 1
       AND src.relname::text = ANY (snapshots.restorable_tables())
       AND c.confrelid NOT IN (
         SELECT format('public.%I', r)::regclass::oid FROM unnest(snapshots.restorable_tables()) AS r
       )
    UNION ALL
    -- profiles.group_id est remis depuis le snapshot : le groupe doit exister.
    SELECT 'profiles', 'group_id', 'public.groups'::regclass::oid, 'id'
  LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(DISTINCT x.v), ''[]''::jsonb) '
      'FROM (SELECT e ->> %L AS v FROM jsonb_array_elements(snapshots.snapshot_rows($1, %L)) e) x '
      'WHERE x.v IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s t WHERE t.%I::text = x.v)',
      v_fk.src_column, v_fk.src_table, v_fk.target_oid::regclass, v_fk.target_column
    )
    INTO v_missing
    USING p_snapshot_id;

    IF jsonb_array_length(v_missing) > 0 THEN
      v_out := v_out || jsonb_build_object(
        'table', v_fk.src_table,
        'column', v_fk.src_column,
        'references', v_fk.target_oid::regclass::text,
        'missing', v_missing
      );
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- Aperçu, sans rien modifier, de ce que ferait restore_db_snapshot().
CREATE OR REPLACE FUNCTION snapshots.preview_restore(p_snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
SET timezone TO 'UTC'
AS $$
DECLARE
  v_snapshot snapshots.db_snapshots%ROWTYPE;
  v_table text;
  v_rows jsonb;
  v_present boolean;
  v_new_cols text[];
  v_dropped_cols text[];
  v_diff jsonb;
  v_tables jsonb := '[]'::jsonb;
  v_transactions jsonb;
  v_expense_keys text[];
  v_income_keys text[];
  v_balances jsonb;
  v_recaps jsonb;
  v_profiles jsonb;
  v_new_groups jsonb;
BEGIN
  SELECT * INTO v_snapshot FROM snapshots.db_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preview_restore: snapshot % introuvable', p_snapshot_id;
  END IF;

  -- Comptage par table : lignes supprimées (créées depuis), recréées
  -- (supprimées depuis) et remises (modifiées depuis).
  FOREACH v_table IN ARRAY snapshots.restorable_tables() LOOP
    v_present := EXISTS (
      SELECT 1 FROM snapshots.db_snapshot_tables s
       WHERE s.snapshot_id = p_snapshot_id AND s.table_name = v_table
    );
    v_rows := snapshots.snapshot_rows(p_snapshot_id, v_table);

    -- Colonnes ajoutées / retirées depuis la prise : ignorées dans la
    -- comparaison, sinon toutes les lignes paraîtraient modifiées.
    SELECT COALESCE(array_agg(c.column_name::text), '{}'::text[])
      INTO v_new_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = v_table
       AND NOT COALESCE(v_rows -> 0 ? c.column_name::text, false);
    SELECT COALESCE(array_agg(k), '{}'::text[])
      INTO v_dropped_cols
      FROM jsonb_object_keys(COALESCE(v_rows -> 0, '{}'::jsonb)) AS k
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = v_table AND c.column_name = k
     );

    EXECUTE format(
      'WITH snap AS (SELECT (e ->> ''id'')::uuid AS id, e - $2 AS row FROM jsonb_array_elements($1) e), '
      'cur AS (SELECT t.id, to_jsonb(t) - $3 AS row FROM public.%I t) '
      'SELECT jsonb_build_object('
      '  ''table'', %L, '
      '  ''in_snapshot'', $4, '
      '  ''current'', count(cur.id), '
      '  ''snapshot'', count(snap.id), '
      '  ''to_delete'', count(*) FILTER (WHERE snap.id IS NULL), '
      '  ''to_recreate'', count(*) FILTER (WHERE cur.id IS NULL), '
      '  ''to_revert'', count(*) FILTER (WHERE snap.id IS NOT NULL AND cur.id IS NOT NULL AND snap.row <> cur.row)) '
      'FROM snap FULL JOIN cur ON cur.id = snap.id',
      v_table, v_table
    )
    INTO v_diff
    USING v_rows, v_dropped_cols, v_new_cols, v_present;

    v_tables := v_tables || v_diff;
  END LOOP;

  -- Dépenses et revenus : la liste des saisies perdues ou remises. Seules
  -- les colonnes présentes dans le snapshot comptent comme modifiables : une
  -- colonne ajoutée depuis n'est pas une modification.
  v_expense_keys := ARRAY(SELECT jsonb_object_keys(COALESCE(snapshots.snapshot_rows(p_snapshot_id, 'real_expenses') -> 0, '{}'::jsonb)));
  v_income_keys := ARRAY(SELECT jsonb_object_keys(COALESCE(snapshots.snapshot_rows(p_snapshot_id, 'real_income_entries') -> 0, '{}'::jsonb)));

  WITH
  snap_e AS (SELECT * FROM jsonb_populate_recordset(NULL::public.real_expenses, snapshots.snapshot_rows(p_snapshot_id, 'real_expenses'))),
  snap_i AS (SELECT * FROM jsonb_populate_recordset(NULL::public.real_income_entries, snapshots.snapshot_rows(p_snapshot_id, 'real_income_entries'))),
  expenses AS (
    SELECT 'expense' AS kind,
           COALESCE(c.id, s.id) AS id,
           COALESCE(c.profile_id, s.profile_id) AS profile_id,
           COALESCE(c.group_id, s.group_id) AS group_id,
           COALESCE(c.expense_date, s.expense_date) AS tx_date,
           COALESCE(c.description, s.description) AS description,
           c.amount AS amount_now,
           s.amount AS amount_snapshot,
           COALESCE(c.contribution_id, s.contribution_id) IS NOT NULL AS automatic,
           CASE WHEN c.id IS NOT NULL AND s.id IS NOT NULL THEN to_jsonb(c) END AS cmp_cur,
           CASE WHEN c.id IS NOT NULL AND s.id IS NOT NULL THEN to_jsonb(s) END AS cmp_snap,
           s.id IS NULL AS added,
           c.id IS NULL AS removed
      FROM public.real_expenses c
      FULL JOIN snap_e s ON s.id = c.id
  ),
  incomes AS (
    SELECT 'income' AS kind,
           COALESCE(c.id, s.id) AS id,
           COALESCE(c.profile_id, s.profile_id) AS profile_id,
           COALESCE(c.group_id, s.group_id) AS group_id,
           COALESCE(c.entry_date, s.entry_date) AS tx_date,
           COALESCE(c.description, s.description) AS description,
           c.amount AS amount_now,
           s.amount AS amount_snapshot,
           (COALESCE(c.contribution_id, s.contribution_id) IS NOT NULL
             OR COALESCE(c.recap_origin_id, s.recap_origin_id) IS NOT NULL) AS automatic,
           CASE WHEN c.id IS NOT NULL AND s.id IS NOT NULL THEN to_jsonb(c) END AS cmp_cur,
           CASE WHEN c.id IS NOT NULL AND s.id IS NOT NULL THEN to_jsonb(s) END AS cmp_snap,
           s.id IS NULL AS added,
           c.id IS NULL AS removed
      FROM public.real_income_entries c
      FULL JOIN snap_i s ON s.id = c.id
  ),
  diffs AS (
    SELECT x.*,
           CASE WHEN x.cmp_cur IS NOT NULL THEN (
             SELECT COALESCE(array_agg(k ORDER BY k), '{}'::text[])
               FROM jsonb_each(x.cmp_cur) AS e(k, v)
              WHERE k = ANY (CASE x.kind WHEN 'expense' THEN v_expense_keys ELSE v_income_keys END)
                AND x.cmp_snap -> k IS DISTINCT FROM v
           ) END AS changed
      FROM (SELECT * FROM expenses UNION ALL SELECT * FROM incomes) x
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', d.kind,
           'change', CASE WHEN d.added THEN 'added' WHEN d.removed THEN 'removed' ELSE 'modified' END,
           'id', d.id,
           'owner', snapshots.owner_label(d.profile_id, d.group_id),
           'space', CASE WHEN d.group_id IS NULL THEN 'perso' ELSE 'groupe' END,
           'date', d.tx_date,
           'description', d.description,
           'amount_now', d.amount_now,
           'amount_snapshot', d.amount_snapshot,
           'automatic', d.automatic,
           'changed', to_jsonb(d.changed)
         ) ORDER BY d.tx_date, d.kind, d.description), '[]'::jsonb)
    INTO v_transactions
    FROM diffs d
   WHERE d.added OR d.removed OR cardinality(d.changed) > 0;

  -- Soldes : tirelires, comptes, économies par budget, projets d'épargne.
  WITH
  snap_piggy AS (SELECT * FROM jsonb_populate_recordset(NULL::public.piggy_bank, snapshots.snapshot_rows(p_snapshot_id, 'piggy_bank'))),
  snap_bank AS (SELECT * FROM jsonb_populate_recordset(NULL::public.bank_balances, snapshots.snapshot_rows(p_snapshot_id, 'bank_balances'))),
  snap_budgets AS (SELECT * FROM jsonb_populate_recordset(NULL::public.estimated_budgets, snapshots.snapshot_rows(p_snapshot_id, 'estimated_budgets'))),
  snap_projects AS (SELECT * FROM jsonb_populate_recordset(NULL::public.savings_projects, snapshots.snapshot_rows(p_snapshot_id, 'savings_projects'))),
  balances AS (
    SELECT 1 AS ord, 'Tirelire' AS kind, NULL::text AS label,
           COALESCE(c.profile_id, s.profile_id) AS profile_id, COALESCE(c.group_id, s.group_id) AS group_id,
           c.amount::numeric AS value_now, s.amount::numeric AS value_snapshot
      FROM public.piggy_bank c FULL JOIN snap_piggy s ON s.id = c.id
    UNION ALL
    SELECT 2, 'Solde du compte', NULL,
           COALESCE(c.profile_id, s.profile_id), COALESCE(c.group_id, s.group_id),
           c.balance, s.balance
      FROM public.bank_balances c FULL JOIN snap_bank s ON s.id = c.id
    UNION ALL
    SELECT 3, 'Économies du budget', COALESCE(c.name, s.name),
           COALESCE(c.profile_id, s.profile_id), COALESCE(c.group_id, s.group_id),
           c.cumulated_savings, s.cumulated_savings
      FROM public.estimated_budgets c FULL JOIN snap_budgets s ON s.id = c.id
    UNION ALL
    SELECT 4, 'Projet d''épargne', COALESCE(c.name, s.name),
           COALESCE(c.profile_id, s.profile_id), COALESCE(c.group_id, s.group_id),
           c.amount_saved, s.amount_saved
      FROM public.savings_projects c FULL JOIN snap_projects s ON s.id = c.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', b.kind,
           'label', b.label,
           'owner', snapshots.owner_label(b.profile_id, b.group_id),
           'now', b.value_now,
           'snapshot', b.value_snapshot
         ) ORDER BY snapshots.owner_label(b.profile_id, b.group_id), b.ord, b.label), '[]'::jsonb)
    INTO v_balances
    FROM balances b
   WHERE COALESCE(b.value_now, 0) <> COALESCE(b.value_snapshot, 0);

  -- Récaps mensuels créés ou avancés depuis la prise.
  WITH snap_recaps AS (
    SELECT * FROM jsonb_populate_recordset(NULL::public.monthly_recaps, snapshots.snapshot_rows(p_snapshot_id, 'monthly_recaps'))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'change', CASE WHEN s.id IS NULL THEN 'added' WHEN c.id IS NULL THEN 'removed' ELSE 'modified' END,
           'owner', snapshots.owner_label(COALESCE(c.profile_id, s.profile_id), COALESCE(c.group_id, s.group_id)),
           'recap_month', COALESCE(c.recap_month, s.recap_month),
           'recap_year', COALESCE(c.recap_year, s.recap_year),
           'step_now', c.current_step,
           'step_snapshot', s.current_step,
           'completed_now', c.completed_at IS NOT NULL,
           'completed_snapshot', s.completed_at IS NOT NULL
         ) ORDER BY COALESCE(c.recap_year, s.recap_year), COALESCE(c.recap_month, s.recap_month)), '[]'::jsonb)
    INTO v_recaps
    FROM public.monthly_recaps c
    FULL JOIN snap_recaps s ON s.id = c.id
   WHERE s.id IS NULL OR c.id IS NULL OR to_jsonb(c) - 'updated_at' <> to_jsonb(s) - 'updated_at';

  -- Salaires et appartenance aux groupes remis ; comptes créés depuis (leurs
  -- données financières seront effacées, le compte lui-même reste).
  WITH snap_profiles AS (
    SELECT * FROM jsonb_to_recordset(snapshots.snapshot_rows(p_snapshot_id, 'profiles'))
      AS s(id uuid, salary numeric, group_id uuid)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', snapshots.owner_label(p.id, NULL),
           'new_since_snapshot', s.id IS NULL,
           'salary_now', p.salary,
           'salary_snapshot', s.salary,
           'group_now', CASE WHEN p.group_id IS NOT NULL THEN snapshots.owner_label(NULL, p.group_id) END,
           'group_snapshot', CASE WHEN s.group_id IS NOT NULL THEN snapshots.owner_label(NULL, s.group_id) END,
           'group_changed', s.id IS NOT NULL AND p.group_id IS DISTINCT FROM s.group_id
         ) ORDER BY snapshots.owner_label(p.id, NULL)), '[]'::jsonb)
    INTO v_profiles
    FROM public.profiles p
    LEFT JOIN snap_profiles s ON s.id = p.id
   WHERE s.id IS NULL
      OR p.salary IS DISTINCT FROM s.salary
      OR p.group_id IS DISTINCT FROM s.group_id;

  SELECT COALESCE(jsonb_agg(g.name ORDER BY g.name), '[]'::jsonb)
    INTO v_new_groups
    FROM public.groups g
   WHERE NOT EXISTS (
     SELECT 1 FROM jsonb_array_elements(snapshots.snapshot_rows(p_snapshot_id, 'groups')) e
      WHERE (e ->> 'id')::uuid = g.id
   );

  RETURN jsonb_build_object(
    'snapshot', to_jsonb(v_snapshot),
    'blockers', snapshots.restore_blockers(p_snapshot_id),
    'uncovered_tables', to_jsonb(snapshots.uncovered_tables()),
    'tables', v_tables,
    'transactions', v_transactions,
    'balances', v_balances,
    'recaps', v_recaps,
    'profiles', v_profiles,
    'new_groups', v_new_groups
  );
END;
$$;

-- Remet TOUTE l'appli dans l'état du snapshot. Tout ou rien.
CREATE OR REPLACE FUNCTION snapshots.restore_db_snapshot(p_snapshot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SET timezone TO 'UTC'
SET lock_timeout TO '15s'
AS $$
DECLARE
  v_snapshot snapshots.db_snapshots%ROWTYPE;
  v_blockers jsonb;
  v_pre_id uuid;
  v_table text;
  v_rows jsonb;
  v_cols text;
  v_trigger record;
  v_touched text[] := snapshots.restorable_tables() || ARRAY['profiles', 'groups']::text[];
  v_disabled jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_snapshot FROM snapshots.db_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restore_db_snapshot: snapshot % introuvable', p_snapshot_id;
  END IF;

  -- Plus aucune écriture ni lecture concurrente jusqu'au COMMIT : le
  -- snapshot de sécurité ci-dessous capture l'état exact qu'on écrase.
  EXECUTE (
    SELECT 'LOCK TABLE ' || string_agg(format('public.%I', t), ', ') || ' IN ACCESS EXCLUSIVE MODE'
      FROM unnest(v_touched) AS t
  );

  v_blockers := snapshots.restore_blockers(p_snapshot_id);
  IF jsonb_array_length(v_blockers) > 0 THEN
    RAISE EXCEPTION 'restore_db_snapshot: restauration impossible — %', v_blockers;
  END IF;

  v_pre_id := snapshots.take_db_snapshot(
    'pre_restore',
    format('Avant restauration du snapshot %s', p_snapshot_id)
  );

  -- Coupe les triggers métier actifs (sync budget/revenu groupe, recalcul
  -- des contributions, lignes miroir, updated_at...) en retenant leur état
  -- exact pour le rétablir à l'identique.
  FOR v_trigger IN
    SELECT tg.tgrelid::regclass AS rel, tg.tgname::text AS name, tg.tgenabled AS enabled
      FROM pg_trigger tg
     WHERE tg.tgrelid IN (SELECT format('public.%I', t)::regclass FROM unnest(v_touched) AS t)
       AND NOT tg.tgisinternal
       AND tg.tgenabled <> 'D'
  LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', v_trigger.rel, v_trigger.name);
    v_disabled := v_disabled || jsonb_build_object(
      'rel', v_trigger.rel::text, 'name', v_trigger.name, 'enabled', v_trigger.enabled::text
    );
  END LOOP;

  -- TRUNCATE ne déclenche aucun trigger de ligne, et échoue (sans CASCADE)
  -- si une table hors périmètre référence l'une d'elles.
  EXECUTE (
    SELECT 'TRUNCATE ' || string_agg(format('public.%I', t), ', ')
      FROM unnest(snapshots.restorable_tables()) AS t
  );

  FOREACH v_table IN ARRAY snapshots.restorable_tables() LOOP
    v_rows := snapshots.snapshot_rows(p_snapshot_id, v_table);
    CONTINUE WHEN jsonb_array_length(v_rows) = 0;

    -- Colonnes présentes à la fois dans le snapshot et dans la table : une
    -- colonne ajoutée depuis prend sa valeur DEFAULT.
    SELECT string_agg(quote_ident(c.column_name::text), ', ' ORDER BY c.ordinal_position)
      INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = v_table
       AND c.is_generated = 'NEVER'
       AND v_rows -> 0 ? c.column_name::text;

    EXECUTE format(
      'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1)',
      v_table, v_cols
    )
    USING v_rows;
  END LOOP;

  UPDATE public.profiles p
     SET salary = s.salary,
         group_id = s.group_id
    FROM jsonb_to_recordset(snapshots.snapshot_rows(p_snapshot_id, 'profiles'))
      AS s(id uuid, salary numeric, group_id uuid)
   WHERE p.id = s.id
     AND (p.salary IS DISTINCT FROM s.salary OR p.group_id IS DISTINCT FROM s.group_id);

  UPDATE public.groups g
     SET monthly_budget_estimate = s.monthly_budget_estimate,
         monthly_income_estimate = s.monthly_income_estimate
    FROM jsonb_to_recordset(snapshots.snapshot_rows(p_snapshot_id, 'groups'))
      AS s(id uuid, monthly_budget_estimate numeric, monthly_income_estimate numeric)
   WHERE g.id = s.id
     AND (g.monthly_budget_estimate IS DISTINCT FROM s.monthly_budget_estimate
       OR g.monthly_income_estimate IS DISTINCT FROM s.monthly_income_estimate);

  FOR v_trigger IN
    SELECT d ->> 'rel' AS rel, d ->> 'name' AS name, d ->> 'enabled' AS enabled
      FROM jsonb_array_elements(v_disabled) AS d
  LOOP
    EXECUTE format(
      'ALTER TABLE %s ENABLE %s TRIGGER %I',
      v_trigger.rel,
      CASE v_trigger.enabled WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,
      v_trigger.name
    );
  END LOOP;

  UPDATE snapshots.db_snapshots SET restored_at = now() WHERE id = p_snapshot_id;

  RETURN jsonb_build_object(
    'restored_snapshot_id', p_snapshot_id,
    'pre_restore_snapshot_id', v_pre_id,
    'table_counts', v_snapshot.table_counts
  );
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA snapshots FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- Planification
-- ============================================================================

-- pg_cron n'existe que dans la base `postgres` sur Supabase, c'est celle de
-- l'appli. Si la création échoue (droits), activer l'intégration Cron depuis
-- le dashboard (Integrations → Cron) puis ré-appliquer cette migration.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- cron.schedule avec un nom de job existant met le job à jour : idempotent.
SELECT cron.schedule(
  'popoth-month-end-snapshot',
  '45 21,22 28-31 * *',
  'SELECT snapshots.take_month_end_snapshot()'
);
