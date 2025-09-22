/**
 * Script de réinitialisation des données de budget pour les tests
 *
 * Ce script :
 * 1. Supprime tous les transferts existants
 * 2. Remet les dépenses à des valeurs cohérentes
 * 3. Désactive les snapshots actifs pour forcer une nouvelle initialisation
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Clé service pour admin
)

async function resetBudgetData() {
  try {
    console.log('🔄 Démarrage de la réinitialisation des données de budget...')

    // 1. Récupérer l'utilisateur de test (remplace par ton ID utilisateur)
    const userId = '0679b0f9-830a-44e5-aecf-f8452c8dd101'

    console.log(`👤 Réinitialisation pour l'utilisateur: ${userId}`)

    // 2. Supprimer tous les transferts de budget
    console.log('🗑️ Suppression des transferts existants...')
    const { error: deleteTransfersError } = await supabase
      .from('budget_transfers')
      .delete()
      .eq('profile_id', userId)

    if (deleteTransfersError) {
      console.error('❌ Erreur lors de la suppression des transferts:', deleteTransfersError)
    } else {
      console.log('✅ Transferts supprimés')
    }

    // 3. Supprimer toutes les dépenses réelles existantes
    console.log('🗑️ Suppression des dépenses existantes...')
    const { error: deleteExpensesError } = await supabase
      .from('real_expenses')
      .delete()
      .eq('profile_id', userId)

    if (deleteExpensesError) {
      console.error('❌ Erreur lors de la suppression des dépenses:', deleteExpensesError)
    } else {
      console.log('✅ Dépenses supprimées')
    }

    // 4. Récupérer les budgets estimés
    const { data: budgets, error: budgetsError } = await supabase
      .from('estimated_budgets')
      .select('*')
      .eq('profile_id', userId)

    if (budgetsError) {
      console.error('❌ Erreur lors de la récupération des budgets:', budgetsError)
      return
    }

    console.log(`📊 ${budgets.length} budgets trouvés`)

    // 5. Créer des dépenses de test cohérentes
    const testExpenses = []

    for (const budget of budgets) {
      let expenseAmount
      let description

      if (budget.name === 'Courses') {
        // Budget Courses: 400€ estimé, on dépense 250€ → 150€ de surplus
        expenseAmount = 250
        description = 'Courses de la semaine'
      } else if (budget.name === 'Scolarité') {
        // Budget Scolarité: 600€ estimé, on dépense 750€ → 150€ de déficit
        expenseAmount = 750
        description = 'Frais de scolarité'
      } else {
        // Pour les autres budgets, on dépense 80% du budget estimé
        expenseAmount = Math.round(budget.estimated_amount * 0.8)
        description = `Dépense pour ${budget.name}`
      }

      testExpenses.push({
        profile_id: userId,
        estimated_budget_id: budget.id,
        amount: expenseAmount,
        description: description,
        expense_date: '2025-09-22',
        is_exceptional: false
      })

      console.log(`📝 ${budget.name}: ${expenseAmount}€ / ${budget.estimated_amount}€ estimé`)
    }

    // 6. Insérer les nouvelles dépenses
    console.log('💾 Création des nouvelles dépenses...')
    const { error: insertExpensesError } = await supabase
      .from('real_expenses')
      .insert(testExpenses)

    if (insertExpensesError) {
      console.error('❌ Erreur lors de l\'insertion des dépenses:', insertExpensesError)
      return
    }

    console.log('✅ Nouvelles dépenses créées')

    // 7. Désactiver tous les snapshots actifs pour forcer une réinitialisation
    console.log('📸 Désactivation des snapshots actifs...')
    const { error: deactivateSnapshotsError } = await supabase
      .from('recap_snapshots')
      .update({ is_active: false })
      .eq('profile_id', userId)
      .eq('is_active', true)

    if (deactivateSnapshotsError) {
      console.error('❌ Erreur lors de la désactivation des snapshots:', deactivateSnapshotsError)
    } else {
      console.log('✅ Snapshots désactivés')
    }

    // 8. Résumé des nouvelles données
    console.log('\n📊 Résumé des nouvelles données:')
    console.log('=====================================')

    let totalSurplus = 0
    let totalDeficit = 0

    for (const budget of budgets) {
      const expense = testExpenses.find(e => e.estimated_budget_id === budget.id)
      const spent = expense ? expense.amount : 0
      const estimated = budget.estimated_amount
      const difference = estimated - spent

      if (difference > 0) {
        console.log(`✅ ${budget.name}: ${spent}€ / ${estimated}€ → +${difference}€ surplus`)
        totalSurplus += difference
      } else if (difference < 0) {
        console.log(`❌ ${budget.name}: ${spent}€ / ${estimated}€ → ${difference}€ déficit`)
        totalDeficit += Math.abs(difference)
      } else {
        console.log(`⚖️ ${budget.name}: ${spent}€ / ${estimated}€ → équilibré`)
      }
    }

    console.log('=====================================')
    console.log(`💚 Total surplus: ${totalSurplus}€`)
    console.log(`❤️ Total déficit: ${totalDeficit}€`)
    console.log(`⚖️ Ratio général: ${totalSurplus - totalDeficit}€`)
    console.log('\n🎉 Réinitialisation terminée ! Vous pouvez maintenant tester le monthly recap.')

  } catch (error) {
    console.error('❌ Erreur générale:', error)
  }
}

// Exécuter le script
resetBudgetData()