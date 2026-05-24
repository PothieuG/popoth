// Scénario User B — cascade FULL : les 3 lignes sont nécessaires.
// Tirelire + économies + snapshot proportionnel sur les budgets.
//
// Setup :
//   - 3 budgets : Courses 300€ (économies 50€), Loisirs 300€ (économies 50€),
//     Transport 200€ (sans économies)
//   - 3 dépenses : Courses 400€ (déficit 100€), Loisirs 500€ (déficit 200€),
//     Transport 400€ (déficit 200€)
//   - Total déficit ~500€
//   - Tirelire 100€ (couvre 100€) → puis savings pool 100€ (couvre 100€) →
//     puis snapshot 300€ sur les budgets restants
//   - Bank balance ~2400
//
// UX attendue :
//   1. Bilan négatif (déficit ~500€)
//   2. Renflouer tirelire 100€ → déficit=400€ ; savings unlock
//   3. Transférer économies 100€ → déficit=300€ ; snapshot unlock
//   4. Équilibrer (snapshot) 300€ proportionnel sur Courses/Loisirs/Transport
//      → déficit=0 ; Continuer (server auto-advance salary_update)

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

runScenario('profile-b-deficit-cascade', async () => {
  await cleanupForB()
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ profile_id: USER_B_ID }, 100)
  await setBank({ profile_id: USER_B_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_B_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 50 },
    { name: 'Loisirs', estimated_amount: 300, cumulated_savings: 50 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_B_ID, budgets, [
    { budget_name: 'Courses', amount: 400, description: 'Gros mois' },
    { budget_name: 'Loisirs', amount: 500, description: 'Sortie chère' },
    { budget_name: 'Transport', amount: 400, description: 'Réparation voiture' },
  ])

  printForB({
    scenarioKey: 'profile-b-deficit-cascade',
    expectedBehavior:
      'Wizard bilan négatif (déficit ~500€). Cascade COMPLÈTE : tirelire 100€ → ' +
      'économies des budgets 100€ → snapshot proportionnel 300€ sur Courses/Loisirs/Transport. ' +
      'Continuer apparaît une fois le déficit comblé.',
    expectedFigures: {
      'Déficit attendu': -500,
      'Tirelire avant': 100,
      'Pool savings avant': 100,
      'Snapshot attendu': 300,
    },
  })
})
