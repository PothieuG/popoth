-- ============================================
-- EDITABLE BANK BALANCE SYSTEM
-- Created: 2025-09-15
-- Purpose: Allow users to edit their bank balance for financial calculations
-- ============================================

-- Table pour stocker le solde bancaire éditable de chaque utilisateur
CREATE TABLE public.bank_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bank_balances_pkey PRIMARY KEY (id),
  CONSTRAINT bank_balances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id),
  CONSTRAINT bank_balances_profile_id_unique UNIQUE (profile_id)
);

-- Activer la Row Level Security (RLS)
ALTER TABLE public.bank_balances ENABLE ROW LEVEL SECURITY;

-- Politique pour permettre aux utilisateurs de voir leur propre solde
CREATE POLICY "Users can view their own bank balance" ON public.bank_balances
  FOR SELECT USING (auth.uid() = profile_id);

-- Politique pour permettre aux utilisateurs de modifier leur propre solde
CREATE POLICY "Users can update their own bank balance" ON public.bank_balances
  FOR ALL USING (auth.uid() = profile_id);

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bank_balances_updated_at
  BEFORE UPDATE ON public.bank_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- DOCUMENTATION
-- ============================================

COMMENT ON TABLE public.bank_balances IS 'Solde bancaire éditable pour chaque utilisateur - remplace le calcul revenus-dépenses dans le dashboard';
COMMENT ON COLUMN public.bank_balances.profile_id IS 'Référence vers l''utilisateur dans auth.users - contrainte unique';
COMMENT ON COLUMN public.bank_balances.balance IS 'Solde bancaire actuel en euros - doit être >= 0 et refléter le solde bancaire réel';
COMMENT ON COLUMN public.bank_balances.created_at IS 'Date de création de l''enregistrement';
COMMENT ON COLUMN public.bank_balances.updated_at IS 'Date de dernière modification - mise à jour automatique par trigger';

-- ============================================
-- USAGE NOTES
-- ============================================

-- Ce système permet aux utilisateurs d'éditer leur solde bancaire via l'interface
-- Le solde est utilisé directement comme 'availableBalance' dans les calculs financiers
-- Remplace le calcul "revenus réels - dépenses réelles" par une valeur éditable
-- Interface accessible via le menu paramètres du dashboard (icône crayon)
-- Modal d'édition avec explications sur l'usage approprié du système