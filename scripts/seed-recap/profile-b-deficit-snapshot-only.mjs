// Scénario User B — déficit que seul l'équilibrage budgets peut absorber.
// Tirelire = 0, économies = 0. La ligne snapshot est active dès l'ouverture,
// les 2 premières lignes sont en `empty` (greyed).
//
// Setup :
//   - 2 budgets : Courses 200€ (sans économies), Loisirs 100€ (sans économies)
//   - 1 dépense : Courses 300€ (déficit 100€)
//   - Tirelire 0€, bank ~2400
//
// UX attendue :
//   1. Bilan négatif (déficit ~100€) ; piggy empty, savings empty, snapshot active
//   2. Clic "Équilibrer" → snapshot proportionnel 100€ (Courses ~67€, Loisirs ~33€)
//   3. Déficit=0 ; "Continuer" apparaît (server a déjà auto-advance salary_update,
//      le bouton swallow gracieusement l'erreur invalid_step)

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

runScenario('profile-b-deficit-snapshot-only', async () => {
  await cleanupForB()
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ profile_id: USER_B_ID }, 0)
  await setBank({ profile_id: USER_B_ID }, 2400)

  const budgets = await insertProfileBudgets(USER_B_ID, [
    { name: 'Courses', estimated_amount: 200 },
    { name: 'Loisirs', estimated_amount: 100 },
  ])

  await insertProfileExpenses(USER_B_ID, budgets, [
    { budget_name: 'Courses', amount: 300, description: 'Mois compliqué' },
  ])

  printForB({
    scenarioKey: 'profile-b-deficit-snapshot-only',
    expectedBehavior:
      "Wizard bilan négatif (déficit ~100€). Tirelire 0€ + pas d'économies → ligne " +
      'snapshot directement active dès l\'ouverture. Clic "Équilibrer" → snapshot ' +
      'proportionnel 100€ sur Courses/Loisirs. Continuer apparaît.',
    expectedFigures: {
      'Déficit attendu': -100,
      'Tirelire avant': 0,
      'Pool savings avant': 0,
      'Snapshot attendu': 100,
    },
  })
})
