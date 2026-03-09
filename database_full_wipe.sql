-- FULL DATA WIPE - Popoth App
-- Conserve UNIQUEMENT : auth.users + profiles (id, first_name, last_name, group_id, avatar_url) + groups (id, name, creator_id)
-- Wipe TOUT le reste : soldes, salaires, budgets, revenus, dépenses, snapshots, recaps, tirelire...

BEGIN;

-- 1. Tables avec FK vers d'autres tables supprimées (enfants d'abord)

-- Budget transfers (FK → monthly_recaps, estimated_budgets)
DELETE FROM public.budget_transfers;

-- Real expenses (FK → estimated_budgets)
DELETE FROM public.real_expenses;

-- Real income entries (FK → estimated_incomes)
DELETE FROM public.real_income_entries;

-- 2. Tables parentes financières

-- Monthly recaps
DELETE FROM public.monthly_recaps;

-- Estimated budgets
DELETE FROM public.estimated_budgets;

-- Estimated incomes
DELETE FROM public.estimated_incomes;

-- 3. Tables sans dépendances entre elles

-- Group contributions
DELETE FROM public.group_contributions;

-- Recap snapshots
DELETE FROM public.recap_snapshots;

-- Remaining to live snapshots
DELETE FROM public.remaining_to_live_snapshots;

-- 4. Reset des données conservées

-- Tirelire → 0
UPDATE public.piggy_bank
SET
    amount = 0,
    last_updated = now();

-- Bank balances → 0
UPDATE public.bank_balances
SET
    balance = 0,
    current_remaining_to_live = 0,
    updated_at = now();

-- Salaires → 0
UPDATE public.profiles
SET
    salary = 0,
    updated_at = now();

-- Budget estimé groupe → 0
UPDATE public.groups
SET
    monthly_budget_estimate = 0,
    updated_at = now();

COMMIT;

-- ============================================================
-- RÉSUMÉ
-- ============================================================
-- ✅ Conservé : auth.users (comptes)
-- ✅ Conservé : profiles (id, nom, prénom, groupe, avatar)
-- ✅ Conservé : groups (id, nom, créateur)
-- 🗑️ Wipé : salary → 0
-- 🗑️ Wipé : bank_balances → 0
-- 🗑️ Wipé : piggy_bank → 0
-- 🗑️ Wipé : monthly_budget_estimate → 0
-- 🗑️ Supprimé : budget_transfers
-- 🗑️ Supprimé : real_expenses
-- 🗑️ Supprimé : real_income_entries
-- 🗑️ Supprimé : monthly_recaps
-- 🗑️ Supprimé : estimated_budgets
-- 🗑️ Supprimé : estimated_incomes
-- 🗑️ Supprimé : group_contributions
-- 🗑️ Supprimé : recap_snapshots
-- 🗑️ Supprimé : remaining_to_live_snapshots
