// Scénario "surplus-with-existing-savings" — bilan positif mais avec économies déjà
// accumulées sur certains budgets (cumulated_savings préexistantes).
// Vérifie que la transformation surplus → économies est ADDITIVE (n'écrase pas).

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('surplus-with-existing-savings', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400, cumulated_savings: 50 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 100 },
    { name: 'Transport', estimated_amount: 150, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 320, description: 'Avec économies existantes' },
    { budget_name: 'Loisirs', amount: 130, description: 'Avec économies existantes' },
    { budget_name: 'Transport', amount: 110, description: "Pas d'économies existantes" },
  ])

  printPostSeedInstructions({
    scenarioKey: 'surplus-with-existing-savings',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan positif (+190€). À l\'étape Manage bilan, si tu choisis "ajouter aux économies", les surplus s\'AJOUTENT aux cumulated_savings existantes (Courses passe de 50€ à 130€, Loisirs de 100€ à 170€, Transport de 0 à 40€).',
    expectedFigures: {
      'Total budgets estimés': 750,
      'Total dépenses réelles': 560,
      'Surplus global': 190,
      'Économies préexistantes Courses': 50,
      'Économies préexistantes Loisirs': 100,
      'Économies préexistantes Transport': 0,
    },
    cookieHint: true,
  })
})
