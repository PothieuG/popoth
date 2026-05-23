// Scénario "resume-at-salary-update" — recap groupe rouvert à l'étape Salary Update.
// Le bilan a été entièrement résolu via snapshot (déficit 200€ → snapshot 200€).
// État cohérent : piggy/savings inchangés, snapshot peuplé, step='salary_update'.

import {
  cleanupCurrentMonth,
  ensureGroupMembership,
  setProfileSalary,
  setPiggy,
  insertGroupBudgets,
  insertGroupExpenses,
  seedRecapRow,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
  USER_B_ID,
  GROUP_ID,
} from './_lib.mjs'

runScenario('resume-at-salary-update', async () => {
  await ensureGroupMembership()
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ group_id: GROUP_ID }, 0)

  const budgets = await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400, cumulated_savings: 0 },
    { name: 'Sorties groupe', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Voiture', estimated_amount: 300, cumulated_savings: 0 },
  ])

  await insertGroupExpenses(
    GROUP_ID,
    budgets,
    [
      { budget_name: 'Courses commune', amount: 500 },
      { budget_name: 'Sorties groupe', amount: 350 },
      { budget_name: 'Voiture', amount: 350 },
    ],
    { createdByUserId: USER_A_ID },
  )

  // Snapshot proportionnel sur estimated_amount (400/300/300, déficit 200€ total)
  // → Courses 80, Sorties 60, Voiture 60
  const coursesId = budgets.get('Courses commune')
  const sortiesId = budgets.get('Sorties groupe')
  const voitureId = budgets.get('Voiture')
  const snapshotData = {
    [coursesId]: 80,
    [sortiesId]: 60,
    [voitureId]: 60,
  }

  await seedRecapRow({
    context: 'group',
    contextId: GROUP_ID,
    currentStep: 'salary_update',
    startedByProfileId: USER_A_ID,
    refloatedFromPiggy: 0,
    refloatedFromSavings: 0,
    budgetSnapshotData: snapshotData,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-salary-update',
    context: 'group',
    expectedUrl: '/group-dashboard',
    expectedBehavior:
      "Wizard groupe rouvre directement à l'étape Salary Update (écran 4). 2 inputs (A=2500€, B=2500€) pré-remplis. Modifier déclenche le recalc des contributions.",
    expectedFigures: {
      'Étape attendue': 'salary_update',
      'Snapshot déjà sauvegardé': 200,
      'Salaires actuels A/B': '2500/2500',
      'Déficit initial': -200,
    },
    cookieHint: true,
  })
})
