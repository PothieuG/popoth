// Scénario "deficit-cascade-extreme" — déficit énorme qui force le puisage sur TOUS les budgets.
// Déficit 2000€, piggy 0, savings 0 → snapshot massif.

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

runScenario('deficit-cascade-extreme', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 500)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Loisirs', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
    { name: 'Restaurant', estimated_amount: 200, cumulated_savings: 0 },
    { name: 'Sport', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 600, description: 'Catastrophe' },
    { budget_name: 'Loisirs', amount: 700, description: 'Catastrophe' },
    { budget_name: 'Transport', amount: 500, description: 'Catastrophe' },
    { budget_name: 'Restaurant', amount: 800, description: 'Catastrophe' },
    { budget_name: 'Sport', amount: 600, description: 'Catastrophe' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-cascade-extreme',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      "Wizard bilan négatif (-2000€) — cas extrême. Aucune tirelire ni savings disponibles. Snapshot budget colossal à répartir sur les 5 budgets. Test l'UX en cas de catastrophe budgétaire.",
    expectedFigures: {
      'Total budgets estimés': 1200,
      'Total dépenses réelles': 3200,
      'Déficit global': -2000,
      'Snapshot budget à appliquer': 2000,
      Salaire: 2500,
    },
    cookieHint: true,
  })
})
