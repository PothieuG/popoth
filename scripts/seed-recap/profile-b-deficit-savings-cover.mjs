// Scénario User B — déficit nécessitant tirelire + économies (pas de
// snapshot budgets). La cascade séquentielle débloque la ligne économies
// après que la tirelire ait été utilisée, puis le bouton Continuer
// apparaît une fois le déficit comblé.
//
// Setup :
//   - 2 budgets : Courses 200€ (économies 60€), Loisirs 100€ (économies 40€)
//   - 2 dépenses : Courses 320€ (déficit 120€), Loisirs 100€
//   - Tirelire 20€ (couvre 20€) → puis savings pool 100€ (couvre 100€)
//   - Bank balance ~2380
//
// UX attendue :
//   1. Bilan négatif (déficit ~120€) ; ligne piggy active, savings/snapshot locked
//   2. Clic "Renflouer 20€" → piggy=0, déficit=100€, savings unlock
//   3. Clic "Transférer les économies" → savings drain 100€, déficit=0
//   4. Bouton "Continuer" en bas → /advance-step manage_bilan → salary_update

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

runScenario('profile-b-deficit-savings-cover', async () => {
  await cleanupForB()
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ profile_id: USER_B_ID }, 20)
  await setBank({ profile_id: USER_B_ID }, 2380)

  const budgets = await insertProfileBudgets(USER_B_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 60 },
    { name: 'Loisirs', estimated_amount: 100, cumulated_savings: 40 },
  ])

  await insertProfileExpenses(USER_B_ID, budgets, [
    { budget_name: 'Courses', amount: 320, description: 'Mois cher' },
    { budget_name: 'Loisirs', amount: 100, description: 'Pile budget' },
  ])

  printForB({
    scenarioKey: 'profile-b-deficit-savings-cover',
    expectedBehavior:
      'Wizard bilan négatif (déficit ~120€). Cascade : tirelire (20€) → économies des ' +
      'budgets (100€ proportionnel). Pas de snapshot nécessaire. Continuer apparaît une ' +
      'fois le déficit comblé.',
    expectedFigures: {
      'Déficit attendu': -120,
      'Tirelire avant': 20,
      'Pool savings avant': 100,
      'Snapshot attendu': 0,
    },
  })
})
