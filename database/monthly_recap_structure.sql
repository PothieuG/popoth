-- =====================================================
-- STRUCTURE DATABASE: Système de Récapitulatif Mensuel
-- Date: 2025-09-21
-- Objectif: Tables pour le système d'économies et bonus mensuel
-- =====================================================

-- Active les messages informatifs
SET client_min_messages = NOTICE;

DO $$
BEGIN
  RAISE NOTICE '🚀 Création des tables pour le système de récapitulatif mensuel';
END $$;

-- =====================================================
-- TABLE: monthly_recaps
-- Objectif: Tracker les récapitulatifs mensuels validés
-- =====================================================

CREATE TABLE IF NOT EXISTS public.monthly_recaps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  recap_month integer NOT NULL CHECK (recap_month >= 1 AND recap_month <= 12),
  recap_year integer NOT NULL CHECK (recap_year >= 2020),
  initial_remaining_to_live numeric NOT NULL,
  final_remaining_to_live numeric NOT NULL,
  remaining_to_live_source text, -- 'carried_forward', 'from_budget_X' ou NULL
  remaining_to_live_amount numeric DEFAULT 0,
  total_surplus numeric DEFAULT 0,
  total_deficit numeric DEFAULT 0,
  completed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT monthly_recaps_pkey PRIMARY KEY (id),
  CONSTRAINT monthly_recaps_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT monthly_recaps_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT monthly_recaps_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  ),
  CONSTRAINT monthly_recaps_unique_month_profile UNIQUE (profile_id, recap_month, recap_year),
  CONSTRAINT monthly_recaps_unique_month_group UNIQUE (group_id, recap_month, recap_year)
);

-- =====================================================
-- TABLE: recap_snapshots
-- Objectif: Sauvegardes de sécurité pour recovery en cas de bug
-- =====================================================

CREATE TABLE IF NOT EXISTS public.recap_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  snapshot_month integer NOT NULL,
  snapshot_year integer NOT NULL,
  snapshot_data jsonb NOT NULL, -- Toutes les données financières à l'état initial
  created_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,

  CONSTRAINT recap_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT recap_snapshots_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT recap_snapshots_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE,
  CONSTRAINT recap_snapshots_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  )
);

-- =====================================================
-- TABLE: budget_transfers
-- Objectif: Historique des transferts d'économies entre budgets
-- =====================================================

CREATE TABLE IF NOT EXISTS public.budget_transfers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  monthly_recap_id uuid NOT NULL,
  from_budget_id uuid NOT NULL,
  to_budget_id uuid NOT NULL,
  transfer_amount numeric NOT NULL CHECK (transfer_amount > 0),
  transfer_reason text DEFAULT 'Manual transfer',
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT budget_transfers_pkey PRIMARY KEY (id),
  CONSTRAINT budget_transfers_recap_id_fkey FOREIGN KEY (monthly_recap_id) REFERENCES public.monthly_recaps(id) ON DELETE CASCADE,
  CONSTRAINT budget_transfers_from_budget_fkey FOREIGN KEY (from_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE CASCADE,
  CONSTRAINT budget_transfers_to_budget_fkey FOREIGN KEY (to_budget_id) REFERENCES public.estimated_budgets(id) ON DELETE CASCADE,
  CONSTRAINT budget_transfers_different_budgets CHECK (from_budget_id != to_budget_id)
);

-- =====================================================
-- EXTENSION: estimated_budgets
-- Objectif: Ajouter colonnes pour surplus/déficit mensuel
-- =====================================================

-- Ajouter colonnes si elles n'existent pas déjà
DO $$
BEGIN
  -- Colonne pour le surplus du mois (économies réalisées)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'monthly_surplus'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN monthly_surplus numeric DEFAULT 0 CHECK (monthly_surplus >= 0);
    RAISE NOTICE '✅ Colonne monthly_surplus ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne monthly_surplus existe déjà dans estimated_budgets';
  END IF;

  -- Colonne pour le déficit du mois (dépassement)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'monthly_deficit'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN monthly_deficit numeric DEFAULT 0 CHECK (monthly_deficit >= 0);
    RAISE NOTICE '✅ Colonne monthly_deficit ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne monthly_deficit existe déjà dans estimated_budgets';
  END IF;

  -- Colonne pour marquer la dernière mise à jour mensuelle
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'last_monthly_update'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN last_monthly_update date;
    RAISE NOTICE '✅ Colonne last_monthly_update ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne last_monthly_update existe déjà dans estimated_budgets';
  END IF;
END $$;

-- =====================================================
-- INDEX DE PERFORMANCE
-- =====================================================

