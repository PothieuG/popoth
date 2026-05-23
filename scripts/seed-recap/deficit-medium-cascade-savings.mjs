// Scénario "deficit-medium-cascade-savings" — la tirelire ne suffit pas, cascade
// proportionnelle sur les économies des budgets.
// Déficit 150€, tirelire 50€, pool savings 200€ → piggy puis savings au prorata.

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

runScenario('deficit-medium-cascade-savings', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 50)
  await setBank({ profile_id: USER_A_ID }, 2450)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 80 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 60 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 60 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 200, description: 'Pile poil' },
    { budget_name: 'Loisirs', amount: 250, description: 'Sortie' },
    { budget_name: 'Transport', amount: 300, description: 'Réparation voiture' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-medium-cascade-savings',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-150€). Tirelire 50€ → reste 100€ à absorber. Cascade savings : draine 100€ depuis le pool 200€ au prorata. Tirelire = 0, pool savings = 100€ restant après.',
    expectedFigures: {
      'Total budgets estimés': 600,
      'Total dépenses réelles': 750,
      'Déficit global': -150,
      'Tirelire avant': 50,
      'Tirelire après': 0,
      'Pool savings avant': 200,
      'Pool savings après': 100,
    },
    cookieHint: true,
  })
})
