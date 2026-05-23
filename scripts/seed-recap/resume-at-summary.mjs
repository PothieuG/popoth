// Scénario "resume-at-summary" — recap déjà claimé mais bloqué à l'étape Summary.
// Données = happy-surplus-light. Recap row au step 'summary'.
// UX : wizard rouvre directement screen 2 (Summary).

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

runScenario('resume-at-summary', async () => {
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
    currentStep: 'summary',
    startedByProfileId: USER_A_ID,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-summary',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard rouvre directement à l\'étape "Summary" (écran 2). Bilan positif +200€ visible. Skip Welcome (déjà passé).',
    expectedFigures: {
      'Étape attendue': 'summary',
      'Bilan affiché': 200,
      'Total budgets': 750,
      'Total dépenses': 550,
    },
    cookieHint: true,
  })
})
