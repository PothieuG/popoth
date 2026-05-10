import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuthAndProfile } from '@/lib/api/with-auth'
import { logger } from '@/lib/logger'

/**
 * API Get Savings Data
 * Returns all estimated budgets with their cumulated savings
 * GET /api/savings/data?context=profile|group
 */
export const GET = withAuthAndProfile(async (request, { profile }) => {
  try {
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    if (!context || (context !== 'profile' && context !== 'group')) {
      return NextResponse.json({ error: 'Contexte invalide' }, { status: 400 })
    }

    // Determine context filter
    const contextFilter =
      context === 'group' && profile.group_id
        ? { group_id: profile.group_id }
        : { profile_id: profile.id }

    // Get all estimated budgets with their savings
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings, last_savings_update')
      .match(contextFilter)
      .order('name', { ascending: true })

    if (budgetsError) {
      logger.error('❌ Erreur récupération budgets:', budgetsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 },
      )
    }

    // Calculate totals from budgets
    const budgetsSavings = budgets?.reduce((sum, b) => sum + (b.cumulated_savings || 0), 0) || 0
    const budgetsWithSavings = budgets?.filter((b) => (b.cumulated_savings || 0) > 0) || []
    const budgetsWithoutSavings = budgets?.filter((b) => (b.cumulated_savings || 0) === 0) || []

    // Get piggy bank amount using the same context filter
    const { data: piggyBankData, error: piggyBankError } = await supabaseServer
      .from('piggy_bank')
      .select('amount')
      .match(contextFilter)
      .maybeSingle()

    const piggyBankAmount = piggyBankData?.amount || 0

    if (piggyBankError) {
      logger.warn('⚠️ Erreur récupération tirelire:', piggyBankError)
    }

    // Total savings = budgets savings + piggy bank
    const totalSavings = budgetsSavings + piggyBankAmount

    return NextResponse.json({
      success: true,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,
      budgets: budgets || [],
      piggy_bank: piggyBankAmount,
      statistics: {
        total_budgets: budgets?.length || 0,
        budgets_with_savings: budgetsWithSavings.length,
        budgets_without_savings: budgetsWithoutSavings.length,
        budgets_savings: budgetsSavings,
        piggy_bank: piggyBankAmount,
        total_savings: totalSavings,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Erreur serveur lors de la récupération des données' },
      { status: 500 },
    )
  }
})
