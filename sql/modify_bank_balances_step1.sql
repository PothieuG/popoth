-- ÉTAPE 1: Modification de la table bank_balances pour supporter les groupes
-- Cette partie peut être exécutée dans une transaction

-- 1. Supprimer les contraintes existantes
ALTER TABLE public.bank_balances DROP CONSTRAINT bank_balances_profile_id_fkey;
ALTER TABLE public.bank_balances DROP CONSTRAINT bank_balances_profile_id_unique;

-- 2. Modifier la colonne profile_id pour accepter NULL
ALTER TABLE public.bank_balances ALTER COLUMN profile_id DROP NOT NULL;

-- 3. Ajouter la colonne group_id
ALTER TABLE public.bank_balances ADD COLUMN group_id uuid;

-- 4. Ajouter les contraintes de foreign key
ALTER TABLE public.bank_balances
ADD CONSTRAINT bank_balances_profile_id_fkey
FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.bank_balances
ADD CONSTRAINT bank_balances_group_id_fkey
FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

-- 5. Ajouter la contrainte XOR (exactement un des deux doit être non-null)
ALTER TABLE public.bank_balances
ADD CONSTRAINT bank_balances_owner_exclusive_check CHECK (
  (profile_id IS NOT NULL AND group_id IS NULL) OR
  (profile_id IS NULL AND group_id IS NOT NULL)
);

-- 6. Commentaires pour la documentation
COMMENT ON TABLE public.bank_balances IS 'Bank balances for profiles and groups with XOR ownership';
COMMENT ON COLUMN public.bank_balances.profile_id IS 'User profile ID (mutually exclusive with group_id)';
COMMENT ON COLUMN public.bank_balances.group_id IS 'Group ID (mutually exclusive with profile_id)';
COMMENT ON CONSTRAINT bank_balances_owner_exclusive_check ON public.bank_balances IS 'Ensures each balance belongs to either a profile OR a group, never both or neither';