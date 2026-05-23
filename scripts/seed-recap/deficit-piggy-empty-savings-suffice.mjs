// Scénario "deficit-piggy-empty-savings-suffice" — tirelire vide, économies suffisent.
// Déficit 100€, tirelire 0€, savings 300€ → savings seule absorbe.

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

runScenario('deficit-piggy-empty-savings-suffice', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2500)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 150 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 150 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 200, description: 'Pile poil' },
    { budget_name: 'Loisirs', amount: 300, description: 'Sortie chère' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-piggy-empty-savings-suffice',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      "Wizard bilan négatif (-100€). Tirelire à 0 → pas d'option tirelire. Cascade savings draine 100€ depuis le pool 300€ (proportionnel). Pool savings restant 200€.",
    expectedFigures: {
      'Total budgets estimés': 400,
      'Total dépenses réelles': 500,
      'Déficit global': -100,
      'Tirelire avant': 0,
      'Pool savings avant': 300,
      'Pool savings après': 200,
    },
    cookieHint: true,
  })
})
