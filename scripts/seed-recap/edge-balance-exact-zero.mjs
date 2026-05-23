// Scénario "edge-balance-exact-zero" — spent = estimated exactement.
// Surplus = 0, déficit = 0, bilanSign = 'zero'.
// Edge case : tester que le wizard gère correctement le cas pile poil neutre.

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('edge-balance-exact-zero', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200 },
    { name: 'Loisirs', estimated_amount: 200 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 200, description: 'Pile poil' },
    { budget_name: 'Loisirs', amount: 200, description: 'Pile poil' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'edge-balance-exact-zero',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan exactement 0€ (bilanSign="zero"). Pas d\'écran Manage Bilan (rien à arbitrer). Le wizard devrait sauter direct au Final Recap.',
    expectedFigures: {
      'Total budgets estimés': 400,
      'Total dépenses réelles': 400,
      Bilan: 0,
      'BilanSign attendu': 'zero',
    },
    cookieHint: true,
  })
})
