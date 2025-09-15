-- Script "nuclear" pour supprimer TOUT ce qui pourrait poser problème
-- Cette approche supprime tous les triggers non-système sur toutes les tables financières

-- 1. Identifier et supprimer TOUS les triggers personnalisés sur toutes les tables financières
-- Nous devons faire cela pour chaque table individuellement

-- Supprimer tous les triggers sur estimated_budgets (sauf système)
DO $$
DECLARE
    trigger_record RECORD;
BEGIN
    FOR trigger_record IN
        SELECT t.tgname as trigger_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND c.relname = 'estimated_budgets'
          AND NOT t.tgisinternal
          AND t.tgname NOT LIKE 'RI_%'  -- Éviter les triggers système
    LOOP
        BEGIN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON estimated_budgets CASCADE', trigger_record.trigger_name);
            RAISE NOTICE 'Trigger supprimé: % sur estimated_budgets', trigger_record.trigger_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Erreur lors de la suppression du trigger %: %', trigger_record.trigger_name, SQLERRM;
        END;
    END LOOP;
END
$$;

-- Supprimer tous les triggers sur estimated_incomes (sauf système)
DO $$
DECLARE
    trigger_record RECORD;
BEGIN
    FOR trigger_record IN
        SELECT t.tgname as trigger_name
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND c.relname = 'estimated_incomes'
          AND NOT t.tgisinternal
          AND t.tgname NOT LIKE 'RI_%'  -- Éviter les triggers système
    LOOP
        BEGIN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON estimated_incomes CASCADE', trigger_record.trigger_name);
            RAISE NOTICE 'Trigger supprimé: % sur estimated_incomes', trigger_record.trigger_name;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Erreur lors de la suppression du trigger %: %', trigger_record.trigger_name, SQLERRM;
        END;
    END LOOP;
END
$$;

-- 2. Supprimer toutes les fonctions qui contiennent "financial" ou "snapshot" dans le nom
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN
        SELECT n.nspname as schema_name, p.proname as function_name,
               pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND (p.proname ILIKE '%financial%'
               OR p.proname ILIKE '%snapshot%'
               OR p.proname ILIKE '%update_financial%'
               OR p.proname ILIKE '%trigger_update%')
    LOOP
        BEGIN
            EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
                          func_record.schema_name,
                          func_record.function_name,
                          func_record.args);
            RAISE NOTICE 'Fonction supprimée: %.%(%)',
                        func_record.schema_name,
                        func_record.function_name,
                        func_record.args;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Erreur lors de la suppression de la fonction %: %', func_record.function_name, SQLERRM;
        END;
    END LOOP;
END
$$;

-- 3. Message final
SELECT 'Nettoyage nuclear terminé - tous les triggers et fonctions suspects supprimés' as status;