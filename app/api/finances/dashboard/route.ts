import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

export interface FinancialDashboardData {
  // Main financial indicators
  available_cash: number
  remaining_to_live: number
  total_savings: number
  
  // Income data
  total_estimated_income: number
  total_real_income: number
  estimated_incomes: Array<{
    id: string
    name: string
    estimated_amount: number
    is_monthly_recurring: boolean
  }>
  recent_income_entries: Array<{
    id: string
    amount: number
    description: string
    entry_date: string
    is_exceptional: boolean
    estimated_income?: { name: string }
  }>
  
  // Budget data
  total_estimated_budgets: number
  estimated_budgets: Array<{
    id: string
    name: string
    estimated_amount: number
    current_savings: number
    spent_this_month: number
    is_monthly_recurring: boolean
  }>
  
  // Expense data
  total_real_expenses: number
  recent_expenses: Array<{
    id: string
    amount: number
    description: string
    expense_date: string
    is_exceptional: boolean
    estimated_budget?: { name: string }
  }>
  
  // Summary by category
  monthly_summary: {
    income: number
    budgeted: number
    spent: number
    exceptional_expenses: number
    savings: number
  }
}

/**
 * GET /api/finances/dashboard - Récupère le tableau de bord financier complet
 * Retourne toutes les données financières de l'utilisateur ou de son groupe
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const operationId = `dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  console.log('🔍 GET /api/finances/dashboard - Start', {
    timestamp: new Date().toISOString(),
    level: 'info',
    component: '/api/finances/dashboard',
    operation: 'fetch_dashboard',
    operationId: operationId
  })
  
  try {
    // Session validation
    const session = await validateSessionToken(request)
    console.log('📋 Session validation', {
      timestamp: new Date().toISOString(),
      level: 'debug',
      component: '/api/finances/dashboard',
      operation: 'validate_session',
      operationId: operationId,
      userId: session?.userId,
      isValid: !!session?.userId
    })
    
    if (!session?.userId) {
      console.log('❌ Authentication failed', {
        timestamp: new Date().toISOString(),
        level: 'warn',
        component: '/api/finances/dashboard',
        operation: 'auth_failed',
        operationId: operationId
      })
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const forGroup = url.searchParams.get('group') === 'true'
    
    console.log('🎯 Dashboard request context', {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: '/api/finances/dashboard',
      operation: 'request_context',
      operationId: operationId,
      userId: session.userId,
      forGroup: forGroup
    })

    // Get current date range for monthly calculations
    const currentDate = new Date()
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

    let userId = session.userId
    let groupId: string | null = null

    if (forGroup) {
      // Get user's group
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({
          error: 'Vous devez appartenir à un groupe pour voir les données de groupe'
        }, { status: 400 })
      }

      groupId = profile.group_id
      userId = ''  // Clear userId when working with group
    }

    // Build base conditions for queries
    const ownerCondition = forGroup ? { group_id: groupId } : { profile_id: userId }

    // Use database function for financial calculations
    console.log('🧮 Using database functions for calculations', {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: '/api/finances/dashboard',
      operation: 'database_calculations',
      operationId: operationId,
      ownerType: forGroup ? 'group' : 'profile',
      ownerId: forGroup ? groupId : userId
    })
    
    // Call database functions for main calculations
    const { data: calculatedData, error: calcError } = await supabaseServer
      .rpc('calculate_available_cash', {
        target_profile_id: forGroup ? null : userId,
        target_group_id: forGroup ? groupId : null
      })
    
    if (calcError) {
      console.error('❌ Database calculation error', {
        timestamp: new Date().toISOString(),
        level: 'error',
        component: '/api/finances/dashboard',
        operation: 'database_calculation_error',
        operationId: operationId,
        error: calcError
      })
    }
    
    const { data: remainingToLive, error: remainingError } = await supabaseServer
      .rpc('calculate_remaining_to_live', {
        target_profile_id: forGroup ? null : userId,
        target_group_id: forGroup ? groupId : null
      })
    
    if (remainingError) {
      console.error('❌ Remaining to live calculation error', {
        timestamp: new Date().toISOString(),
        level: 'error',
        component: '/api/finances/dashboard',
        operation: 'remaining_calculation_error',
        operationId: operationId,
        error: remainingError
      })
    }

    // Get financial snapshot (for comparison/backup)
    const { data: snapshot, error: snapshotError } = await supabaseServer
      .from('financial_snapshots')
      .select('*')
      .match(ownerCondition)
      .eq('is_current', true)
      .single()
    
    console.log('📊 Snapshot query result', {
      timestamp: new Date().toISOString(),
      level: 'debug',
      component: '/api/finances/dashboard',
      operation: 'snapshot_query',
      operationId: operationId,
      hasSnapshot: !!snapshot,
      snapshotError: snapshotError?.message
    })

    // Get estimated incomes
    const { data: estimatedIncomes } = await supabaseServer
      .from('estimated_incomes')
      .select('id, name, estimated_amount, is_monthly_recurring')
      .match(ownerCondition)
      .order('created_at', { ascending: false })

    // Get recent income entries (last 10)
    const { data: recentIncomeEntries } = await supabaseServer
      .from('real_income_entries')
      .select(`
        id, amount, description, entry_date, is_exceptional,
        estimated_income:estimated_incomes(name)
      `)
      .match(ownerCondition)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    // Get estimated budgets with spending calculation
    const { data: estimatedBudgets } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, current_savings, is_monthly_recurring')
      .match(ownerCondition)
      .order('created_at', { ascending: false })

    // Calculate spending for each budget this month
    const budgetsWithSpending = await Promise.all((estimatedBudgets || []).map(async (budget) => {
      const { data: expenses } = await supabaseServer
        .from('real_expenses')
        .select('amount')
        .eq('estimated_budget_id', budget.id)
        .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
        .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

      const spentThisMonth = expenses?.reduce((sum, expense) => sum + expense.amount, 0) || 0

      return {
        ...budget,
        spent_this_month: spentThisMonth
      }
    }))

    // Get recent expenses (last 10)
    const { data: recentExpenses } = await supabaseServer
      .from('real_expenses')
      .select(`
        id, amount, description, expense_date, is_exceptional,
        estimated_budget:estimated_budgets(name)
      `)
      .match(ownerCondition)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    // Calculate monthly totals
    const monthlyIncomeQuery = await supabaseServer
      .from('real_income_entries')
      .select('amount')
      .match(ownerCondition)
      .gte('entry_date', firstDayOfMonth.toISOString().split('T')[0])
      .lte('entry_date', lastDayOfMonth.toISOString().split('T')[0])

    const monthlyExpensesQuery = await supabaseServer
      .from('real_expenses')
      .select('amount, is_exceptional')
      .match(ownerCondition)
      .gte('expense_date', firstDayOfMonth.toISOString().split('T')[0])
      .lte('expense_date', lastDayOfMonth.toISOString().split('T')[0])

    const monthlyIncome = monthlyIncomeQuery.data?.reduce((sum, entry) => sum + entry.amount, 0) || 0
    const monthlyExpenses = monthlyExpensesQuery.data || []
    const monthlySpent = monthlyExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const monthlyExceptionalExpenses = monthlyExpenses
      .filter(expense => expense.is_exceptional)
      .reduce((sum, expense) => sum + expense.amount, 0)

    // Calculate totals
    const totalEstimatedIncome = (estimatedIncomes || []).reduce((sum, income) => 
      sum + (income.is_monthly_recurring ? income.estimated_amount : 0), 0)
    
    const totalEstimatedBudgets = (estimatedBudgets || []).reduce((sum, budget) => 
      sum + (budget.is_monthly_recurring ? budget.estimated_amount : 0), 0)

    const totalSavings = (budgetsWithSpending || []).reduce((sum, budget) => 
      sum + budget.current_savings, 0)

    // Build dashboard data using database calculations
    const dashboardData: FinancialDashboardData = {
      // Main indicators (from database functions)
      available_cash: calculatedData || snapshot?.available_cash || 0,
      remaining_to_live: remainingToLive || snapshot?.remaining_to_live || 0,
      total_savings: totalSavings,
      
      // Income data
      total_estimated_income: totalEstimatedIncome,
      total_real_income: snapshot?.total_real_income || 0,
      estimated_incomes: estimatedIncomes || [],
      recent_income_entries: recentIncomeEntries || [],
      
      // Budget data
      total_estimated_budgets: totalEstimatedBudgets,
      estimated_budgets: budgetsWithSpending || [],
      
      // Expense data
      total_real_expenses: snapshot?.total_real_expenses || 0,
      recent_expenses: recentExpenses || [],
      
      // Monthly summary
      monthly_summary: {
        income: monthlyIncome,
        budgeted: totalEstimatedBudgets,
        spent: monthlySpent,
        exceptional_expenses: monthlyExceptionalExpenses,
        savings: totalSavings
      }
    }

    console.log('✅ Dashboard loaded successfully', {
      timestamp: new Date().toISOString(),
      level: 'info',
      component: '/api/finances/dashboard',
      operation: 'fetch_dashboard_success',
      operationId: operationId,
      userId: session.userId,
      forGroup: forGroup,
      availableCash: dashboardData.available_cash,
      remainingToLive: dashboardData.remaining_to_live,
      totalSavings: dashboardData.total_savings,
      estimatedIncomes: dashboardData.estimated_incomes?.length || 0,
      estimatedBudgets: dashboardData.estimated_budgets?.length || 0,
      duration: Date.now() - startTime
    })
    
    return NextResponse.json({ dashboard: dashboardData })
  } catch (error) {
    console.error('❌ Dashboard loading error', {
      timestamp: new Date().toISOString(),
      level: 'error',
      component: '/api/finances/dashboard',
      operation: 'fetch_dashboard_error',
      operationId: operationId,
      userId: session?.userId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      duration: Date.now() - startTime
    })
    
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/finances/dashboard/recalculate - Force recalcul des données financières
 * Utile pour rafraîchir les calculs si nécessaire
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Non authentifié' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { for_group = false } = body

    let userId = session.userId
    let groupId: string | null = null

    if (for_group) {
      // Get user's group
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', session.userId)
        .single()

      if (!profile?.group_id) {
        return NextResponse.json({
          error: 'Vous devez appartenir à un groupe pour recalculer les données de groupe'
        }, { status: 400 })
      }

      groupId = profile.group_id
    }

    // Trigger recalculation by inserting a dummy entry and deleting it immediately
    // This will fire all the triggers to update financial_snapshots

    const ownerData = for_group ? { group_id: groupId } : { profile_id: userId }

    // Create and immediately delete a dummy income entry to trigger calculations
    const { data: dummyEntry } = await supabaseServer
      .from('real_income_entries')
      .insert({
        ...ownerData,
        amount: 0.01,
        description: 'Recalculation trigger',
        is_exceptional: true
      })
      .select()
      .single()

    if (dummyEntry) {
      await supabaseServer
        .from('real_income_entries')
        .delete()
        .eq('id', dummyEntry.id)
    }

    return NextResponse.json({
      message: 'Recalcul des données financières effectué avec succès'
    })
  } catch (error) {
    console.error('Error in POST /api/finances/dashboard/recalculate:', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    )
  }
}