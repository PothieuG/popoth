-- ===================================================================
-- FIX: Trigger function correction for UUID handling
-- Date: 2025-09-14
-- Description: Fix the trigger function to properly handle NULL UUID values
-- ===================================================================

-- Drop and recreate the trigger function with proper NULL handling
DROP FUNCTION IF EXISTS trigger_recalculate_contributions() CASCADE;

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
                -- Recalculate for the old group
                PERFORM calculate_group_contributions(OLD.group_id);
            END IF;
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

-- Recreate the trigger
CREATE TRIGGER profiles_contribution_recalc
    AFTER INSERT OR UPDATE OR DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recalculate_contributions();

-- ===================================================================
-- Test the fix by running a simple update to verify it works
-- ===================================================================