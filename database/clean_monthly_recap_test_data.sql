-- Script de nettoyage des données de test du récapitulatif mensuel
-- À exécuter pour permettre de retester le système

-- 1. Supprimer tous les récapitulatifs mensuels existants
DELETE FROM monthly_recaps;

-- 2. Supprimer tous les snapshots de récupération
DELETE FROM recap_snapshots;

-- 3. Supprimer tous les transferts entre budgets
DELETE FROM budget_transfers;

-- 4. Remettre à zéro les colonnes de surplus/déficit des budgets
-- Utilisation de DO block pour gérer les colonnes qui pourraient ne pas exister
DO $$
BEGIN
    -- Vérifier si les colonnes carryover existent avant de les utiliser
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'estimated_budgets' AND column_name = 'carryover_spent_amount'
    ) THEN
        -- Si les colonnes carryover existent, les inclure dans la mise à jour
        UPDATE estimated_budgets
        SET
            monthly_surplus = 0,
            monthly_deficit = 0,
            last_monthly_update = NULL,
            carryover_spent_amount = 0,
            carryover_applied_date = NULL,
            updated_at = NOW();
        RAISE NOTICE '✅ Colonnes carryover trouvées et remises à zéro';
    ELSE
        -- Sinon, mettre à jour seulement les colonnes existantes
        UPDATE estimated_budgets
        SET
            monthly_surplus = 0,
            monthly_deficit = 0,
            last_monthly_update = NULL,
            updated_at = NOW();
        RAISE NOTICE '⚠️ Colonnes carryover non trouvées, reset des colonnes existantes seulement';
    END IF;
END $$;

-- 5. Optionnel : Remettre les revenus estimés à leurs valeurs originales si nécessaire
-- (Décommentez cette section si vous voulez restaurer des valeurs de test)
/*
UPDATE estimated_incomes
SET
    estimated_amount = CASE
        WHEN name LIKE '%Salaire%' THEN 2500
        WHEN name LIKE '%Prime%' THEN 300
        ELSE estimated_amount
    END,
    updated_at = NOW();
*/

-- Afficher un résumé du nettoyage
DO $$
DECLARE
    carryover_columns_exist boolean;
    budgets_with_carryover integer := 0;
BEGIN
    -- Vérifier si les colonnes carryover existent
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'estimated_budgets' AND column_name = 'carryover_spent_amount'
    ) INTO carryover_columns_exist;

    -- Compter les budgets avec carryover si les colonnes existent
    IF carryover_columns_exist THEN
        SELECT COUNT(*) INTO budgets_with_carryover
        FROM estimated_budgets
        WHERE carryover_spent_amount > 0;
    END IF;

    -- Afficher le résumé
    RAISE NOTICE '================================================';
    RAISE NOTICE '🧹 RÉSUMÉ DU NETTOYAGE';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Récapitulatifs supprimés: %', (SELECT COUNT(*) FROM monthly_recaps);
    RAISE NOTICE 'Snapshots supprimés: %', (SELECT COUNT(*) FROM recap_snapshots);
    RAISE NOTICE 'Transferts supprimés: %', (SELECT COUNT(*) FROM budget_transfers);
    RAISE NOTICE 'Budgets avec surplus/déficit: %', (SELECT COUNT(*) FROM estimated_budgets WHERE monthly_surplus > 0 OR monthly_deficit > 0);

    IF carryover_columns_exist THEN
        RAISE NOTICE 'Budgets avec carryover: %', budgets_with_carryover;
        RAISE NOTICE 'Colonnes carryover: ✅ Présentes et nettoyées';
    ELSE
        RAISE NOTICE 'Colonnes carryover: ⚠️ Non présentes (exécutez add_carryover_spent_column.sql)';
    END IF;

    RAISE NOTICE '================================================';
    RAISE NOTICE '✅ Nettoyage terminé - Prêt pour les tests';
    RAISE NOTICE '================================================';
END $$;