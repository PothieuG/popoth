-- 🔧 CONSTRAINT FIX SCRIPT
-- This script removes existing constraints and recreates them properly
-- Addresses the "constraint already exists" error

-- =============================================================================
-- 🗑️ CLEAN UP EXISTING CONSTRAINTS
-- =============================================================================

DO $$ 
DECLARE
    constraint_record RECORD;
BEGIN
    -- Drop existing check constraints that are causing conflicts
    FOR constraint_record IN 
        SELECT tc.table_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
            AND tc.constraint_type = 'CHECK'
            AND tc.table_name IN (
                'estimated_incomes',
                'real_income_entries', 
                'estimated_budgets',
                'real_expenses',
                'financial_snapshots'
            )
            AND tc.constraint_name LIKE '%_owner_check'
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', 
                         constraint_record.table_name, 
                         constraint_record.constraint_name);
            RAISE NOTICE '✅ Dropped constraint: %.%', 
                       constraint_record.table_name, 
                       constraint_record.constraint_name;
        EXCEPTION 
            WHEN OTHERS THEN
                RAISE NOTICE '⚠️  Could not drop constraint: %.% - %', 
                           constraint_record.table_name, 
                           constraint_record.constraint_name, 
                           SQLERRM;
        END;
    END LOOP;
END $$;

-- =============================================================================
-- ✅ RECREATE XOR CONSTRAINTS PROPERLY
-- =============================================================================

-- XOR constraint for estimated_incomes (either profile_id OR group_id, not both, not neither)
ALTER TABLE estimated_incomes 
ADD CONSTRAINT estimated_incomes_owner_exclusive_check 
CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
);

-- XOR constraint for real_income_entries
ALTER TABLE real_income_entries 
ADD CONSTRAINT real_income_entries_owner_exclusive_check 
CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
);

-- XOR constraint for estimated_budgets
ALTER TABLE estimated_budgets 
ADD CONSTRAINT estimated_budgets_owner_exclusive_check 
CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
);

-- XOR constraint for real_expenses
ALTER TABLE real_expenses 
ADD CONSTRAINT real_expenses_owner_exclusive_check 
CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
);

-- XOR constraint for financial_snapshots
ALTER TABLE financial_snapshots 
ADD CONSTRAINT financial_snapshots_owner_exclusive_check 
CHECK (
    (profile_id IS NOT NULL AND group_id IS NULL) OR 
    (profile_id IS NULL AND group_id IS NOT NULL)
);

-- =============================================================================
-- 💰 BUSINESS LOGIC CONSTRAINTS
-- =============================================================================

-- Positive amounts for real transactions
ALTER TABLE real_income_entries 
ADD CONSTRAINT real_income_entries_positive_amount_check 
CHECK (amount > 0);

ALTER TABLE real_expenses 
ADD CONSTRAINT real_expenses_positive_amount_check 
CHECK (amount > 0);

-- Non-negative amounts for estimated values
ALTER TABLE estimated_incomes 
ADD CONSTRAINT estimated_incomes_nonnegative_amount_check 
CHECK (estimated_amount >= 0);

ALTER TABLE estimated_budgets 
ADD CONSTRAINT estimated_budgets_nonnegative_amount_check 
CHECK (estimated_amount >= 0);

ALTER TABLE estimated_budgets 
ADD CONSTRAINT estimated_budgets_nonnegative_savings_check 
CHECK (current_savings >= 0);

-- Names cannot be empty
ALTER TABLE estimated_incomes 
ADD CONSTRAINT estimated_incomes_name_not_empty_check 
CHECK (trim(name) != '');

ALTER TABLE estimated_budgets 
ADD CONSTRAINT estimated_budgets_name_not_empty_check 
CHECK (trim(name) != '');

-- =============================================================================
-- 📊 UNIQUENESS CONSTRAINTS FOR CURRENT SNAPSHOTS
-- =============================================================================

-- Only one current snapshot per profile (using regular CREATE INDEX)
DROP INDEX IF EXISTS idx_financial_snapshots_current_profile;
CREATE UNIQUE INDEX idx_financial_snapshots_current_profile
ON financial_snapshots (profile_id) 
WHERE is_current = true AND profile_id IS NOT NULL;

-- Only one current snapshot per group
DROP INDEX IF EXISTS idx_financial_snapshots_current_group;
CREATE UNIQUE INDEX idx_financial_snapshots_current_group
ON financial_snapshots (group_id) 
WHERE is_current = true AND group_id IS NOT NULL;

-- =============================================================================
-- ✅ SUCCESS MESSAGE
-- =============================================================================

DO $$ 
BEGIN
    RAISE NOTICE '🎉 Constraint fix completed successfully!';
    RAISE NOTICE '📊 All XOR constraints have been recreated';
    RAISE NOTICE '📊 Uniqueness constraints for snapshots added';
    RAISE NOTICE '💰 Business logic constraints are in place';
    RAISE NOTICE '⚡ Run PERFORMANCE_INDEXES.sql next for performance optimization';
    RAISE NOTICE '📋 Run DIAGNOSTIC_ONLY.sql to verify the changes';
END $$;