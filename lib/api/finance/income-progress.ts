import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { withAuth } from '@/lib/api/with-auth'

/**
 * GET /api/finance/income/progress
 * Récupère la progression des revenus par revenu estimé
 */
export const GET = withAuth(async (request: NextRequest, { userId }) => {
  try {
    // Récupérer le contexte depuis les paramètres URL
    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') as 'profile' | 'group' || 'profile'

    let incomes: { id: string; name: string; estimated_amount: number }[] = []
    let realIncomes: { amount: number; estimated_income_id: string | null }[] = []

    if (context === 'profile') {
      // Récupérer les revenus estimés du profil
      const { data: incomesData } = await supabaseServer
        .from('estimated_incomes')
        .select('id, name, estimated_amount')
        .eq('profile_id', userId)

      incomes = incomesData || []

      // Récupérer les revenus réels associés aux revenus estimés
      const { data: realIncomesData } = await supabaseServer
        .from('real_income_entries')
        .select('amount, estimated_income_id')
        .eq('profile_id', userId)
        .not('estimated_income_id', 'is', null)

      realIncomes = realIncomesData || []

    } else {
      // Récupérer les informations du groupe de l'utilisateur
      const { data: profileData } = await supabaseServer
        .from('profiles')
        .select('group_id')
        .eq('id', userId)
        .single()

      if (!profileData?.group_id) {
        return NextResponse.json(
          { error: 'Utilisateur ne fait partie d\'aucun groupe' },
          { status: 404 }
        )
      }

      // Récupérer les revenus estimés du groupe
      const { data: incomesData } = await supabaseServer
        .from('estimated_incomes')
        .select('id, name, estimated_amount')
        .eq('group_id', profileData.group_id)

      incomes = incomesData || []

      // Récupérer les revenus réels du groupe associés aux revenus estimés
      const { data: realIncomesData } = await supabaseServer
        .from('real_income_entries')
        .select('amount, estimated_income_id')
        .eq('group_id', profileData.group_id)
        .not('estimated_income_id', 'is', null)

      realIncomes = realIncomesData || []
    }

    // Calculer la progression pour chaque revenu estimé
    const progressData = incomes.map(income => {
      const receivedAmount = realIncomes
        .filter(realIncome => realIncome.estimated_income_id === income.id)
        .reduce((sum, realIncome) => sum + realIncome.amount, 0)

      const bonusAmount = receivedAmount - income.estimated_amount

      return {
        incomeId: income.id,
        incomeName: income.name,
        receivedAmount,
        estimatedAmount: income.estimated_amount,
        bonusAmount
      }
    })

    return NextResponse.json(progressData)

  } catch (error) {
    console.error('❌ Erreur dans /api/finance/income/progress:', error)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
})