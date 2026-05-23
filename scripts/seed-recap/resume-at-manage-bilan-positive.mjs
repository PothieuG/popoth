// Scénario "resume-at-manage-bilan-positive" — recap rouvert à l'étape Manage Bilan
// avec un bilan positif (screen 3A — distribution surplus).

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  seedRecapRow,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('resume-at-manage-bilan-positive', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400 },
    { name: 'Loisirs', estimated_amount: 200 },
    { name: 'Transport', estimated_amount: 150 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 320 },
    { budget_name: 'Loisirs', amount: 130 },
    { budget_name: 'Transport', amount: 100 },
  ])

  await seedRecapRow({
    context: 'profile',
    contextId: USER_A_ID,
    currentStep: 'manage_bilan',
    startedByProfileId: USER_A_ID,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-manage-bilan-positive',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      "Wizard rouvre directement à l'étape Manage Bilan, écran 3A (positif). 200€ de surplus à distribuer (tirelire ou économies).",
    expectedFigures: {
      'Étape attendue': 'manage_bilan',
      'Variante UI': '3A (positif)',
      'Surplus à distribuer': 200,
    },
    cookieHint: true,
  })
})
