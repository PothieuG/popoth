// Scénario "group-positive-2-members" — bilan positif au niveau du groupe.
// A + B salaires 2500€ chacun. Group avec 4 budgets surplus 450€.

import {
  cleanupCurrentMonth,
  ensureGroupMembership,
  setProfileSalary,
  setPiggy,
  insertGroupBudgets,
  insertGroupExpenses,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
  USER_B_ID,
  GROUP_ID,
} from './_lib.mjs'

runScenario('group-positive-2-members', async () => {
  await ensureGroupMembership()
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ group_id: GROUP_ID }, 200)

  const budgets = await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400 },
    { name: 'Sorties groupe', estimated_amount: 300 },
    { name: 'Voiture', estimated_amount: 200 },
    { name: 'Vacances', estimated_amount: 300 },
  ])

  await insertGroupExpenses(
    GROUP_ID,
    budgets,
    [
      { budget_name: 'Courses commune', amount: 300, description: 'Carrefour familial' },
      { budget_name: 'Sorties groupe', amount: 200, description: 'Restaurant à 2' },
      { budget_name: 'Voiture', amount: 150, description: 'Essence' },
      { budget_name: 'Vacances', amount: 100, description: 'Acompte hôtel' },
    ],
    { createdByUserId: USER_A_ID },
  )

  printPostSeedInstructions({
    scenarioKey: 'group-positive-2-members',
    context: 'group',
    expectedUrl: '/group-dashboard',
    expectedBehavior:
      "Wizard groupe bilan positif (+450€). À l'étape Manage bilan, choix entre verser dans la tirelire groupe OU augmenter les économies par budget. Pas d'écran salary update si bilan déjà résolu.",
    expectedFigures: {
      'Total budgets groupe': 1200,
      'Total dépenses groupe': 750,
      'Surplus global': 450,
      'Tirelire groupe avant': 200,
      'Salaire A': 2500,
      'Salaire B': 2500,
      'Contribution chacun': 600,
    },
    cookieHint: true,
  })
})
