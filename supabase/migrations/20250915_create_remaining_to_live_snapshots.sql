-- Migration pour créer la table de sauvegarde du reste à vivre
-- Créée le 2025-09-15 pour sauvegarder automatiquement le reste à vivre

CREATE TABLE public.remaining_to_live_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  group_id uuid,
  remaining_to_live numeric NOT NULL,
  available_balance numeric NOT NULL,
  total_savings numeric NOT NULL,
  total_estimated_income numeric NOT NULL,
  total_estimated_budgets numeric NOT NULL,
  total_real_income numeric NOT NULL,
  total_real_expenses numeric NOT NULL,
  snapshot_reason text NOT NULL, -- 'budget_created', 'budget_updated', 'budget_deleted', 'income_created', etc.
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT remaining_to_live_snapshots_pkey PRIMARY KEY (id),

  -- XOR constraint: doit appartenir soit à un profile soit à un groupe
  CONSTRAINT remaining_to_live_snapshots_owner_exclusive_check CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR
    (profile_id IS NULL AND group_id IS NOT NULL)
  ),

  -- Foreign keys
  CONSTRAINT remaining_to_live_snapshots_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT remaining_to_live_snapshots_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE
);

-- Index pour optimiser les requêtes par utilisateur/groupe et date
CREATE INDEX idx_remaining_to_live_snapshots_profile_date
  ON public.remaining_to_live_snapshots(profile_id, created_at DESC)
  WHERE profile_id IS NOT NULL;

CREATE INDEX idx_remaining_to_live_snapshots_group_date
  ON public.remaining_to_live_snapshots(group_id, created_at DESC)
  WHERE group_id IS NOT NULL;

-- RLS (Row Level Security)
ALTER TABLE public.remaining_to_live_snapshots ENABLE ROW LEVEL SECURITY;

-- Politique pour les profiles : voir seulement ses propres snapshots
CREATE POLICY "Users can view their own remaining to live snapshots"
  ON public.remaining_to_live_snapshots
  FOR SELECT
  USING (profile_id = auth.uid());

-- Politique pour les groupes : voir seulement les snapshots de son groupe
CREATE POLICY "Users can view their group remaining to live snapshots"
  ON public.remaining_to_live_snapshots
  FOR SELECT
  USING (
    group_id IN (
      SELECT group_id
      FROM public.profiles
      WHERE id = auth.uid() AND group_id IS NOT NULL
    )
  );

-- Politique d'insertion pour l'application (via service role)
CREATE POLICY "Service role can insert snapshots"
  ON public.remaining_to_live_snapshots
  FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE public.remaining_to_live_snapshots IS
'Stocke l''historique des calculs de reste à vivre pour traçabilité et analyse des tendances financières';

COMMENT ON COLUMN public.remaining_to_live_snapshots.snapshot_reason IS
'Raison de la création du snapshot: budget_created, budget_updated, budget_deleted, income_created, income_updated, income_deleted, manual_calculation';