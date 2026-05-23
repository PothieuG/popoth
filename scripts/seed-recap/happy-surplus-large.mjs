// Scénario "happy-surplus-large" — bilan positif large.
// 5 budgets (total 1200€), spent 400€, surplus 800€. Salaire 3000€.
// UX : wizard bilan positif avec gros surplus à distribuer.

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

runScenario('happy-surplus-large', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 3000)
  await setPiggy({ profile_id: USER_A_ID }, 250)
  await setBank({ profile_id: USER_A_ID }, 2800)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400 },
    { name: 'Loisirs', estimated_amount: 200 },
    { name: 'Transport', estimated_amount: 150 },
    { name: 'Restaurant', estimated_amount: 250 },
    { name: 'Sport', estimated_amount: 200 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 100, description: 'Petit mois' },
    { budget_name: 'Loisirs', amount: 50, description: 'Soirée tranquille' },
    { budget_name: 'Transport', amount: 100, description: 'Pass mensuel' },
    { budget_name: 'Restaurant', amount: 100, description: '2 dîners' },
    { budget_name: 'Sport', amount: 50, description: 'Cotisation club' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'happy-surplus-large',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan positif large (+800€). Étape "Manage bilan" : tu peux verser une bonne partie en tirelire ET/OU augmenter les économies par budget.',
    expectedFigures: {
      'Total budgets estimés': 1200,
      'Total dépenses réelles': 400,
      'Surplus global': 800,
      'Tirelire avant': 250,
      Salaire: 3000,
    },
    cookieHint: true,
  })
})
