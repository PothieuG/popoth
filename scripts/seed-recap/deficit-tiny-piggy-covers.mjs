// Scénario "deficit-tiny-piggy-covers" — petit déficit absorbé entièrement par la tirelire.
// Déficit 20€, tirelire 100€ → la tirelire suffit, il reste 80€ après le puisage.

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

runScenario('deficit-tiny-piggy-covers', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2480)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 220, description: 'Petit débordement' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-tiny-piggy-covers',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-20€). Étape Manage bilan : tirelire seule suffit. Choisir "Puiser dans la tirelire 20€" → reste 80€ en tirelire, déficit éteint.',
    expectedFigures: {
      'Total budgets estimés': 200,
      'Total dépenses réelles': 220,
      'Déficit global': -20,
      'Tirelire avant': 100,
      'Tirelire attendue après': 80,
    },
    cookieHint: true,
  })
})
