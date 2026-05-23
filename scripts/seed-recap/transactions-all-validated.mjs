// Scénario "transactions-all-validated" — toutes les transactions sont validées.
// Au complete : TOUTES sont DELETE → dashboard post-recap = liste vide.

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

runScenario('transactions-all-validated', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 100, description: 'Lidl', applied: true },
    { budget_name: 'Courses', amount: 80, description: 'Carrefour', applied: true },
    { budget_name: 'Courses', amount: 60, description: 'Pain', applied: true },
    { budget_name: 'Courses', amount: 50, description: 'Boucherie', applied: true },
    { budget_name: 'Courses', amount: 70, description: 'Drive', applied: true },
    { budget_name: 'Courses', amount: 40, description: 'Pharmacie', applied: true },
  ])

  await insertProfileRealIncomes(USER_A_ID, [
    { amount: 2500, description: 'Salaire validé', applied: true },
  ])

  printPostSeedInstructions({
    scenarioKey: 'transactions-all-validated',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan positif (+0€ ou neutre selon revenus). Au complete : TOUTES les 6 dépenses + 1 revenu sont DELETE de la base. Dashboard du mois suivant = liste transactions vide (aucun carry-over).',
    expectedFigures: {
      'Dépenses validées (toutes à DELETE)': 6,
      'Dépenses non-validées': 0,
      'Revenus validés (à DELETE)': 1,
      'Total spent': 400,
      'Total income': 2500,
    },
    cookieHint: true,
  })
})
