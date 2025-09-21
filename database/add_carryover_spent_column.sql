-- Script d'ajout de la colonne pour le report de déficit au mois suivant
-- À exécuter après monthly_recap_structure.sql

-- =====================================================
-- AJOUT: carryover_spent_amount dans estimated_budgets
-- Objectif: Stocker le montant "déjà dépensé" reporté du mois précédent
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

  -- Colonne pour indiquer quand le carryover a été appliqué (pour tracking)
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
END $$;

-- =====================================================
-- COMMENTAIRES sur l'utilisation:
-- =====================================================

/*
LOGIQUE DE FONCTIONNEMENT:

1. Fin de mois (API complete):
   - Budget "Course" a 200€ estimé, 222€ dépensé → déficit de 22€
   - Si le déficit n'est pas compensé par des transferts, on met:
     * monthly_deficit = 22

2. Début du mois suivant (lors du prochain récap):
   - Le déficit de 22€ est reporté dans carryover_spent_amount = 22
   - L'affichage montre: "22€/200€ déjà utilisé"
   - carryover_applied_date = date_of_carryover

3. Calculs mis à jour:
   - Montant réellement disponible = estimated_amount - carryover_spent_amount
   - Dans l'exemple: 200€ - 22€ = 178€ disponible pour le nouveau mois

EXEMPLE CONCRET:
- Janvier: Course 200€ budget, 222€ dépensé → monthly_deficit = 22€
- Fin janvier: Utilisateur ne compense pas le déficit
- Février: carryover_spent_amount = 22€, budget affiché "22€/200€"
*/