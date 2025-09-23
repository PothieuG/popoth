-- =====================================================
-- MIGRATION: Add current_savings column to estimated_budgets if missing
-- Date: 2025-09-23
-- Objectif: Ajouter la colonne current_savings si elle n'existe pas
-- =====================================================

-- Active les messages informatifs
SET client_min_messages = NOTICE;

DO $$
BEGIN
  RAISE NOTICE '🚀 Vérification de la colonne current_savings dans estimated_budgets';
END $$;

-- Ajouter la colonne current_savings si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'current_savings'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN current_savings numeric NOT NULL DEFAULT 0 CHECK (current_savings >= 0);
    RAISE NOTICE '✅ Colonne current_savings ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne current_savings existe déjà dans estimated_budgets';
  END IF;
END $$;

-- Vérifier que la colonne existe maintenant
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'current_savings'
  ) THEN
    RAISE NOTICE '✅ Colonne current_savings confirmée dans estimated_budgets';
  ELSE
    RAISE NOTICE '❌ Colonne current_savings manque toujours !';
  END IF;
END $$;

-- Initialiser les économies à 0 pour tous les budgets existants
UPDATE public.estimated_budgets
SET current_savings = 0
WHERE current_savings IS NULL;

-- Finalisation
DO $$
BEGIN
  RAISE NOTICE '✅ Migration terminée avec succès !';
  RAISE NOTICE '📋 Colonne current_savings disponible dans estimated_budgets';
  RAISE NOTICE '🔧 Contrainte: current_savings >= 0';
  RAISE NOTICE '🔧 Défaut: current_savings = 0 pour les nouveaux budgets';
END $$;