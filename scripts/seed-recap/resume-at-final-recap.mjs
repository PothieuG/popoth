// Scénario "resume-at-final-recap" — recap profile rouvert à l'écran 5 Final Recap.
// Bilan entièrement résolu : plan = tirelire 100€ + économies 100€ + budgets 100€.
// Step='final_recap'. Le user peut directement cliquer "Terminer".
//
// Sprint Recap-Manual-Refloat (2026-10-01) : le plan est DIFFÉRÉ — tirelire et
// économies ne sont débitées qu'au clic sur "Terminer" (apply_recap_refloat_plan).
// Le seed les laisse donc pleines : c'est le finalize qui doit les vider.

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
  // Tirelire 100€ : débitée de 100€ au finalize → 0
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2200)

  // Économies 50/50/0 : débitées de 50/50 au finalize → 0/0/0
  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 50 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 50 },
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
    plannedPiggyRefloat: 100,
    plannedSavingsRefloat: { [coursesId]: 50, [loisirsId]: 50 },
    budgetSnapshotData: snapshotData,
    surplusSavingsData: {},
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-final-recap',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard rouvre directement à l\'écran 5 Final Recap. Détail : tirelire 100€, économies 100€, budgets du mois prochain 100€. Rien n\'est encore débité : "Terminer" applique le plan (tirelire 100 → 0, économies 50/50 → 0/0) puis le reste du finalize.',
    expectedFigures: {
      'Étape attendue': 'final_recap',
      'Déficit initial': -300,
      'Tirelire (plan)': 100,
      'Économies (plan)': 100,
      'Budgets du mois prochain (plan)': 100,
      'Tirelire avant Terminer': 100,
      'Tirelire après Terminer': 0,
    },
    cookieHint: true,
  })
})
