-- Sprint Group-Income-Cascade (2026-05-28) — M2/4
--
-- Modifie `calculate_group_contributions(group_id_param)` pour soustraire
-- `groups.monthly_income_estimate` (mirror SUM(estimated_incomes) groupe,
-- voir migration M1+M3) du budget total avant de répartir. Clamp à 0 :
-- si revenus_groupe > budgets_groupe → contribution_base = 0 → personne
-- ne paye, le surplus reste en cagnotte (visible via RAV groupe > 0).
--
-- Décision user (sprint planning 2026-05-28) : option "Personne ne paye,
-- surplus en cagnotte". Pas d'option contributions négatives ni saisie bloquée.
--
-- Pattern d'application : CREATE OR REPLACE (la RPC originale est dans
-- `20260512000000_capture_trigger_functions.sql:38-119`, NE PAS l'éditer
-- — règle CLAUDE.md §8 forbidden absolus). Body cloné verbatim avec :
--   1. Déclaration `group_income` + `contribution_base`.
--   2. SELECT enrichi pour lire `monthly_income_estimate` en même temps.
--   3. `contribution_base := GREATEST(0, group_budget - COALESCE(group_income, 0))`.
--   4. Toutes les formules `contribution_amount` utilisent `contribution_base` à la place de `group_budget`.
--
-- Variable `total_salaries` réutilisée comme COUNT dans la branche fallback
-- (ligne ~76) — pattern legacy préservé, ne PAS renommer pour éviter de
-- diverger du contrat existant.
--
-- Cascade post-changement : le trigger `groups_income_contribution_recalc`
-- (M4) fire sur UPDATE OF monthly_income_estimate et PERFORM cette RPC.
-- Le trigger existant `groups_budget_contribution_recalc` continue de fire
-- sur UPDATE OF monthly_budget_estimate. Les UPSERT sur group_contributions
-- continueront à cascader vers les triggers Sprint 16 V3 (real_expenses mirror)
-- et Sprint 36 (real_income_entries mirror).

CREATE OR REPLACE FUNCTION public.calculate_group_contributions(group_id_param uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    group_budget DECIMAL(10,2);
    group_income DECIMAL(10,2);
    contribution_base DECIMAL(10,2);
    total_salaries DECIMAL(10,2);
    member_record RECORD;
    contribution_amount DECIMAL(10,2);
    contribution_percentage DECIMAL(5,2);
BEGIN
    -- Get the group budget AND income mirror - exit gracefully if group doesn't exist
    SELECT monthly_budget_estimate, monthly_income_estimate
      INTO group_budget, group_income
      FROM groups
     WHERE id = group_id_param;

    -- If record doesn't exist (e.g., during deletion), exit silently
    IF group_budget IS NULL THEN
        RAISE NOTICE 'Record % not found or being deleted, skipping contribution calculation', group_id_param;
        RETURN;
    END IF;

    -- Sprint Group-Income-Cascade : net base = budgets - revenus_groupe, clampé à 0.
    -- COALESCE pour défense en profondeur (colonne NOT NULL DEFAULT 0 depuis M1,
    -- mais on garde un fallback si une row legacy traînait avec NULL).
    contribution_base := GREATEST(0, group_budget - COALESCE(group_income, 0));

    -- Calculate total salaries of all group members
    SELECT COALESCE(SUM(salary), 0) INTO total_salaries
    FROM profiles
    WHERE group_id = group_id_param AND salary > 0;

    -- If no salaries or total is 0, split contribution_base equally among all members
    IF total_salaries = 0 THEN
        -- Count total members in the group (variable réutilisée comme count, pattern legacy)
        SELECT COUNT(*) INTO total_salaries FROM profiles WHERE group_id = group_id_param;

        -- Equal contribution for each member based on contribution_base (not raw budget)
        contribution_amount := CASE
            WHEN total_salaries > 0 THEN contribution_base / total_salaries
            ELSE 0
        END;

        -- Update contributions for all members with equal amounts
        FOR member_record IN
            SELECT id, salary FROM profiles WHERE group_id = group_id_param
        LOOP
            INSERT INTO group_contributions (profile_id, group_id, salary, contribution_amount, contribution_percentage)
            VALUES (member_record.id, group_id_param, member_record.salary, contribution_amount,
                   CASE WHEN member_record.salary > 0 THEN (contribution_amount / member_record.salary * 100) ELSE 0 END)
            ON CONFLICT (profile_id, group_id)
            DO UPDATE SET
                salary = EXCLUDED.salary,
                contribution_amount = EXCLUDED.contribution_amount,
                contribution_percentage = EXCLUDED.contribution_percentage,
                calculated_at = now();
        END LOOP;
    ELSE
        -- Calculate proportional contributions based on salary and contribution_base
        FOR member_record IN
            SELECT id, salary FROM profiles WHERE group_id = group_id_param
        LOOP
            -- Sprint Group-Income-Cascade : prorata sur contribution_base (budget net),
            -- pas sur group_budget brut. Si revenus_groupe ≥ budgets, contribution = 0.
            contribution_amount := (member_record.salary / total_salaries) * contribution_base;

            -- Calculate contribution percentage (contribution as % of personal salary)
            contribution_percentage := CASE
                WHEN member_record.salary > 0 THEN (contribution_amount / member_record.salary * 100)
                ELSE 0
            END;

            -- Insert or update contribution record
            INSERT INTO group_contributions (profile_id, group_id, salary, contribution_amount, contribution_percentage)
            VALUES (member_record.id, group_id_param, member_record.salary, contribution_amount, contribution_percentage)
            ON CONFLICT (profile_id, group_id)
            DO UPDATE SET
                salary = EXCLUDED.salary,
                contribution_amount = EXCLUDED.contribution_amount,
                contribution_percentage = EXCLUDED.contribution_percentage,
                calculated_at = now();
        END LOOP;
    END IF;

    RAISE NOTICE 'Contributions recalculated for record % (budget %, income %, base %, total_salaries %)',
                 group_id_param, group_budget, group_income, contribution_base, total_salaries;
END;
$function$;

NOTIFY pgrst, 'reload schema';
