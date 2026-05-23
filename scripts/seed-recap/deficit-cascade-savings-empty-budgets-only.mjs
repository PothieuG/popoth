// Scénario "deficit-cascade-savings-empty-budgets-only" — tirelire vide ET savings à 0,
// tout passe directement par le snapshot des budgets.
// Déficit 400€, piggy 0, savings 0 → snapshot 400€ uniquement.

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

runScenario('deficit-cascade-savings-empty-budgets-only', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2500)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Loisirs', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 400, description: 'Gros mois' },
    { budget_name: 'Loisirs', amount: 500, description: 'Sortie chère' },
    { budget_name: 'Transport', amount: 300, description: 'Réparation' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-cascade-savings-empty-budgets-only',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-400€). Aucune option tirelire ni savings (les deux à 0). Tout passe par le snapshot budget : 400€ à répartir proportionnellement sur les 3 budgets.',
    expectedFigures: {
      'Total budgets estimés': 800,
      'Total dépenses réelles': 1200,
      'Déficit global': -400,
      'Tirelire avant': 0,
      'Pool savings avant': 0,
      'Snapshot budget à appliquer': 400,
    },
    cookieHint: true,
  })
})
