// Scénario "transactions-mixed-validated" — mix transactions validées et non-validées.
// 10 dépenses (6 applied / 4 non-applied) + 3 incomes (2 applied / 1 non-applied).
// Au complete : les applied seront DELETE, les non-applied flaggés is_carried_over=true.

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  insertProfileIncomes,
  insertProfileRealIncomes,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('transactions-mixed-validated', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 600 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 50, description: 'Lidl 1', applied: true },
    { budget_name: 'Courses', amount: 60, description: 'Carrefour', applied: true },
    { budget_name: 'Courses', amount: 40, description: 'Pain', applied: true },
    { budget_name: 'Courses', amount: 80, description: 'Drive', applied: true },
    { budget_name: 'Courses', amount: 30, description: 'Boucherie', applied: true },
    { budget_name: 'Courses', amount: 70, description: 'Lidl 2', applied: true },
    { budget_name: 'Courses', amount: 45, description: 'Pas encore validé 1', applied: false },
    { budget_name: 'Courses', amount: 55, description: 'Pas encore validé 2', applied: false },
    { budget_name: 'Courses', amount: 35, description: 'Pas encore validé 3', applied: false },
    { budget_name: 'Courses', amount: 25, description: 'Pas encore validé 4', applied: false },
  ])

  await insertProfileIncomes(USER_A_ID, [{ name: 'Salaire', estimated_amount: 2500 }])

  await insertProfileRealIncomes(USER_A_ID, [
    { amount: 2500, description: 'Salaire validé', applied: true },
    { amount: 150, description: 'Remboursement validé', applied: true, is_exceptional: true },
    { amount: 80, description: 'Vente Vinted non validée', applied: false, is_exceptional: true },
  ])

  printPostSeedInstructions({
    scenarioKey: 'transactions-mixed-validated',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-90€ : spent 490€ / estimated 600€ + revenus exceptionnels 150€ — selon formule RAV). Au complete : 6 dépenses validées + 2 revenus validés sont DELETE de la base. Les 4 dépenses + 1 revenu non-validés deviennent is_carried_over=true → visibles avec badge "Reporté du mois précédent" sur le dashboard du mois suivant.',
    expectedFigures: {
      'Dépenses validées (à DELETE au complete)': 6,
      'Dépenses non-validées (à carry-over)': 4,
      'Revenus validés (à DELETE au complete)': 2,
      'Revenus non-validés (à carry-over)': 1,
      'Total spent (visible bilan)': 490,
      'Total income (visible bilan)': 2730,
    },
    cookieHint: true,
  })
})
