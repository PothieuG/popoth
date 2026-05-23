// Scénario "resume-at-manage-bilan-negative-half" — recap rouvert à l'étape Manage Bilan
// avec un bilan négatif PARTIELLEMENT résolu : la tirelire a déjà été débitée de 50€
// (sur 100€ initialement), mais il reste 150€ à absorber.
//
// IMPORTANT : la piggy_bank a été DÉJÀ débitée à 50€ (l'état est cohérent —
// pas juste "on dit qu'on a refloated 50€ mais la piggy est toujours à 100").

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

runScenario('resume-at-manage-bilan-negative-half', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  // Tirelire initialement 100€ → 50€ refloated → piggy actuelle 50€.
  await setPiggy({ profile_id: USER_A_ID }, 50)
  await setBank({ profile_id: USER_A_ID }, 2450)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 100 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 100 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 300, description: 'Débordement' },
    { budget_name: 'Loisirs', amount: 300, description: 'Débordement' },
  ])

  await seedRecapRow({
    context: 'profile',
    contextId: USER_A_ID,
    currentStep: 'manage_bilan',
    startedByProfileId: USER_A_ID,
    refloatedFromPiggy: 50,
    refloatedFromSavings: 0,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-manage-bilan-negative-half',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard rouvre à Manage Bilan 3B (négatif). Déficit initial -200€, déjà absorbé 50€ via piggy → reste -150€ à éponger via savings (pool 200€ disponible) ou snapshot.',
    expectedFigures: {
      'Étape attendue': 'manage_bilan',
      'Variante UI': '3B (négatif)',
      'Bilan initial': -200,
      'Refloated_from_piggy déjà fait': 50,
      'Reste à absorber': -150,
      'Tirelire actuelle': 50,
      'Pool savings disponible': 200,
    },
    cookieHint: true,
  })
})