-- Function pour créer un index seulement s'il n'existe pas
CREATE OR REPLACE FUNCTION create_index_if_not_exists_recap(index_name text, table_name text, columns text)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = index_name) THEN
    EXECUTE format('CREATE INDEX %I ON %s(%s)', index_name, table_name, columns);
    RAISE NOTICE '✅ Index % créé', index_name;
  ELSE
    RAISE NOTICE '⚠️ Index % existe déjà', index_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Création des index
SELECT create_index_if_not_exists_recap('idx_monthly_recaps_profile_date', 'public.monthly_recaps', 'profile_id, recap_year, recap_month');
SELECT create_index_if_not_exists_recap('idx_monthly_recaps_group_date', 'public.monthly_recaps', 'group_id, recap_year, recap_month');
SELECT create_index_if_not_exists_recap('idx_recap_snapshots_profile_date', 'public.recap_snapshots', 'profile_id, snapshot_year, snapshot_month');
SELECT create_index_if_not_exists_recap('idx_recap_snapshots_group_date', 'public.recap_snapshots', 'group_id, snapshot_year, snapshot_month');
SELECT create_index_if_not_exists_recap('idx_recap_snapshots_active', 'public.recap_snapshots', 'is_active');
SELECT create_index_if_not_exists_recap('idx_budget_transfers_recap_id', 'public.budget_transfers', 'monthly_recap_id');
SELECT create_index_if_not_exists_recap('idx_budget_transfers_from_budget', 'public.budget_transfers', 'from_budget_id');
SELECT create_index_if_not_exists_recap('idx_budget_transfers_to_budget', 'public.budget_transfers', 'to_budget_id');

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Activer RLS sur les nouvelles tables
ALTER TABLE public.monthly_recaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recap_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_transfers ENABLE ROW LEVEL SECURITY;

-- Fonction pour créer une politique si elle n'existe pas
CREATE OR REPLACE FUNCTION create_policy_if_not_exists_recap(
  table_name text,
  policy_name text,
  policy_definition text
)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = table_name AND policyname = policy_name
  ) THEN
    EXECUTE format('CREATE POLICY %I ON public.%I %s', policy_name, table_name, policy_definition);
    RAISE NOTICE '✅ Politique % créée sur %', policy_name, table_name;
  ELSE
    RAISE NOTICE '⚠️ Politique % existe déjà sur %', policy_name, table_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Politiques RLS pour monthly_recaps
