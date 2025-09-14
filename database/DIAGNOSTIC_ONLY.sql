-- 🔍 DIAGNOSTIC SCRIPT - Database State Analysis
-- This script only READS the database to understand current state
-- NO MODIFICATIONS ARE MADE - Safe to run

-- =============================================================================
-- 📊 CONSTRAINTS ANALYSIS
-- =============================================================================

SELECT '=== EXISTING CONSTRAINTS ANALYSIS ===' as section;

-- Check all constraints on financial tables
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.check_constraints cc 
    ON tc.constraint_name = cc.constraint_name
WHERE tc.table_schema = 'public'
    AND tc.table_name IN (
        'estimated_incomes',
        'real_income_entries', 
        'estimated_budgets',
        'real_expenses',
        'financial_snapshots'
    )
ORDER BY tc.table_name, tc.constraint_type;

-- =============================================================================
-- 🏗️ TABLES EXISTENCE CHECK
-- =============================================================================

SELECT '=== TABLES EXISTENCE CHECK ===' as section;

SELECT 
    table_name,
    CASE 
        WHEN table_name IN (
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as status
FROM (VALUES 
    ('estimated_incomes'),
    ('real_income_entries'),
    ('estimated_budgets'), 
    ('real_expenses'),
    ('financial_snapshots')
) t(table_name);

-- =============================================================================
-- 🗂️ INDEXES ANALYSIS
-- =============================================================================

SELECT '=== INDEXES ANALYSIS ===' as section;

SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
    AND tablename IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets', 
        'real_expenses',
        'financial_snapshots'
    )
ORDER BY tablename, indexname;

-- =============================================================================
-- ⚙️ TRIGGERS ANALYSIS  
-- =============================================================================

SELECT '=== TRIGGERS ANALYSIS ===' as section;

SELECT 
    t.trigger_name,
    t.event_manipulation,
    t.event_object_table,
    t.action_timing,
    t.action_statement
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
    AND t.event_object_table IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets',
        'real_expenses', 
        'financial_snapshots',
        'profiles',
        'groups'
    )
ORDER BY t.event_object_table, t.trigger_name;

-- =============================================================================
-- 🔧 FUNCTIONS ANALYSIS
-- =============================================================================

SELECT '=== FINANCIAL FUNCTIONS ANALYSIS ===' as section;

SELECT 
    p.proname as function_name,
    pg_catalog.pg_get_function_result(p.oid) as return_type,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments
FROM pg_catalog.pg_proc p
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
    AND p.proname LIKE '%financial%'
    OR p.proname LIKE '%calculate%'
    OR p.proname LIKE '%update_budget%'
ORDER BY p.proname;

-- =============================================================================
-- 📋 COLUMNS ANALYSIS
-- =============================================================================

SELECT '=== FINANCIAL TABLES COLUMNS ===' as section;

SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public'
    AND table_name IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets',
        'real_expenses', 
        'financial_snapshots'
    )
ORDER BY table_name, ordinal_position;

-- =============================================================================
-- 🔐 RLS POLICIES ANALYSIS
-- =============================================================================

SELECT '=== ROW LEVEL SECURITY POLICIES ===' as section;

SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN (
        'estimated_incomes',
        'real_income_entries', 
        'estimated_budgets',
        'real_expenses',
        'financial_snapshots'
    )
ORDER BY tablename, policyname;

-- =============================================================================
-- 📊 SUMMARY REPORT
-- =============================================================================

SELECT '=== DIAGNOSTIC SUMMARY ===' as section;

SELECT 
    'Financial tables count' as metric,
    COUNT(*) as value
FROM information_schema.tables 
WHERE table_schema = 'public'
    AND table_name IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets',
        'real_expenses', 
        'financial_snapshots'
    )

UNION ALL

SELECT 
    'Total constraints on financial tables' as metric,
    COUNT(*) as value
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public'
    AND tc.table_name IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets',
        'real_expenses',
        'financial_snapshots'
    )

UNION ALL

SELECT 
    'Check constraints specifically' as metric,
    COUNT(*) as value
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

UNION ALL

SELECT 
    'Financial triggers count' as metric,
    COUNT(*) as value
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'
    AND t.event_object_table IN (
        'estimated_incomes',
        'real_income_entries',
        'estimated_budgets',
        'real_expenses',
        'financial_snapshots',
        'profiles', 
        'groups'
    );