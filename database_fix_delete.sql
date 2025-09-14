-- ===================================================================
-- FIX: Trigger function correction for deletion handling  
-- Date: 2025-09-14
-- Description: Fix the calculate_group_contributions function to handle deletions
-- ===================================================================

-- Update the calculate_group_contributions function to handle missing records gracefully
CREATE OR REPLACE FUNCTION calculate_group_contributions(group_id_param UUID)
RETURNS VOID AS $$
DECLARE
    group_budget DECIMAL(10,2);
    total_salaries DECIMAL(10,2);
    member_record RECORD;
    contribution_amount DECIMAL(10,2);
    contribution_percentage DECIMAL(5,2);
BEGIN
    -- Get the group budget - exit gracefully if group doesn't exist
    SELECT monthly_budget_estimate INTO group_budget
    FROM groups
    WHERE id = group_id_param;
    
    -- If record doesn't exist (e.g., during deletion), exit silently  
    IF group_budget IS NULL THEN
        RAISE NOTICE 'Record % not found or being deleted, skipping contribution calculation', group_id_param;
        RETURN;
    END IF;
    
    -- Calculate total salaries of all group members
    SELECT COALESCE(SUM(salary), 0) INTO total_salaries
    FROM profiles
    WHERE group_id = group_id_param AND salary > 0;
    
    -- If no salaries or total is 0, split budget equally among all members
    IF total_salaries = 0 THEN
        -- Count total members in the group
        SELECT COUNT(*) INTO total_salaries FROM profiles WHERE group_id = group_id_param;
        
        -- Equal contribution for each member
        contribution_amount := CASE 
            WHEN total_salaries > 0 THEN group_budget / total_salaries
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
        -- Calculate proportional contributions based on salary
        FOR member_record IN
            SELECT id, salary FROM profiles WHERE group_id = group_id_param
        LOOP
            -- Calculate contribution amount proportionally
            contribution_amount := (member_record.salary / total_salaries) * group_budget;
            
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
    
    RAISE NOTICE 'Contributions recalculated for record % with budget % and total salaries %', 
                 group_id_param, group_budget, total_salaries;
END;
$$ LANGUAGE plpgsql;

-- Also improve the trigger function to handle deletions more gracefully
CREATE OR REPLACE FUNCTION trigger_recalculate_contributions()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle different trigger events
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- If user joined a group or salary changed
        IF NEW.group_id IS NOT NULL THEN
            PERFORM calculate_group_contributions(NEW.group_id);
        END IF;
        
        -- If user left their old group (group_id changed from non-null to different value)
        IF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL THEN
            -- Check if group_id actually changed
            IF (NEW.group_id IS NULL) OR (NEW.group_id != OLD.group_id) THEN
                -- Delete their old contribution record
                DELETE FROM group_contributions WHERE profile_id = OLD.id AND group_id = OLD.group_id;
                -- Only recalculate if the group still exists
                PERFORM calculate_group_contributions(OLD.group_id);
            END IF;
        END IF;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- User was deleted, recalculate their group if they had one
        IF OLD.group_id IS NOT NULL THEN
            -- Delete their contribution record
            DELETE FROM group_contributions WHERE profile_id = OLD.id;
            -- Only recalculate if the group still exists
            PERFORM calculate_group_contributions(OLD.group_id);
        END IF;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ===================================================================
-- Additional improvement: Clean up contributions when records are deleted
-- ===================================================================

-- Create a trigger function for deletion cleanup
CREATE OR REPLACE FUNCTION cleanup_group_contributions()
RETURNS TRIGGER AS $$
BEGIN
    -- When a record is deleted, clean up all related contributions  
    IF TG_OP = 'DELETE' THEN
        DELETE FROM group_contributions WHERE group_id = OLD.id;
        RAISE NOTICE 'Cleaned up contributions for deleted record %', OLD.id;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on groups table for cleanup
DROP TRIGGER IF EXISTS groups_cleanup_contributions ON groups;
CREATE TRIGGER groups_cleanup_contributions
    BEFORE DELETE ON groups
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_group_contributions();

-- ===================================================================
-- Fix complete - deletion should now work smoothly
-- ===================================================================