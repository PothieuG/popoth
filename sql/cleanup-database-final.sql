-- Script de nettoyage final de la base de données
-- Migration vers calculs côté application - Suppression des éléments inutiles

-- ========================================
-- ÉTAPE 1: Supprimer la table financial_snapshots
-- ========================================
-- Cette table n'est plus nécessaire car les calculs se font côté application
DROP TABLE IF EXISTS financial_snapshots CASCADE;

-- ========================================
-- ÉTAPE 2: Supprimer toutes les fonctions de calculs restantes
-- ========================================
-- Ces fonctions ne sont plus nécessaires
DROP FUNCTION IF EXISTS calculate_available_cash(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_available_cash(UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_available_cash() CASCADE;
DROP FUNCTION IF EXISTS calculate_remaining_to_live(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_remaining_to_live(UUID) CASCADE;
DROP FUNCTION IF EXISTS calculate_remaining_to_live() CASCADE;
DROP FUNCTION IF EXISTS update_budget_savings() CASCADE;
DROP FUNCTION IF EXISTS update_budget_savings(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS verify_financial_integrity() CASCADE;

-- ========================================
-- ÉTAPE 3: Supprimer tous les triggers restants sur les tables financières
-- ========================================
-- Supprimer tous les triggers personnalisés qui pourraient encore exister
DO $$
DECLARE
    trigger_record RECORD;
    table_name TEXT;
BEGIN
    FOR table_name IN VALUES ('real_income_entries'), ('real_expenses'), ('estimated_budgets'), ('estimated_incomes') LOOP
        FOR trigger_record IN
            SELECT t.tgname as trigger_name
            FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = 'public'
              AND c.relname = table_name
              AND NOT t.tgisinternal
              AND t.tgname NOT LIKE 'RI_%'  -- Éviter les triggers système de contraintes
        LOOP
            BEGIN
                EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I CASCADE', trigger_record.trigger_name, table_name);
                RAISE NOTICE 'Trigger supprimé: % sur %', trigger_record.trigger_name, table_name;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE NOTICE 'Erreur lors de la suppression du trigger %: %', trigger_record.trigger_name, SQLERRM;
            END;
        END LOOP;
    END LOOP;
END
$$;

-- ========================================
-- ÉTAPE 4: Simplifier le schéma estimated_budgets
-- ========================================
-- Supprimer la colonne current_savings qui sera calculée côté application
-- Note: Vérifier d'abord si elle existe pour éviter les erreurs
DO $$
BEGIN
    -- Vérifier si la colonne existe avant de la supprimer
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'estimated_budgets'
          AND column_name = 'current_savings'
    ) THEN
        ALTER TABLE estimated_budgets DROP COLUMN current_savings;
        RAISE NOTICE 'Colonne current_savings supprimée de estimated_budgets';
    ELSE
        RAISE NOTICE 'Colonne current_savings n''existe pas dans estimated_budgets';
    END IF;
END
$$;

-- ========================================
-- ÉTAPE 5: Nettoyage des indexes inutiles
-- ========================================
-- Supprimer les indexes liés aux calculs automatiques qui ne sont plus nécessaires
DROP INDEX IF EXISTS idx_financial_snapshots_current;
DROP INDEX IF EXISTS idx_financial_snapshots_profile;
DROP INDEX IF EXISTS idx_financial_snapshots_group;

-- ========================================
-- ÉTAPE 6: Vérification finale
-- ========================================
-- Afficher un résumé des tables restantes
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('estimated_budgets', 'estimated_incomes', 'real_expenses', 'real_income_entries')
ORDER BY table_name, ordinal_position;

-- Message de confirmation
SELECT '✅ Nettoyage de la base de données terminé - Prêt pour calculs côté application' as status;