-- =====================================================
-- MIGRATION: Add current_step field to monthly_recaps
-- Date: 2025-09-23
-- Objectif: Ajouter le champ current_step pour stocker l'étape courante du processus
-- =====================================================

-- Active les messages informatifs
SET client_min_messages = NOTICE;

DO $$
BEGIN
  RAISE NOTICE '🚀 Ajout du champ current_step à la table monthly_recaps';
END $$;

-- Ajouter la colonne current_step si elle n'existe pas déjà
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'monthly_recaps' AND column_name = 'current_step'
  ) THEN
    ALTER TABLE public.monthly_recaps
    ADD COLUMN current_step integer DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 3);
    RAISE NOTICE '✅ Colonne current_step ajoutée à monthly_recaps';
  ELSE
    RAISE NOTICE '⚠️ Colonne current_step existe déjà dans monthly_recaps';
  END IF;
END $$;

-- Mettre à jour les récapitulatifs existants pour avoir l'étape 3 (complétés)
UPDATE public.monthly_recaps
SET current_step = 3
WHERE current_step IS NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ Récapitulatifs existants mis à jour avec current_step = 3';
END $$;

-- Finalisation
DO $$
BEGIN
  RAISE NOTICE '✅ Migration terminée avec succès !';
  RAISE NOTICE '📋 Champ current_step ajouté à la table monthly_recaps';
  RAISE NOTICE '🔧 Contrainte: current_step BETWEEN 1 AND 3';
  RAISE NOTICE '🔧 Défaut: current_step = 1 pour les nouveaux récapitulatifs';
END $$;