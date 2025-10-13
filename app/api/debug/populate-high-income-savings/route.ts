import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

/**
 * API POST /api/debug/populate-high-income-savings
 *
 * Scenario: High income with savings on multiple budgets
 * Tests case where user has sufficient income to cover all estimated budgets
 * and manages to save on several categories
 */
export async function POST(request: NextRequest) {
  try {
    // Session validation
    const sessionData = await validateSessionToken(request)
    if (!sessionData?.userId) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    const userId = sessionData.userId
    console.log(`🏗️ [High Income + Savings] Creating budgets with high income and savings for userId: ${userId}`)

    // 1. Delete existing data + MONTHLY RECAPS
    console.log('🗑️ [High Income + Savings] Cleaning existing data...')

    await supabaseServer.from('budget_transfers').delete().eq('profile_id', userId)
    await supabaseServer.from('real_expenses').delete().eq('profile_id', userId)
    await supabaseServer.from('real_income_entries').delete().eq('profile_id', userId)
    await supabaseServer.from('estimated_budgets').delete().eq('profile_id', userId)

    // Delete monthly recaps to force recalculation
    await supabaseServer.from('monthly_recaps').delete().eq('profile_id', userId)
    console.log('🧹 [High Income + Savings] Monthly recaps deleted to force recalculation')

    // 2. Deactivate snapshots
    await supabaseServer
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    // 3. Define budgets with mix of savings, cumulated savings, and normal spending
    const budgetData = [
      // Fixed expenses (incompressible) - no cumulated savings
      { name: 'Loyer', estimated: 1200, spent: 1200, cumulatedSavings: 0, description: 'Loyer mensuel' },
      { name: 'Assurance Habitation', estimated: 85, spent: 85, cumulatedSavings: 0, description: 'Assurance obligatoire' },
      { name: 'Mutuelle Santé', estimated: 120, spent: 120, cumulatedSavings: 0, description: 'Complémentaire santé' },
      { name: 'Internet + Téléphone', estimated: 75, spent: 75, cumulatedSavings: 0, description: 'Forfaits fixes' },
      { name: 'Électricité', estimated: 95, spent: 95, cumulatedSavings: 0, description: 'Facture mensuelle' },

      // Budgets with good savings + cumulated savings from previous months
      { name: 'Courses Alimentaires', estimated: 600, spent: 320, cumulatedSavings: 450, description: 'Anti-gaspillage et promotions' },
      { name: 'Essence', estimated: 280, spent: 150, cumulatedSavings: 380, description: 'Plus de covoiturage' },
      { name: 'Restaurants', estimated: 250, spent: 110, cumulatedSavings: 280, description: 'Repas maison privilégiés' },
      { name: 'Loisirs', estimated: 200, spent: 95, cumulatedSavings: 315, description: 'Activités gratuites' },
      { name: 'Vêtements', estimated: 300, spent: 130, cumulatedSavings: 510, description: 'Achats raisonnés' },
      { name: 'Équipement Sport', estimated: 180, spent: 75, cumulatedSavings: 210, description: 'Équipement d\'occasion' },

      // Budgets with moderate savings + some cumulated savings
      { name: 'Sorties Culture', estimated: 150, spent: 105, cumulatedSavings: 135, description: 'Tarifs réduits' },
      { name: 'Cadeaux', estimated: 200, spent: 135, cumulatedSavings: 195, description: 'Cadeaux faits maison' },
      { name: 'Produits Ménage', estimated: 80, spent: 55, cumulatedSavings: 75, description: 'Marques distributeur' },
      { name: 'Coiffeur', estimated: 60, spent: 42, cumulatedSavings: 54, description: 'Espacement des RDV' },

      // Normal spending (no monthly savings but has some cumulated savings)
      { name: 'Abonnement Streaming', estimated: 35, spent: 35, cumulatedSavings: 0, description: 'Netflix + Spotify' },
      { name: 'Transport Public', estimated: 75, spent: 75, cumulatedSavings: 0, description: 'Pass Navigo' },

      // Small exceptional expense (no cumulated savings)
      { name: 'Réparation Laptop', estimated: 150, spent: 185, cumulatedSavings: 0, description: 'Réparation imprévue' }
    ]

    console.log(`📊 [High Income + Savings] Creating ${budgetData.length} budgets`)

    // 4. Create estimated budgets with cumulated savings
    const budgetInserts = budgetData.map(budget => ({
      profile_id: userId,
      name: budget.name,
      estimated_amount: budget.estimated,
      is_monthly_recurring: true,
      monthly_surplus: 0,
      monthly_deficit: 0,
      cumulated_savings: budget.cumulatedSavings
    }))

    const { data: createdBudgets, error: budgetError } = await supabaseServer
      .from('estimated_budgets')
      .insert(budgetInserts)
      .select('id, name, estimated_amount')

    if (budgetError) {
      console.error('❌ [High Income + Savings] Error creating budgets:', budgetError)
      return NextResponse.json({ error: 'Error creating budgets' }, { status: 500 })
    }

    console.log(`✅ [High Income + Savings] ${createdBudgets.length} budgets created`)

    // 5. Create real expenses
    const expenseInserts = []
    const summary = []

    for (const budget of createdBudgets) {
      const budgetConfig = budgetData.find(b => b.name === budget.name)
      if (!budgetConfig) continue

      // Create 1-3 expenses per budget
      const numExpenses = Math.floor(Math.random() * 3) + 1
      let totalSpent = 0

      for (let i = 0; i < numExpenses; i++) {
        let expenseAmount

        if (i === numExpenses - 1) {
          // Last expense: adjust to reach exact total
          expenseAmount = budgetConfig.spent - totalSpent
        } else {
          // Intermediate expenses
          const remaining = budgetConfig.spent - totalSpent
          expenseAmount = Math.max(5, Math.floor(remaining / (numExpenses - i)))
        }

        if (expenseAmount > 0) {
          expenseInserts.push({
            profile_id: userId,
            estimated_budget_id: budget.id,
            amount: expenseAmount,
            description: `${budgetConfig.description} - Expense ${i + 1}`,
            expense_date: '2025-10-10',
            is_exceptional: false
          })

          totalSpent += expenseAmount
        }
      }

      // Calculations for summary
      const estimated = budget.estimated_amount
      const spent = budgetConfig.spent
      const cumulatedSavings = budgetConfig.cumulatedSavings
      const difference = estimated - spent
      const percentChange = estimated > 0 ? ((difference / estimated) * 100).toFixed(1) : '0.0'

      summary.push({
        name: budget.name,
        estimated,
        spent,
        difference,
        cumulatedSavings,
        percentChange: `${percentChange}%`,
        surplus: Math.max(0, difference),
        deficit: Math.max(0, -difference),
        status: difference > 0 ? 'surplus' : difference < 0 ? 'deficit' : 'balanced'
      })

      const savingsInfo = cumulatedSavings > 0 ? ` | Cumulated: ${cumulatedSavings}€` : ''
      console.log(`📝 [High Income + Savings] ${budget.name}: ${spent}€ / ${estimated}€ → ${difference > 0 ? '+' : ''}${difference}€${savingsInfo}`)
    }

    // 6. Insert all expenses
    const { error: expenseError } = await supabaseServer
      .from('real_expenses')
      .insert(expenseInserts)

    if (expenseError) {
      console.error('❌ [High Income + Savings] Error creating expenses:', expenseError)
      return NextResponse.json({ error: 'Error creating expenses' }, { status: 500 })
    }

    console.log(`✅ [High Income + Savings] ${expenseInserts.length} expenses created`)

    // 7. Calculate total estimated amount for income generation
    const totalEstimated = summary.reduce((sum, item) => sum + item.estimated, 0)
    const totalSpent = summary.reduce((sum, item) => sum + item.spent, 0)
    const totalSavings = totalEstimated - totalSpent
    const totalCumulatedSavings = summary.reduce((sum, item) => sum + item.cumulatedSavings, 0)

    // 8. Create HIGH INCOME entries (enough to cover all estimated budgets + extra)
    // Generate income slightly higher than total estimated (105-110% of total)
    const baseIncome = Math.ceil(totalEstimated * 1.08) // 108% of estimated

    const incomeEntries = [
      {
        profile_id: userId,
        amount: Math.floor(baseIncome * 0.75), // Main salary (75% of total income)
        description: 'Salaire Principal',
        entry_date: '2025-10-01',
        is_exceptional: false
      },
      {
        profile_id: userId,
        amount: Math.floor(baseIncome * 0.15), // Side income (15%)
        description: 'Freelance / Activité Complémentaire',
        entry_date: '2025-10-05',
        is_exceptional: false
      },
      {
        profile_id: userId,
        amount: Math.floor(baseIncome * 0.10), // Bonus or other income (10%)
        description: 'Prime / Autres Revenus',
        entry_date: '2025-10-15',
        is_exceptional: true
      }
    ]

    const totalIncome = incomeEntries.reduce((sum, entry) => sum + entry.amount, 0)

    const { error: incomeError } = await supabaseServer
      .from('real_income_entries')
      .insert(incomeEntries)

    if (incomeError) {
      console.error('❌ [High Income + Savings] Error creating income entries:', incomeError)
      return NextResponse.json({ error: 'Error creating income entries' }, { status: 500 })
    }

    console.log(`✅ [High Income + Savings] ${incomeEntries.length} income entries created`)
    console.log(`💰 [High Income + Savings] Total income: ${totalIncome}€ (vs ${totalEstimated}€ estimated)`)

    // 9. Calculate financial statistics
    const remainingToLive = totalIncome - totalSpent
    const incomeVsEstimatedDiff = totalIncome - totalEstimated

    const budgetsByStatus = {
      surplus: summary.filter(b => b.status === 'surplus'),
      deficit: summary.filter(b => b.status === 'deficit'),
      balanced: summary.filter(b => b.status === 'balanced')
    }

    console.log('📊 [High Income + Savings] Statistics generated:')
    console.log(`💰 Total income: ${totalIncome}€`)
    console.log(`📊 Total estimated: ${totalEstimated}€`)
    console.log(`💸 Total spent: ${totalSpent}€`)
    console.log(`💚 Monthly budget savings: ${totalSavings}€`)
    console.log(`🏦 Total cumulated savings: ${totalCumulatedSavings}€`)
    console.log(`🎯 Remaining to live (RAV): ${remainingToLive}€`)
    console.log(`📈 Income vs estimated: +${incomeVsEstimatedDiff}€`)
    console.log(`📊 Budgets with surplus: ${budgetsByStatus.surplus.length}`)
    console.log(`📉 Budgets in deficit: ${budgetsByStatus.deficit.length}`)

    return NextResponse.json({
      success: true,
      message: 'Scenario "High income with savings" created successfully',
      scenario: 'high-income-savings',
      statistics: {
        totalBudgets: createdBudgets.length,
        totalExpenses: expenseInserts.length,
        totalIncomeEntries: incomeEntries.length,
        budgetsByStatus,
        totals: {
          income: totalIncome,
          estimated: totalEstimated,
          spent: totalSpent,
          monthlySavings: totalSavings,
          cumulatedSavings: totalCumulatedSavings,
          remainingToLive: remainingToLive,
          incomeVsEstimated: incomeVsEstimatedDiff
        }
      },
      summary: summary.sort((a, b) => b.difference - a.difference),
      income_entries: incomeEntries.map(entry => ({
        description: entry.description,
        amount: entry.amount,
        date: entry.entry_date,
        is_exceptional: entry.is_exceptional
      })),
      financial_impact: {
        description: 'Healthy financial situation with sufficient income to cover all budgets and generate savings',
        rav: remainingToLive,
        rav_status: remainingToLive > 1000 ? 'excellent' : remainingToLive > 500 ? 'good' : 'moderate',
        coverage_ratio: ((totalIncome / totalEstimated) * 100).toFixed(1) + '%',
        savings_ratio: ((totalSavings / totalEstimated) * 100).toFixed(1) + '%'
      },
      actions: {
        budgetsCreated: createdBudgets.length,
        expensesCreated: expenseInserts.length,
        incomeEntriesCreated: incomeEntries.length,
        previousDataDeleted: true,
        snapshotsDeactivated: true
      }
    })

  } catch (error) {
    console.error('❌ [High Income + Savings] General error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
