// Scénario "deficit-cascade-full" — cascade complète tirelire + savings + snapshot.
// Déficit 500€ : piggy 100€ + savings 100€ + snapshot 300€ sur budgets restants.

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

runScenario('deficit-cascade-full', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 50 },
    { name: 'Loisirs', estimated_amount: 300, cumulated_savings: 50 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 400, description: 'Gros mois' },
    { budget_name: 'Loisirs', amount: 500, description: 'Sortie chère' },
    { budget_name: 'Transport', amount: 400, description: 'Réparation voiture' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-cascade-full',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-500€). Cascade complète : piggy 100€ → savings 100€ → snapshot budget 300€ (à répartir sur Courses+Loisirs+Transport proportionnellement à estimated_amount).',
    expectedFigures: {
      'Total budgets estimés': 800,
      'Total dépenses réelles': 1300,
      'Déficit global': -500,
      'Tirelire avant': 100,
      'Pool savings avant': 100,
      'Snapshot budget à appliquer': 300,
    },
    cookieHint: true,
  })
})
