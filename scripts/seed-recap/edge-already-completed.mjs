// Scénario "edge-already-completed" — recap du mois courant déjà complété.
// Données happy-surplus-light + recap row avec completed_at = now().
// UX : /dashboard render directement (pas de redirect vers /monthly-recap).

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

runScenario('edge-already-completed', async () => {
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
    currentStep: 'completed',
    startedByProfileId: USER_A_ID,
    completedAt: new Date().toISOString(),
  })

  printPostSeedInstructions({
    scenarioKey: 'edge-already-completed',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Le recap est déjà completed. /dashboard render directement sans redirect vers le wizard. Cookie "recap-ok-profile-{Y}-{M}" est posé 5 min après le premier hit pour skip le DB call. Si tu navigues /monthly-recap?context=profile → redirect /dashboard (la special route bloque la re-entry).',
    expectedFigures: {
      'Étape attendue': 'completed',
      completed_at: new Date().toISOString(),
    },
    cookieHint: false,
  })
})
