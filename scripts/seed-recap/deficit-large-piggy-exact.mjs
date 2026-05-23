// Scénario "deficit-large-piggy-exact" — la tirelire couvre EXACTEMENT le déficit.
// Déficit 200€, tirelire 200€ → tirelire à 0 après puisage.

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

runScenario('deficit-large-piggy-exact', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 200)
  await setBank({ profile_id: USER_A_ID }, 2300)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200 },
    { name: 'Loisirs', estimated_amount: 100 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 300, description: 'Gros mois' },
    { budget_name: 'Loisirs', amount: 200, description: 'Sortie chère' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-large-piggy-exact',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-200€). Tirelire (200€) couvre exactement le déficit. Après "Puiser tout", tirelire = 0€.',
    expectedFigures: {
      'Total budgets estimés': 300,
      'Total dépenses réelles': 500,
      'Déficit global': -200,
      'Tirelire avant': 200,
      'Tirelire attendue après': 0,
    },
    cookieHint: true,
  })
})
