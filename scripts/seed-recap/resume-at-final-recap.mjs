// Scénario "resume-at-final-recap" — recap profile rouvert à l'écran 5 Final Recap.
// Bilan entièrement résolu : piggy 100€ débitée + savings 100€ drainées + snapshot 100€.
// Snapshot peuplé. Step='final_recap'. Le user peut directement cliquer "Terminer".

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

runScenario('resume-at-final-recap', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  // Tirelire initialement 100€ → 100€ refloated → 0
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2200)

  // Économies initiales 50/50/0 → 50/50/0 drainées proportionnellement → 0/0/0
  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 0 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 0 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 300, description: 'Débordement' },
    { budget_name: 'Loisirs', amount: 300, description: 'Débordement' },
    { budget_name: 'Transport', amount: 300, description: 'Débordement' },
  ])

  // Snapshot 100€ proportionnel sur 200/200/200 (égalitaire) → 33.33/33.33/33.34
  const coursesId = budgets.get('Courses')
  const loisirsId = budgets.get('Loisirs')
  const transportId = budgets.get('Transport')
  const snapshotData = {
    [coursesId]: 33.33,
    [loisirsId]: 33.33,
    [transportId]: 33.34,
  }

  await seedRecapRow({
    context: 'profile',
    contextId: USER_A_ID,
    currentStep: 'final_recap',
    startedByProfileId: USER_A_ID,
    refloatedFromPiggy: 100,
    refloatedFromSavings: 100,
    budgetSnapshotData: snapshotData,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-final-recap',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard rouvre directement à l\'écran 5 Final Recap. Récap visuel : piggy a été débitée 100€, savings 100€ drainées, snapshot 100€ prêt à appliquer. Bouton "Terminer" déclenche le complete + transfert dashboard.',
    expectedFigures: {
      'Étape attendue': 'final_recap',
      'Déficit initial': -300,
      Refloated_from_piggy: 100,
      Refloated_from_savings: 100,
      'Snapshot total': 100,
      'Tirelire actuelle': 0,
    },
    cookieHint: true,
  })
})
