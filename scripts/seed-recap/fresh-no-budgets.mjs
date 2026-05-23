// Scénario "fresh-no-budgets" — état totalement vierge.
// 0 budget, 0 expense, 0 income, 0 salary, 0 piggy, 0 bank.
// Vérifie que le wizard gère le cas "rien du tout" (skip rapide).

import {
  cleanupCurrentMonth,
  setProfileSalary,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('fresh-no-budgets', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 0)
  // Piggy + bank déjà remis à 0 par cleanupCurrentMonth.

  printPostSeedInstructions({
    scenarioKey: 'fresh-no-budgets',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      "Redirect vers /monthly-recap?context=profile. Wizard ouvre l'écran Welcome puis Summary avec bilan = 0€ (rien à arbitrer). Devrait pouvoir filer directement jusqu'au Final/complete.",
    expectedFigures: {
      'Total budgets estimés': 0,
      'Total dépenses réelles': 0,
      Bilan: 0,
      Tirelire: 0,
      'Bank balance': 0,
      Salaire: 0,
    },
    cookieHint: true,
  })
})