SELECT create_policy_if_not_exists_recap(
  'monthly_recaps',
  'Users can manage their own monthly recaps',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists_recap(
  'monthly_recaps',
  'Group members can manage group monthly recaps',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

-- Politiques RLS pour recap_snapshots
SELECT create_policy_if_not_exists_recap(
  'recap_snapshots',
  'Users can manage their own recap snapshots',
  'FOR ALL USING (profile_id = auth.uid())'
);

SELECT create_policy_if_not_exists_recap(
  'recap_snapshots',
  'Group members can manage group recap snapshots',
  'FOR ALL USING (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))'
);

-- Politiques RLS pour budget_transfers
SELECT create_policy_if_not_exists_recap(
  'budget_transfers',
  'Users can view transfers for their recaps',
  'FOR SELECT USING (monthly_recap_id IN (SELECT id FROM monthly_recaps WHERE profile_id = auth.uid() OR (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))))'
);

SELECT create_policy_if_not_exists_recap(
  'budget_transfers',
  'Users can create transfers for their recaps',
  'FOR INSERT WITH CHECK (monthly_recap_id IN (SELECT id FROM monthly_recaps WHERE profile_id = auth.uid() OR (group_id IS NOT NULL AND group_id IN (SELECT group_id FROM profiles WHERE id = auth.uid()))))'
);

-- =====================================================
-- FONCTIONS UTILITAIRES
-- =====================================================

-- Fonction pour vérifier si un récap est requis
CREATE OR REPLACE FUNCTION is_monthly_recap_required(user_id uuid, context_type text DEFAULT 'profile')
RETURNS boolean AS $$
DECLARE
  current_month integer := EXTRACT(MONTH FROM CURRENT_DATE);
  current_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  user_profile_id uuid;
  user_group_id uuid;
  recap_exists boolean := false;
BEGIN
  -- Récupérer les IDs selon le contexte
  SELECT id, group_id INTO user_profile_id, user_group_id
  FROM profiles WHERE id = user_id;

  IF context_type = 'profile' THEN
    -- Vérifier si un récap profile existe pour ce mois
    SELECT EXISTS(
      SELECT 1 FROM monthly_recaps
      WHERE profile_id = user_profile_id
        AND recap_month = current_month
        AND recap_year = current_year
    ) INTO recap_exists;
  ELSIF context_type = 'group' AND user_group_id IS NOT NULL THEN
    -- Vérifier si un récap groupe existe pour ce mois
    SELECT EXISTS(
      SELECT 1 FROM monthly_recaps
      WHERE group_id = user_group_id
        AND recap_month = current_month
        AND recap_year = current_year
    ) INTO recap_exists;
  END IF;

  -- Récap requis si on est le 1er du mois ET qu'aucun récap n'existe
  RETURN (EXTRACT(DAY FROM CURRENT_DATE) = 1) AND NOT recap_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fonction pour créer un snapshot de sécurité
CREATE OR REPLACE FUNCTION create_recap_snapshot(user_id uuid, context_type text DEFAULT 'profile')
RETURNS uuid AS $$
DECLARE
  snapshot_id uuid;
  current_month integer := EXTRACT(MONTH FROM CURRENT_DATE);
  current_year integer := EXTRACT(YEAR FROM CURRENT_DATE);
  user_profile_id uuid;
  user_group_id uuid;
  financial_data jsonb;
BEGIN
  -- Récupérer les IDs selon le contexte
  SELECT id, group_id INTO user_profile_id, user_group_id
  FROM profiles WHERE id = user_id;

  -- Créer les données du snapshot (on récupère toutes les données financières actuelles)
  IF context_type = 'profile' THEN
    SELECT jsonb_build_object(
      'context', 'profile',
      'profile_id', user_profile_id,
      'estimated_incomes', (
        SELECT jsonb_agg(row_to_json(ei.*))
        FROM estimated_incomes ei
        WHERE ei.profile_id = user_profile_id
      ),
      'estimated_budgets', (
        SELECT jsonb_agg(row_to_json(eb.*))
        FROM estimated_budgets eb
        WHERE eb.profile_id = user_profile_id
      ),
      'real_incomes', (
        SELECT jsonb_agg(row_to_json(ri.*))
        FROM real_income_entries ri
        WHERE ri.profile_id = user_profile_id
      ),
      'real_expenses', (
        SELECT jsonb_agg(row_to_json(re.*))
        FROM real_expenses re
        WHERE re.profile_id = user_profile_id
      ),
      'bank_balance', (
        SELECT balance FROM bank_balances
        WHERE profile_id = user_profile_id
      )
    ) INTO financial_data;

    -- Insérer le snapshot
    INSERT INTO recap_snapshots (profile_id, snapshot_month, snapshot_year, snapshot_data)
    VALUES (user_profile_id, current_month, current_year, financial_data)
    RETURNING id INTO snapshot_id;

  ELSIF context_type = 'group' AND user_group_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'context', 'group',
      'group_id', user_group_id,
      'estimated_incomes', (
        SELECT jsonb_agg(row_to_json(ei.*))
        FROM estimated_incomes ei
        WHERE ei.group_id = user_group_id
      ),
      'estimated_budgets', (
        SELECT jsonb_agg(row_to_json(eb.*))
        FROM estimated_budgets eb
        WHERE eb.group_id = user_group_id
      ),
      'real_incomes', (
        SELECT jsonb_agg(row_to_json(ri.*))
        FROM real_income_entries ri
        WHERE ri.group_id = user_group_id
      ),
      'real_expenses', (
        SELECT jsonb_agg(row_to_json(re.*))
        FROM real_expenses re
        WHERE re.group_id = user_group_id
      ),
      'bank_balance', (
        SELECT balance FROM bank_balances
        WHERE group_id = user_group_id
      )
    ) INTO financial_data;

    -- Insérer le snapshot
    INSERT INTO recap_snapshots (group_id, snapshot_month, snapshot_year, snapshot_data)
    VALUES (user_group_id, current_month, current_year, financial_data)
    RETURNING id INTO snapshot_id;
  END IF;

  RETURN snapshot_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- NETTOYAGE DES FONCTIONS UTILITAIRES
-- =====================================================

DROP FUNCTION IF EXISTS create_index_if_not_exists_recap(text, text, text);
DROP FUNCTION IF EXISTS create_policy_if_not_exists_recap(text, text, text);

-- =====================================================
-- FINALISATION
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Structure de base de données pour le récapitulatif mensuel créée avec succès !';
  RAISE NOTICE '📋 Tables créées: monthly_recaps, recap_snapshots, budget_transfers';
  RAISE NOTICE '🔧 Extensions ajoutées à estimated_budgets: monthly_surplus, monthly_deficit, last_monthly_update';
  RAISE NOTICE '🔒 RLS activé et politiques créées pour toutes les nouvelles tables';
  RAISE NOTICE '⚡ Index de performance créés pour optimiser les requêtes';
  RAISE NOTICE '🛠️ Fonctions utilitaires: is_monthly_recap_required(), create_recap_snapshot()';
END $$;