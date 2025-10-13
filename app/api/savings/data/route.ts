import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API Get Savings Data
 * Returns all estimated budgets with their cumulated savings
 * GET /api/savings/data?context=profile|group
 */
export async function GET(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' | null

    if (!context || (context !== 'profile' && context !== 'group')) {
      return NextResponse.json(
        { error: 'Contexte invalide' },
        { status: 400 }
      )
    }

    console.log(``)
    console.log(`💰💰💰 ========================================================`)
    console.log(`💰💰💰 [SAVINGS DATA] RÉCUPÉRATION DES ÉCONOMIES`)
    console.log(`💰💰💰 ========================================================`)
    console.log(`💰 Contexte: ${context}`)
    console.log(`💰 User ID: ${userId}`)

    // Get user profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('profiles')
      .select('id, group_id, first_name, last_name')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.error('❌ Erreur récupération profil:', profileError)
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }

    // Determine context filter
    const contextFilter = context === 'group' && profile.group_id
      ? { group_id: profile.group_id }
      : { profile_id: profile.id }

    console.log(`💰 Filtre appliqué:`, contextFilter)

    // Get all estimated budgets with their savings
    const { data: budgets, error: budgetsError } = await supabaseServer
      .from('estimated_budgets')
      .select('id, name, estimated_amount, cumulated_savings, last_savings_update')
      .match(contextFilter)
      .order('name', { ascending: true })

    if (budgetsError) {
      console.error('❌ Erreur récupération budgets:', budgetsError)
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des budgets' },
        { status: 500 }
      )
    }

    // Calculate totals
    const totalSavings = budgets?.reduce((sum, b) => sum + (b.cumulated_savings || 0), 0) || 0
    const budgetsWithSavings = budgets?.filter(b => (b.cumulated_savings || 0) > 0) || []
    const budgetsWithoutSavings = budgets?.filter(b => (b.cumulated_savings || 0) === 0) || []

    console.log(``)
    console.log(`📊 RÉSULTAT:`)
    console.log(`   - Total budgets: ${budgets?.length || 0}`)
    console.log(`   - Budgets avec économies: ${budgetsWithSavings.length}`)
    console.log(`   - Total économies: ${totalSavings}€`)
    console.log(`💰💰💰 ========================================================`)
    console.log(``)

    return NextResponse.json({
      success: true,
      context,
      user_name: `${profile.first_name} ${profile.last_name}`,
      budgets: budgets || [],
      statistics: {
        total_budgets: budgets?.length || 0,
        budgets_with_savings: budgetsWithSavings.length,
        budgets_without_savings: budgetsWithoutSavings.length,
        total_savings: totalSavings
      }
    })

  } catch (error) {
    console.error('❌ Erreur dans GET /api/savings/data:', error)
    return NextResponse.json(
      { error: 'Erreur serveur lors de la récupération des données' },
      { status: 500 }
    )
  }
}
