// Scénario "deficit-savings-pool-equal-deficit" — le pool savings vaut exactement le déficit.
// Déficit 250€, savings pool 250€ → savings drainent tout, pool = 0 après.

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

runScenario('deficit-savings-pool-equal-deficit', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2500)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 125 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 125 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 200, description: 'Pile poil' },
    { budget_name: 'Loisirs', amount: 450, description: 'Gros débordement' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-savings-pool-equal-deficit',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-250€). Cascade savings draine exactement 250€ depuis le pool 250€. Après : pool savings = 0€ sur chacun des budgets.',
    expectedFigures: {
      'Total budgets estimés': 400,
      'Total dépenses réelles': 650,
      'Déficit global': -250,
      'Pool savings avant': 250,
      'Pool savings après': 0,
    },
    cookieHint: true,
  })
})
