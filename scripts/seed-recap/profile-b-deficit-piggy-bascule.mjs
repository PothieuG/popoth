// Scénario User B — déficit que la tirelire couvre AVEC du résidu.
// Bascule positive : la sub-UI BilanPositiveStep est rendue dynamiquement
// pour proposer de transférer les surplus restants vers la tirelire.
//
// Setup :
//   - 2 budgets : Courses 200€, Loisirs 100€
//   - 2 dépenses : Courses 250€ (déficit 50€), Loisirs 100€ (pile dans le budget)
//   - Tirelire 200€ → couvre les 50€ de déficit + 150€ residual
//   - Bank balance assez haut pour ne pas créer de déficit RAV additionnel
//
// UX attendue : à l'ouverture du wizard, l'utilisateur clique sur
// "Renflouer 50€" depuis la tirelire ; le déficit est comblé ; UI bascule
// sur BilanPositiveStep avec les 150€ residual dans la tirelire (et
// éventuellement des surplus budgets à transférer).

import {
  USER_B_ID,
  cleanupForB,
  insertProfileBudgets,
  insertProfileExpenses,
  printForB,
  runScenario,
  setBank,
  setPiggy,
  setProfileSalary,
} from './_profile-b-lib.mjs'

runScenario('profile-b-deficit-piggy-bascule', async () => {
  await cleanupForB()
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ profile_id: USER_B_ID }, 200)
  await setBank({ profile_id: USER_B_ID }, 2450)

  const budgets = await insertProfileBudgets(USER_B_ID, [
    { name: 'Courses', estimated_amount: 200 },
    { name: 'Loisirs', estimated_amount: 100 },
  ])

  await insertProfileExpenses(USER_B_ID, budgets, [
    { budget_name: 'Courses', amount: 250, description: 'Léger dépassement' },
    { budget_name: 'Loisirs', amount: 100, description: 'Pile budget' },
  ])

  printForB({
    scenarioKey: 'profile-b-deficit-piggy-bascule',
    expectedBehavior:
      'Wizard bilan négatif (déficit ~50€). Clique "Renflouer 50€" depuis la tirelire → ' +
      'déficit comblé + 150€ restent dans la tirelire → UI bascule sur BilanPositiveStep ' +
      "(flow positif) pour proposer d'enrichir encore la tirelire avec les surplus de budget.",
    expectedFigures: {
      'Déficit attendu': -50,
      'Tirelire avant': 200,
      'Tirelire après refloat': 150,
    },
  })
})
