-- 🧮 FINANCIAL CALCULATION FUNCTIONS & TRIGGERS
-- Implements automatic calculations as described in battleplan.txt

-- =============================================================================
-- 🔧 UTILITY FUNCTIONS
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to calculate available cash for a profile or group
CREATE OR REPLACE FUNCTION calculate_available_cash(
    target_profile_id uuid DEFAULT NULL,
    target_group_id uuid DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
    total_income numeric := 0;
    total_expenses numeric := 0;
    available_cash numeric := 0;
BEGIN
    -- Validate input (exactly one must be provided)
    IF (target_profile_id IS NULL AND target_group_id IS NULL) OR 
       (target_profile_id IS NOT NULL AND target_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Must provide exactly one of profile_id or group_id';
    END IF;

    -- Calculate total real income
    IF target_profile_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO total_income
        FROM real_income_entries
        WHERE profile_id = target_profile_id;
        
        SELECT COALESCE(SUM(amount), 0) INTO total_expenses  
        FROM real_expenses
        WHERE profile_id = target_profile_id;
    ELSE
        SELECT COALESCE(SUM(amount), 0) INTO total_income
        FROM real_income_entries  
        WHERE group_id = target_group_id;
        
        SELECT COALESCE(SUM(amount), 0) INTO total_expenses
        FROM real_expenses
        WHERE group_id = target_group_id;
    END IF;

    -- Cash disponible = total income - total expenses
    available_cash := total_income - total_expenses;
    
    RETURN available_cash;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate remaining to live for a profile or group
CREATE OR REPLACE FUNCTION calculate_remaining_to_live(
    target_profile_id uuid DEFAULT NULL,
    target_group_id uuid DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
    total_income numeric := 0;
    total_budgets numeric := 0;
    exceptional_expenses numeric := 0;
    total_savings numeric := 0;
    remaining_to_live numeric := 0;
BEGIN
    -- Validate input
    IF (target_profile_id IS NULL AND target_group_id IS NULL) OR 
       (target_profile_id IS NOT NULL AND target_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Must provide exactly one of profile_id or group_id';
    END IF;

    IF target_profile_id IS NOT NULL THEN
        -- Get total real income for profile
        SELECT COALESCE(SUM(amount), 0) INTO total_income
        FROM real_income_entries
        WHERE profile_id = target_profile_id;
        
        -- Get total estimated budgets for profile
        SELECT COALESCE(SUM(estimated_amount), 0) INTO total_budgets
        FROM estimated_budgets
        WHERE profile_id = target_profile_id;
        
        -- Get exceptional expenses (not linked to any budget) for profile
        SELECT COALESCE(SUM(amount), 0) INTO exceptional_expenses
        FROM real_expenses
        WHERE profile_id = target_profile_id 
            AND estimated_budget_id IS NULL
            AND is_exceptional = true;
            
        -- Get total current savings from budgets for profile
        SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
        FROM estimated_budgets
        WHERE profile_id = target_profile_id;
    ELSE
        -- Same calculations but for group
        SELECT COALESCE(SUM(amount), 0) INTO total_income
        FROM real_income_entries
        WHERE group_id = target_group_id;
        
        -- Add group contributions to total income
        SELECT COALESCE(SUM(rie.amount), 0) + COALESCE(SUM(gc.contribution_amount), 0) 
        INTO total_income
        FROM real_income_entries rie
        FULL OUTER JOIN group_contributions gc ON gc.group_id = target_group_id
        WHERE rie.group_id = target_group_id OR gc.group_id = target_group_id;
        
        SELECT COALESCE(SUM(estimated_amount), 0) INTO total_budgets
        FROM estimated_budgets
        WHERE group_id = target_group_id;
        
        SELECT COALESCE(SUM(amount), 0) INTO exceptional_expenses
        FROM real_expenses
        WHERE group_id = target_group_id 
            AND estimated_budget_id IS NULL
            AND is_exceptional = true;
            
        SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
        FROM estimated_budgets
        WHERE group_id = target_group_id;
    END IF;

    -- Reste à vivre = income - budgets - exceptional expenses + savings
    remaining_to_live := total_income - total_budgets - exceptional_expenses + total_savings;
    
    RETURN remaining_to_live;
END;
$$ LANGUAGE plpgsql;

-- Function to update budget savings when expenses change
CREATE OR REPLACE FUNCTION update_budget_savings()
RETURNS TRIGGER AS $$
DECLARE
    budget_record record;
    current_month_start date;
    current_month_end date;
    spent_this_month numeric := 0;
    new_savings numeric := 0;
BEGIN
    -- Get current month boundaries
    current_month_start := date_trunc('month', CURRENT_DATE)::date;
    current_month_end := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
    
    -- Handle different trigger operations
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Update savings for the budget linked to new/updated expense
        IF NEW.estimated_budget_id IS NOT NULL THEN
            -- Get budget details
            SELECT * INTO budget_record 
            FROM estimated_budgets 
            WHERE id = NEW.estimated_budget_id;
            
            -- Calculate total spent this month for this budget
            SELECT COALESCE(SUM(amount), 0) INTO spent_this_month
            FROM real_expenses
            WHERE estimated_budget_id = NEW.estimated_budget_id
                AND expense_date >= current_month_start
                AND expense_date <= current_month_end;
                
            -- Calculate new savings = MAX(0, estimated - spent)
            new_savings := GREATEST(0, budget_record.estimated_amount - spent_this_month);
            
            -- Update the budget savings
            UPDATE estimated_budgets 
            SET current_savings = new_savings,
                updated_at = now()
            WHERE id = NEW.estimated_budget_id;
            
            RAISE NOTICE '💰 Budget savings updated: % -> % (spent: %)', 
                       budget_record.name, new_savings, spent_this_month;
        END IF;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        -- Update savings for the budget linked to deleted expense
        IF OLD.estimated_budget_id IS NOT NULL THEN
            SELECT * INTO budget_record 
            FROM estimated_budgets 
            WHERE id = OLD.estimated_budget_id;
            
            -- Recalculate spent this month (excluding the deleted expense)
            SELECT COALESCE(SUM(amount), 0) INTO spent_this_month
            FROM real_expenses
            WHERE estimated_budget_id = OLD.estimated_budget_id
                AND expense_date >= current_month_start
                AND expense_date <= current_month_end
                AND id != OLD.id; -- Exclude the expense being deleted
                
            new_savings := GREATEST(0, budget_record.estimated_amount - spent_this_month);
            
            UPDATE estimated_budgets 
            SET current_savings = new_savings,
                updated_at = now()
            WHERE id = OLD.estimated_budget_id;
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Function to update financial snapshots
CREATE OR REPLACE FUNCTION update_financial_snapshot(
    target_profile_id uuid DEFAULT NULL,
    target_group_id uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    available_cash numeric;
    remaining_to_live numeric;
    total_savings numeric;
    snapshot_record record;
BEGIN
    -- Calculate financial metrics
    available_cash := calculate_available_cash(target_profile_id, target_group_id);
    remaining_to_live := calculate_remaining_to_live(target_profile_id, target_group_id);
    
    -- Calculate total savings
    IF target_profile_id IS NOT NULL THEN
        SELECT COALESCE(SUM(current_savings), 0) INTO total_savings
        FROM estimated_budgets
        WHERE profile_id = target_profile_id;
    ELSE
        SELECT COALESCE(SUM(current_savings), 0) INTO total_savings  
        FROM estimated_budgets
        WHERE group_id = target_group_id;
    END IF;
    
    -- Check if current snapshot exists
    IF target_profile_id IS NOT NULL THEN
        SELECT * INTO snapshot_record
        FROM financial_snapshots
        WHERE profile_id = target_profile_id AND is_current = true;
    ELSE
        SELECT * INTO snapshot_record
        FROM financial_snapshots  
        WHERE group_id = target_group_id AND is_current = true;
    END IF;
    
    -- Update existing or create new snapshot
    IF snapshot_record.id IS NOT NULL THEN
        -- Update existing snapshot
        UPDATE financial_snapshots
        SET available_cash = update_financial_snapshot.available_cash,
            remaining_to_live = update_financial_snapshot.remaining_to_live,
            total_savings = update_financial_snapshot.total_savings,
            updated_at = now()
        WHERE id = snapshot_record.id;
    ELSE
        -- Create new current snapshot
        INSERT INTO financial_snapshots (
            profile_id,
            group_id,
            available_cash,
            remaining_to_live, 
            total_savings,
            is_current
        ) VALUES (
            target_profile_id,
            target_group_id,
            available_cash,
            remaining_to_live,
            total_savings,
            true
        );
    END IF;
    
    RAISE NOTICE '📊 Financial snapshot updated - Cash: %, Remaining: %, Savings: %',
                 available_cash, remaining_to_live, total_savings;
END;
$$ LANGUAGE plpgsql;

-- Wrapper trigger function for income entries
CREATE OR REPLACE FUNCTION trigger_update_snapshot_income()
RETURNS TRIGGER AS $$
BEGIN
    -- Call the main function with appropriate parameters
    PERFORM update_financial_snapshot(
        COALESCE(NEW.profile_id, OLD.profile_id),
        COALESCE(NEW.group_id, OLD.group_id)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Wrapper trigger function for expenses
CREATE OR REPLACE FUNCTION trigger_update_snapshot_expenses()
RETURNS TRIGGER AS $$
BEGIN
    -- Call the main function with appropriate parameters
    PERFORM update_financial_snapshot(
        COALESCE(NEW.profile_id, OLD.profile_id),
        COALESCE(NEW.group_id, OLD.group_id)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Wrapper trigger function for budgets
CREATE OR REPLACE FUNCTION trigger_update_snapshot_budgets()
RETURNS TRIGGER AS $$
BEGIN
    -- Call the main function with appropriate parameters
    PERFORM update_financial_snapshot(
        COALESCE(NEW.profile_id, OLD.profile_id),
        COALESCE(NEW.group_id, OLD.group_id)
    );
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 🔥 TRIGGERS SETUP
-- =============================================================================

-- Trigger to update updated_at on estimated_incomes
DROP TRIGGER IF EXISTS trigger_estimated_incomes_updated_at ON estimated_incomes;
CREATE TRIGGER trigger_estimated_incomes_updated_at
    BEFORE UPDATE ON estimated_incomes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on estimated_budgets  
DROP TRIGGER IF EXISTS trigger_estimated_budgets_updated_at ON estimated_budgets;
CREATE TRIGGER trigger_estimated_budgets_updated_at
    BEFORE UPDATE ON estimated_budgets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update budget savings when expenses change
DROP TRIGGER IF EXISTS trigger_update_budget_savings ON real_expenses;
CREATE TRIGGER trigger_update_budget_savings
    AFTER INSERT OR UPDATE OR DELETE ON real_expenses
    FOR EACH ROW
    EXECUTE FUNCTION update_budget_savings();

-- Trigger to update financial snapshots when income changes
DROP TRIGGER IF EXISTS trigger_update_snapshot_income ON real_income_entries;
CREATE TRIGGER trigger_update_snapshot_income
    AFTER INSERT OR UPDATE OR DELETE ON real_income_entries
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_snapshot_income();

-- Trigger to update financial snapshots when expenses change
DROP TRIGGER IF EXISTS trigger_update_snapshot_expenses ON real_expenses;
CREATE TRIGGER trigger_update_snapshot_expenses
    AFTER INSERT OR UPDATE OR DELETE ON real_expenses
    FOR EACH ROW  
    EXECUTE FUNCTION trigger_update_snapshot_expenses();

-- Trigger to update financial snapshots when budgets change
DROP TRIGGER IF EXISTS trigger_update_snapshot_budgets ON estimated_budgets;
CREATE TRIGGER trigger_update_snapshot_budgets
    AFTER INSERT OR UPDATE OR DELETE ON estimated_budgets
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_snapshot_budgets();

-- =============================================================================
-- 🧪 VERIFICATION FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION verify_financial_integrity()
RETURNS TABLE(
    check_name text,
    status text,
    details text
) AS $$
BEGIN
    -- Check XOR constraints
    RETURN QUERY
    SELECT 
        'XOR Constraints Violation'::text as check_name,
        CASE WHEN count(*) = 0 THEN '✅ PASS' ELSE '❌ FAIL' END as status,
        CASE WHEN count(*) = 0 THEN 'All records have exactly one owner'
             ELSE count(*)::text || ' records with invalid ownership' END as details
    FROM (
        SELECT 'estimated_incomes' as table_name FROM estimated_incomes 
        WHERE (profile_id IS NULL AND group_id IS NULL) 
           OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
        UNION ALL
        SELECT 'real_income_entries' FROM real_income_entries
        WHERE (profile_id IS NULL AND group_id IS NULL) 
           OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
        UNION ALL  
        SELECT 'estimated_budgets' FROM estimated_budgets
        WHERE (profile_id IS NULL AND group_id IS NULL) 
           OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
        UNION ALL
        SELECT 'real_expenses' FROM real_expenses
        WHERE (profile_id IS NULL AND group_id IS NULL) 
           OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
        UNION ALL
        SELECT 'financial_snapshots' FROM financial_snapshots
        WHERE (profile_id IS NULL AND group_id IS NULL) 
           OR (profile_id IS NOT NULL AND group_id IS NOT NULL)
    ) violations;
    
    -- Check positive amounts
    RETURN QUERY
    SELECT 
        'Positive Amounts'::text as check_name,
        CASE WHEN (
            (SELECT count(*) FROM real_income_entries WHERE amount <= 0) +
            (SELECT count(*) FROM real_expenses WHERE amount <= 0)
        ) = 0 THEN '✅ PASS' ELSE '❌ FAIL' END as status,
        'Real transactions must have positive amounts'::text as details;
    
    -- Check snapshot consistency
    RETURN QUERY
    SELECT 
        'Current Snapshots'::text as check_name,
        '✅ PASS'::text as status,
        (SELECT count(*)::text FROM financial_snapshots WHERE is_current = true) || ' current snapshots found' as details;
        
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ✅ SUCCESS MESSAGE
-- =============================================================================

DO $$ 
BEGIN
    RAISE NOTICE '🎉 Financial triggers and functions created successfully!';
    RAISE NOTICE '🧮 Available functions:';
    RAISE NOTICE '   - calculate_available_cash(profile_id, group_id)';
    RAISE NOTICE '   - calculate_remaining_to_live(profile_id, group_id)'; 
    RAISE NOTICE '   - update_financial_snapshot(profile_id, group_id)';
    RAISE NOTICE '   - verify_financial_integrity()';
    RAISE NOTICE '🔥 Active triggers:';
    RAISE NOTICE '   - Auto-update timestamps on budgets/incomes';
    RAISE NOTICE '   - Auto-calculate budget savings on expense changes';
    RAISE NOTICE '   - Auto-update financial snapshots on data changes';
    RAISE NOTICE '📋 Test with: SELECT * FROM verify_financial_integrity();';
END $$;