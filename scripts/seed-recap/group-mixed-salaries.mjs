// Scénario "group-mixed-salaries" — salaires différents pour tester le recalc
// proportionnel des contributions.
// A=3500€ (70%), B=1500€ (30%). Total contributions = budget groupe.
// Bilan groupe négatif 200€ pour avoir l'écran salary update à 2 inputs avec montants différents.

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

runScenario('group-mixed-salaries', async () => {
  await ensureGroupMembership()
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 3500)
  await setProfileSalary(USER_B_ID, 1500)
  await setPiggy({ group_id: GROUP_ID }, 0)

  const budgets = await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400, cumulated_savings: 0 },
    { name: 'Sorties groupe', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Voiture', estimated_amount: 100, cumulated_savings: 0 },
  ])

  await insertGroupExpenses(
    GROUP_ID,
    budgets,
    [
      { budget_name: 'Courses commune', amount: 500, description: '+100€ sur Courses' },
      { budget_name: 'Sorties groupe', amount: 350, description: '+50€ sur Sorties' },
      { budget_name: 'Voiture', amount: 150, description: '+50€ sur Voiture' },
    ],
    { createdByUserId: USER_A_ID },
  )

  printPostSeedInstructions({
    scenarioKey: 'group-mixed-salaries',
    context: 'group',
    expectedUrl: '/group-dashboard',
    expectedBehavior:
      "Wizard groupe bilan négatif (-200€) avec contributions proportionnelles (A=70%, B=30%). Piggy + savings à 0 → tout passe par snapshot. Puis écran Salary update à 2 inputs : A=3500€, B=1500€ pré-remplis. Modifier l'un déclenche le recalc proportionnel des contributions.",
    expectedFigures: {
      'Salaire A': 3500,
      'Salaire B': 1500,
      'Contribution A attendue (70%)': '~560€',
      'Contribution B attendue (30%)': '~240€',
      'Total budgets groupe': 800,
      'Total dépenses groupe': 1000,
      'Déficit global': -200,
      'Snapshot budget à appliquer': 200,
    },
    cookieHint: true,
  })
})
