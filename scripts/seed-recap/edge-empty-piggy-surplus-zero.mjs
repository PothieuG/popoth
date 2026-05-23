// Scénario "edge-empty-piggy-surplus-zero" — utilisateur avec salaire mais 0 budget.
// Edge case : que montre le wizard quand il n'y a rien à arbitrer mais que le user
// a un salaire ?

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
} from './_lib.mjs'

runScenario('edge-empty-piggy-surplus-zero', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 2500)
  // 0 budget, 0 expense, 0 income exceptionnel — juste le salaire.

  printPostSeedInstructions({
    scenarioKey: 'edge-empty-piggy-surplus-zero',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard ouvert mais bilan = 0 (pas de budget configuré donc rien à comparer). Étape Summary affiche "Aucun budget configuré ce mois". Devrait pouvoir filer jusqu\'au complete sans arbitrage.',
    expectedFigures: {
      Salaire: 2500,
      'Total budgets': 0,
      'Total dépenses': 0,
      Bilan: 0,
      Tirelire: 0,
    },
    cookieHint: true,
  })
})
