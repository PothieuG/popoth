// Scénario "transactions-all-non-validated" — aucune transaction n'est validée.
// Au complete : TOUTES deviennent is_carried_over=true → visibles avec badge "Reporté"
// sur le dashboard du mois suivant.

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  insertProfileRealIncomes,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('transactions-all-non-validated', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 100, description: 'Lidl non-validé', applied: false },
    { budget_name: 'Courses', amount: 80, description: 'Carrefour non-validé', applied: false },
    { budget_name: 'Courses', amount: 60, description: 'Pain non-validé', applied: false },
    { budget_name: 'Courses', amount: 50, description: 'Boucherie non-validé', applied: false },
    { budget_name: 'Courses', amount: 70, description: 'Drive non-validé', applied: false },
  ])

  await insertProfileRealIncomes(USER_A_ID, [
    { amount: 2500, description: 'Salaire non-validé', applied: false },
  ])

  printPostSeedInstructions({
    scenarioKey: 'transactions-all-non-validated',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan calculé sur les transactions présentes (non-validées comptent quand même dans bilan tant qu\'is_carried_over=false). Au complete : TOUTES les 5 dépenses + 1 revenu deviennent is_carried_over=true + carried_from_recap_id=<id>. Dashboard mois suivant les affiche avec badge "Reporté" en visuel, non-comptables dans le bilan du mois suivant.',
    expectedFigures: {
      'Dépenses non-validées (toutes à carry-over)': 5,
      'Revenus non-validés (à carry-over)': 1,
      'Total spent (visible bilan)': 360,
      'Total income (visible bilan)': 2500,
    },
    cookieHint: true,
  })
})
