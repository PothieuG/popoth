// Scénario "group-deficit-2-members" — bilan négatif groupe avec cascade complète.
// A + B salaires 2500€ chacun. Déficit groupe 300€, piggy groupe 150€, savings 100€.
// → reste 50€ via snapshot, puis écran salary update à 2 inputs.

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

runScenario('group-deficit-2-members', async () => {
  await ensureGroupMembership()
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ group_id: GROUP_ID }, 150)

  const budgets = await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400, cumulated_savings: 50 },
    { name: 'Sorties groupe', estimated_amount: 300, cumulated_savings: 50 },
    { name: 'Voiture', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertGroupExpenses(
    GROUP_ID,
    budgets,
    [
      { budget_name: 'Courses commune', amount: 600, description: 'Gros mois' },
      { budget_name: 'Sorties groupe', amount: 400, description: 'Anniversaire + soirée' },
      { budget_name: 'Voiture', amount: 200, description: 'Essence + péage' },
    ],
    { createdByUserId: USER_A_ID },
  )

  printPostSeedInstructions({
    scenarioKey: 'group-deficit-2-members',
    context: 'group',
    expectedUrl: '/group-dashboard',
    expectedBehavior:
      'Wizard groupe bilan négatif (-300€). Cascade : piggy groupe 150€ → savings 100€ → snapshot 50€. Puis écran "Salary update" à 2 inputs (A + B) pour rebalancer les contributions le mois prochain.',
    expectedFigures: {
      'Total budgets groupe': 900,
      'Total dépenses groupe': 1200,
      'Déficit global': -300,
      'Tirelire groupe avant': 150,
      'Pool savings avant': 100,
      'Snapshot budget à appliquer': 50,
      'Salaires actuels A/B': '2500/2500',
    },
    cookieHint: true,
  })
})
