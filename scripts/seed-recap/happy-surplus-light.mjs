// Scénario "happy-surplus-light" — bilan positif léger.
// 3 budgets (total 750€), spent 550€, surplus 200€. Salaire 2500€. Tirelire 100€.
// UX : wizard bilan positif → propose distribution surplus (piggy / savings).

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

runScenario('happy-surplus-light', async () => {
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
    { budget_name: 'Courses', amount: 320, description: 'Carrefour + Lidl' },
    { budget_name: 'Loisirs', amount: 130, description: 'Ciné + concert' },
    { budget_name: 'Transport', amount: 100, description: 'Pass Navigo' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'happy-surplus-light',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Redirect vers /monthly-recap?context=profile → wizard bilan positif. Étape "Manage bilan" propose de placer les 200€ de surplus dans la tirelire OU les ajouter aux économies par budget.',
    expectedFigures: {
      'Total budgets estimés': 750,
      'Total dépenses réelles': 550,
      'Surplus global': 200,
      'Surplus Courses': 80,
      'Surplus Loisirs': 70,
      'Surplus Transport': 50,
      'Tirelire avant': 100,
      Salaire: 2500,
    },
    cookieHint: true,
  })
})
