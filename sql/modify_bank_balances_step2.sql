-- ÉTAPE 2: Création des index uniques partiels
-- Version sans CONCURRENTLY pour compatibilité Supabase
-- Ces index se créent rapidement car la table bank_balances est généralement petite

-- Index unique partiel pour profile_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_balances_profile_id_unique
ON public.bank_balances(profile_id)
WHERE profile_id IS NOT NULL;

-- Index unique partiel pour group_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_balances_group_id_unique
ON public.bank_balances(group_id)
WHERE group_id IS NOT NULL;

-- Index supplémentaire pour les performances sur group_id
CREATE INDEX IF NOT EXISTS idx_bank_balances_group_id
ON public.bank_balances(group_id)
WHERE group_id IS NOT NULL;