// Scénario "deficit-cascade-extreme" — catastrophe budgétaire qui FORCE le
// snapshot à overshoot largement chaque budget. Déficit 3500€ sur un pool
// total de 1500€ (5 budgets x 300€) → overshoot ~233% par budget. La
// tirelire, les économies et les projets sont vides — toute la cascade
// shortfall sur le snapshot.
//
// Math :
//   salaire             = 2500
//   estimatedBudgets    = 5 × 300 = 1500
//   real expenses       = 5 × 1000 = 5000 (chaque budget overspent +700)
//   budgetDeficit total = 5 × 700 = 3500
//   ravEstime           = 2500 - 1500 = 1000
//   ravEffectif         = 2500 - 1500 - 3500 = -2500
//   bilan               = -2500 - 1000 = -3500
//
// Cascade -3500€ :
//   piggy 0          → 3500 restants
//   savings 0        → 3500 restants
//   projets 0        → 3500 restants
//   snapshot budgets : pool 1500€ vs target 3500€ → overshoot ~233%/budget
//     Distribution uniforme (5 budgets égaux) : chacun 700€ snapshot.
//     Consumed = carryover(0) + 700 = 700 / 300 estimated = 233% ⚠
//
// UX attendue : 5 OvershootBadge "⚠ 233%" par budget dans le RefloatBudget
// SnapshotLine. Banner "Certains budgets démarreront le mois prochain au-
// dessus de 100%" affichée. Le déficit comblé après "Équilibrer" → bouton
// "Continuer" → écran salary.

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

runScenario('deficit-cascade-extreme', async () => {
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setBank({ profile_id: USER_A_ID }, 500)

  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Loisirs', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Transport', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Restaurant', estimated_amount: 300, cumulated_savings: 0 },
    { name: 'Sport', estimated_amount: 300, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 1000, description: 'Catastrophe' },
    { budget_name: 'Loisirs', amount: 1000, description: 'Catastrophe' },
    { budget_name: 'Transport', amount: 1000, description: 'Catastrophe' },
    { budget_name: 'Restaurant', amount: 1000, description: 'Catastrophe' },
    { budget_name: 'Sport', amount: 1000, description: 'Catastrophe' },
  ])

  printPostSeedInstructions({
    scenarioKey: 'deficit-cascade-extreme',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard bilan négatif (-3500€) — catastrophe budgétaire. Aucune ressource ' +
      "amont (tirelire 0, savings 0, projets 0) → tout doit passer par l'équilibrage " +
      'budget. Le pool total des 5 budgets (1500€) est largement insuffisant face au ' +
      'déficit (3500€). Le snapshot va overshoot chaque budget à ~233% : chaque ' +
      'budget affichera un OvershootBadge "⚠ 233%" + une banner explicative sur la ' +
      "self-healing les mois suivants. C'est le pire cas UX possible — vérifier que " +
      "le wizard ne se bloque pas et que le bouton 'Continuer' apparaît bien après " +
      "'Équilibrer'.",
    expectedFigures: {
      Salaire: 2500,
      'Total budgets estimés': 1500,
      'Total dépenses réelles': 5000,
      'Déficit budget total': 3500,
      'Pool snapshot disponible': 1500,
      'Overshoot par budget': '700€ vs 300€ estimé = 233%',
      'OvershootBadge attendu': '⚠ 233% × 5 budgets',
      'Snapshot budget à appliquer': 3500,
      Bilan: -3500,
    },
    cookieHint: true,
  })
})
