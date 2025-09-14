-- ===================================================================
-- MIGRATION: Salary Management and Proportional Contribution System
-- Date: 2025-09-14
-- Description: Add salary field to profiles and create contribution system
-- ===================================================================

-- 1. Add salary column to profiles table
-- This allows each user to have a salary that will be used for contribution calculations
ALTER TABLE profiles ADD COLUMN salary DECIMAL(10,2) DEFAULT 0;

-- Add a comment to document the salary field
COMMENT ON COLUMN profiles.salary IS 'Monthly salary of the user in euros, used for proportional contribution calculations';

-- 2. Create group_contributions table
-- This table stores the calculated contributions for each user in a group
CREATE TABLE group_contributions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  salary DECIMAL(10,2) NOT NULL,
  contribution_amount DECIMAL(10,2) NOT NULL,
  contribution_percentage DECIMAL(5,2) NOT NULL,
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Primary key
  CONSTRAINT group_contributions_pkey PRIMARY KEY (id),
  
  -- Ensure one contribution record per user per group (updated when recalculated)
  CONSTRAINT group_contributions_unique_profile_group UNIQUE (profile_id, group_id),
  
  -- Ensure positive values
  CONSTRAINT group_contributions_salary_positive CHECK (salary >= 0),
  CONSTRAINT group_contributions_amount_positive CHECK (contribution_amount >= 0),
  CONSTRAINT group_contributions_percentage_positive CHECK (contribution_percentage >= 0)
);

-- Add comments for documentation
COMMENT ON TABLE group_contributions IS 'Stores calculated proportional contributions for each user in a group based on their salary';
COMMENT ON COLUMN group_contributions.salary IS 'Snapshot of user salary when contribution was calculated';
COMMENT ON COLUMN group_contributions.contribution_amount IS 'Amount this user should contribute to the group budget in euros';
COMMENT ON COLUMN group_contributions.contribution_percentage IS 'Percentage of the group budget this user contributes';

-- Add indexes for performance
CREATE INDEX idx_group_contributions_profile_id ON group_contributions(profile_id);
CREATE INDEX idx_group_contributions_group_id ON group_contributions(group_id);
CREATE INDEX idx_group_contributions_calculated_at ON group_contributions(calculated_at);

-- 3. Function to calculate proportional contributions for a group
-- This function calculates how much each member should contribute based on their salary
CREATE OR REPLACE FUNCTION calculate_group_contributions(group_id_param UUID)
RETURNS VOID AS $$
DECLARE
    group_budget DECIMAL(10,2);
    total_salaries DECIMAL(10,2);
    member_record RECORD;
    contribution_amount DECIMAL(10,2);
    contribution_percentage DECIMAL(5,2);
BEGIN
    -- Get the group budget
    SELECT monthly_budget_estimate INTO group_budget
    FROM groups
    WHERE id = group_id_param;
    
    IF group_budget IS NULL THEN
        RAISE EXCEPTION 'Group not found or has no budget: %', group_id_param;
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
    
    RAISE NOTICE 'Contributions recalculated for group % with budget % and total salaries %', 
                 group_id_param, group_budget, total_salaries;
END;
$$ LANGUAGE plpgsql;

-- Add comment for the function
COMMENT ON FUNCTION calculate_group_contributions(UUID) IS 'Calculates and updates proportional contributions for all members of a group based on their salaries';

-- 4. Trigger function to automatically recalculate contributions
CREATE OR REPLACE FUNCTION trigger_recalculate_contributions()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle different trigger events
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- If user joined a group or salary changed
        IF NEW.group_id IS NOT NULL THEN
            PERFORM calculate_group_contributions(NEW.group_id);
        END IF;
        
        -- If user left their old group (group_id changed)
        IF TG_OP = 'UPDATE' AND OLD.group_id IS NOT NULL AND OLD.group_id != COALESCE(NEW.group_id, 'null'::UUID) THEN
            -- Delete their old contribution record
            DELETE FROM group_contributions WHERE profile_id = OLD.id AND group_id = OLD.group_id;
            -- Recalculate for the old group
            PERFORM calculate_group_contributions(OLD.group_id);
        END IF;
        
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- User was deleted, recalculate their group if they had one
        IF OLD.group_id IS NOT NULL THEN
            -- Delete their contribution record
            DELETE FROM group_contributions WHERE profile_id = OLD.id;
            -- Recalculate for their group
            PERFORM calculate_group_contributions(OLD.group_id);
        END IF;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 5. Create trigger on profiles table for salary changes
CREATE TRIGGER profiles_contribution_recalc
    AFTER INSERT OR UPDATE OR DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recalculate_contributions();

-- 6. Trigger function for group budget changes
CREATE OR REPLACE FUNCTION trigger_group_budget_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Recalculate contributions when group budget changes
    IF TG_OP = 'UPDATE' AND OLD.monthly_budget_estimate != NEW.monthly_budget_estimate THEN
        PERFORM calculate_group_contributions(NEW.id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create trigger on groups table for budget changes
CREATE TRIGGER groups_budget_contribution_recalc
    AFTER UPDATE ON groups
    FOR EACH ROW
    EXECUTE FUNCTION trigger_group_budget_change();

-- 8. Enable Row Level Security on group_contributions
ALTER TABLE group_contributions ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies for group_contributions table
-- Users can only see contributions for groups they belong to
CREATE POLICY "Users can view contributions for their own group" ON group_contributions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.group_id = group_contributions.group_id
        )
    );

-- Only the system (via functions) should insert/update contributions
-- But we need to allow authenticated users to trigger recalculations
CREATE POLICY "Authenticated users can manage contributions" ON group_contributions
    FOR ALL USING (auth.uid() IS NOT NULL);

-- 10. Initial calculation for existing groups
-- Run this after the migration to calculate initial contributions for existing groups
DO $$
DECLARE
    group_record RECORD;
BEGIN
    FOR group_record IN SELECT id FROM groups LOOP
        PERFORM calculate_group_contributions(group_record.id);
    END LOOP;
    
    RAISE NOTICE 'Initial contributions calculated for all existing groups';
END;
$$;

-- ===================================================================
-- MIGRATION COMPLETE
-- ===================================================================
-- Next steps:
-- 1. Run this migration in your Supabase database
-- 2. Update the API endpoints to handle salary management
-- 3. Update the frontend to allow salary input and display contributions
-- ===================================================================