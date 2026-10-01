// Scénario "resume-at-manage-bilan-negative-half" — recap rouvert à l'étape Manage Bilan
// avec un bilan négatif PARTIELLEMENT résolu : 50€ de tirelire déjà choisis (sur
// 100€ disponibles), il reste 150€ à renflouer.
//
// Sprint Recap-Manual-Refloat (2026-10-01) : le renflouement est DIFFÉRÉ. Le
// choix « 50€ de tirelire » est enregistré (planned_piggy_refloat) mais la
// tirelire n'est débitée qu'à la fin du récap → elle reste à 100€ ici.
// surplus_savings_data n'est pas posé : l'écran déclenche lui-même le
// versement surplus → économies à l'ouverture (ici 0€, les budgets débordent).

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
  // Tirelire 100€ : les 50€ choisis ne seront débités qu'à la fin du récap.
  await setPiggy({ profile_id: USER_A_ID }, 100)
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
    plannedPiggyRefloat: 50,
  })

  printPostSeedInstructions({
    scenarioKey: 'resume-at-manage-bilan-negative-half',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard rouvre à « Gestion du déficit ». Déficit -200€, 50€ de tirelire déjà choisis → bandeau « Reste à renflouer 150 € ». Section Tirelire : −50 €, disponible 100 €. Section Budgets : économies 100/100 + budgets 200/200.',
    expectedFigures: {
      'Étape attendue': 'manage_bilan',
      'Bilan initial': -200,
      'Tirelire choisie (non débitée)': 50,
      'Reste à renflouer': 150,
      'Tirelire actuelle': 100,
      'Économies disponibles': 200,
    },
    cookieHint: true,
  })
})
