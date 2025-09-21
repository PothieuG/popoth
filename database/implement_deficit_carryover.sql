-- Script pour implémenter le système complet de report des déficits
-- À exécuter sur Supabase pour résoudre le problème de report des déficits

-- =====================================================
-- AJOUT: Colonnes pour le système de carryover complet
-- =====================================================

DO $$
BEGIN
  -- Colonne pour le montant reporté du déficit du mois précédent
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'carryover_spent_amount'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN carryover_spent_amount numeric DEFAULT 0 CHECK (carryover_spent_amount >= 0);
    RAISE NOTICE '✅ Colonne carryover_spent_amount ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne carryover_spent_amount existe déjà dans estimated_budgets';
  END IF;

  -- Colonne pour indiquer quand le carryover a été appliqué
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'estimated_budgets' AND column_name = 'carryover_applied_date'
  ) THEN
    ALTER TABLE public.estimated_budgets
    ADD COLUMN carryover_applied_date date;
    RAISE NOTICE '✅ Colonne carryover_applied_date ajoutée à estimated_budgets';
  ELSE
    RAISE NOTICE '⚠️ Colonne carryover_applied_date existe déjà dans estimated_budgets';
  END IF;

  RAISE NOTICE '🎯 Système de carryover complet implémenté dans estimated_budgets';
END $$;

-- =====================================================
-- FONCTION RPC: Vérification de l'existence des colonnes
-- =====================================================

CREATE OR REPLACE FUNCTION check_column_exists(table_name text, column_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = $1
    AND column_name = $2
  );
END $$;

-- =====================================================
-- MIGRATION: Conversion des surplus négatifs existants
-- =====================================================

DO $$
DECLARE
  budget_record RECORD;
  converted_count INTEGER := 0;
BEGIN
  -- Trouver tous les budgets avec monthly_surplus négatif (ancienne méthode temporaire)
  FOR budget_record IN
    SELECT id, name, monthly_surplus
    FROM estimated_budgets
    WHERE monthly_surplus < 0
  LOOP
    -- Convertir le surplus négatif en carryover_spent_amount
    UPDATE estimated_budgets
    SET
      carryover_spent_amount = ABS(budget_record.monthly_surplus),
      carryover_applied_date = CURRENT_DATE,
      monthly_surplus = 0,
      updated_at = NOW()
    WHERE id = budget_record.id;

    converted_count := converted_count + 1;
    RAISE NOTICE '🔄 Budget "%" converti: surplus négatif %€ → carryover %€',
      budget_record.name,
      budget_record.monthly_surplus,
      ABS(budget_record.monthly_surplus);
  END LOOP;

  IF converted_count > 0 THEN
    RAISE NOTICE '✅ % budget(s) converti(s) de l''ancienne méthode vers le nouveau système', converted_count;
  ELSE
    RAISE NOTICE '✅ Aucun budget avec surplus négatif à convertir';
  END IF;
END $$;