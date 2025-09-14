-- 🚀 PERFORMANCE INDEXES SCRIPT
-- Creates indexes with CONCURRENTLY to avoid blocking operations
-- Run this AFTER CONSTRAINT_FIX.sql

-- =============================================================================
-- 🏷️ OWNER-BASED INDEXES FOR FREQUENT LOOKUPS
-- =============================================================================

-- Estimated incomes by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_incomes_profile_id 
ON estimated_incomes (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_incomes_group_id 
ON estimated_incomes (group_id) WHERE group_id IS NOT NULL;

-- Real income entries by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_profile_id 
ON real_income_entries (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_group_id 
ON real_income_entries (group_id) WHERE group_id IS NOT NULL;

-- Estimated budgets by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_budgets_profile_id 
ON estimated_budgets (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_budgets_group_id 
ON estimated_budgets (group_id) WHERE group_id IS NOT NULL;

-- Real expenses by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_profile_id 
ON real_expenses (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_group_id 
ON real_expenses (group_id) WHERE group_id IS NOT NULL;

-- Financial snapshots by owner
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_snapshots_profile_id
ON financial_snapshots (profile_id) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_snapshots_group_id
ON financial_snapshots (group_id) WHERE group_id IS NOT NULL;

-- =============================================================================
-- 📅 DATE-BASED INDEXES FOR TEMPORAL QUERIES
-- =============================================================================

-- Income entries by date (for monthly calculations)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_entry_date 
ON real_income_entries (entry_date);

-- Expenses by date (for monthly budget tracking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_expense_date 
ON real_expenses (expense_date);

-- Combined date and owner indexes for monthly reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_profile_date
ON real_expenses (profile_id, expense_date) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_group_date
ON real_expenses (group_id, expense_date) WHERE group_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_profile_date
ON real_income_entries (profile_id, entry_date) WHERE profile_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_group_date
ON real_income_entries (group_id, entry_date) WHERE group_id IS NOT NULL;

-- =============================================================================
-- 🔗 RELATIONSHIP INDEXES FOR JOINS
-- =============================================================================

-- Real income entries linked to estimated incomes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_income_entries_estimated_id 
ON real_income_entries (estimated_income_id) WHERE estimated_income_id IS NOT NULL;

-- Real expenses linked to estimated budgets  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_estimated_budget_id 
ON real_expenses (estimated_budget_id) WHERE estimated_budget_id IS NOT NULL;

-- =============================================================================
-- 🎯 SPECIALIZED INDEXES FOR COMPLEX QUERIES
-- =============================================================================

-- Exceptional expenses (not linked to budgets)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_exceptional
ON real_expenses (profile_id, group_id) WHERE is_exceptional = true;

-- Monthly recurring incomes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_incomes_monthly_recurring
ON estimated_incomes (profile_id, group_id) WHERE is_monthly_recurring = true;

-- Active financial snapshots
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_snapshots_current
ON financial_snapshots (profile_id, group_id) WHERE is_current = true;

-- =============================================================================
-- 💰 BUDGET AND EXPENSE ANALYSIS INDEXES
-- =============================================================================

-- Budget expenses by month and budget (for savings calculation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_expenses_budget_month
ON real_expenses (estimated_budget_id, expense_date) WHERE estimated_budget_id IS NOT NULL;

-- Budget tracking with amounts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_budgets_amount
ON estimated_budgets (profile_id, group_id, estimated_amount);

-- Current savings tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_estimated_budgets_savings
ON estimated_budgets (profile_id, group_id, current_savings);

-- =============================================================================
-- 📊 SUCCESS VERIFICATION
-- =============================================================================

DO $$ 
DECLARE
    index_count integer;
BEGIN
    -- Count newly created indexes
    SELECT count(*) INTO index_count
    FROM pg_indexes 
    WHERE schemaname = 'public'
        AND tablename IN (
            'estimated_incomes',
            'real_income_entries',
            'estimated_budgets', 
            'real_expenses',
            'financial_snapshots'
        )
        AND indexname LIKE 'idx_%';
    
    RAISE NOTICE '🎉 Performance indexes creation completed!';
    RAISE NOTICE '📊 Total financial indexes: %', index_count;
    RAISE NOTICE '🚀 Database is now optimized for financial calculations';
    RAISE NOTICE '⚡ Query performance should be significantly improved';
    RAISE NOTICE '📋 Next: Run FINANCIAL_TRIGGERS.sql for automatic calculations';
END $$;