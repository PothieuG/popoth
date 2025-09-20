-- Database Reset Script for Popoth App
-- Preserves: users, groups, salaries
-- Resets: bank balances, estimated budgets/incomes, expenses, savings, group contributions

BEGIN;

-- Step 1: Delete all real expenses (this will trigger automatic savings recalculation)
DELETE FROM public.real_expenses;

-- Step 2: Delete all real income entries
DELETE FROM public.real_income_entries;

-- Step 3: Delete all estimated budgets (and their associated savings)
DELETE FROM public.estimated_budgets;

-- Step 4: Delete all estimated incomes
DELETE FROM public.estimated_incomes;

-- Step 5: Delete all group contributions
DELETE FROM public.group_contributions;

-- Step 6: Reset all bank balances to 0 (both profile and group balances)
UPDATE public.bank_balances
SET
    balance = 0,
    updated_at = now();

-- Alternative: If you prefer to delete bank balance records entirely
-- (they will be recreated with balance 0 when users access the app)
-- DELETE FROM public.bank_balances;

-- Step 7: Update timestamps to reflect the reset
UPDATE public.profiles
SET updated_at = now();

UPDATE public.groups
SET updated_at = now();

-- Verification queries (uncomment to check results)
-- SELECT 'Remaining Users' as table_name, count(*) as count FROM auth.users
-- UNION ALL
-- SELECT 'Remaining Profiles', count(*) FROM public.profiles
-- UNION ALL
-- SELECT 'Remaining Groups', count(*) FROM public.groups
-- UNION ALL
-- SELECT 'Remaining Estimated Budgets', count(*) FROM public.estimated_budgets
-- UNION ALL
-- SELECT 'Remaining Estimated Incomes', count(*) FROM public.estimated_incomes
-- UNION ALL
-- SELECT 'Remaining Real Expenses', count(*) FROM public.real_expenses
-- UNION ALL
-- SELECT 'Remaining Real Income Entries', count(*) FROM public.real_income_entries
-- UNION ALL
-- SELECT 'Remaining Group Contributions', count(*) FROM public.group_contributions
-- UNION ALL
-- SELECT 'Bank Balances (should all be 0)', count(*) FROM public.bank_balances WHERE balance > 0;

COMMIT;

-- Summary of what this script does:
-- ✅ Preserves all users (auth.users table)
-- ✅ Preserves all profiles with their names and salaries
-- ✅ Preserves all groups with their structure
-- ✅ Resets all bank balances to 0 (available balance = 0)
-- ✅ Deletes all estimated budgets (budget estimates)
-- ✅ Deletes all estimated incomes (income estimates)
-- ✅ Deletes all real expenses (actual spending)
-- ✅ Deletes all real income entries (actual income)
-- ✅ Deletes all group contributions (resets calculated contributions)
-- ✅ Resets all current savings to 0 (via budget deletion)
-- ✅ Resets "reste à vivre" to 0 (calculated from available balance)