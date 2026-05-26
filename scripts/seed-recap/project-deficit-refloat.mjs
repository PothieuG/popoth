// Scénario "project-deficit-refloat" — cascade complète bilan négatif AVEC
// renflouement via 2 projets d'épargne actifs.
//
// Objectif : exercer les 4 étages de la cascade du BilanNegativeStep dans
// l'ordre (piggy → savings → projets → budgets) avec un déficit calibré
// pour qu'aucune étape ne sature ni ne shortfall — chaque ligne du wizard
// doit afficher un bouton "Utiliser X€" cliquable, puis passer en done.
//
// Math du déficit (en €) :
//   salaire             = 1500
//   estimatedBudgets    = 200 (Courses) + 200 (Japon allocation) + 150 (Voiture allocation) = 550
//   real expenses       = 900 (sur Courses) → budgetDeficit(Courses) = 900-200 = 700
//   ravEstime           = 1500 - 550 = 950
//   ravEffectif         = 1500 - 550 - 700 = 250
//   bilan               = ravEffectif - ravEstime = 250 - 950 = -700
//
// Cascade -700€ :
//   piggy 100€            →   600 restants
//   savings 50€ (Courses) →   550 restants
//   projets 350€ (max)    →   200 restants  (split proportionnel 200/350 Japon + 150/350 Voiture)
//   budgets snapshot 200€ →     0 restant   (pool = Courses estimated_amount)
//
// État final attendu : déficit = 0 → "Continuer" actif → écran salary → finalize.
// À la finalize, la RPC `apply_recap_projects_snapshot` (sprint 01 + sprint 10
// wiring) doit créditer chaque projet du delta `monthly_allocation - refund`
// puis appliquer le décalage d'échéance fractionnaire ou entier.
//
// Pour les 2 projets seedés :
//   • Japon  : target 7000€, monthly 200€, saved 1200€, deadline 2027-12-01
//   • Voiture : target 5000€, monthly 150€, saved  600€, deadline 2027-06-01
//
// Usage :
//   node scripts/seed-recap/project-deficit-refloat.mjs

import {
  cleanupCurrentMonth,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  printPostSeedInstructions,
  runScenario,
  supabase,
  USER_A_ID,
} from './_lib.mjs'

runScenario('project-deficit-refloat', async () => {
  // 1. Wipe mois courant — `cleanupCurrentMonth` ne touche pas `savings_projects`
  // (la table n'existait pas quand `_lib.mjs` a été écrit). Cleanup manuel
  // local pour garantir l'idempotency du script.
  await cleanupCurrentMonth({ profile: true, group: false })
  const { error: projectsDeleteError } = await supabase
    .from('savings_projects')
    .delete()
    .eq('profile_id', USER_A_ID)
  if (projectsDeleteError) {
    throw new Error(`DELETE savings_projects profile: ${projectsDeleteError.message}`)
  }

  // 2. Setup financier de base — salaire + tirelire + solde bancaire.
  await setProfileSalary(USER_A_ID, 1500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2000)

  // 3. 1 budget Courses estimé 200€/mois avec 50€ d'économies cumulées
  // (qui seront drainées au step 2 de la cascade savings).
  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 50 },
  ])

  // 4. 1 dépense réelle 900€ sur Courses → déficit budget 700€.
  await insertProfileExpenses(USER_A_ID, budgets, [
    {
      budget_name: 'Courses',
      amount: 900,
      description: 'Gros mois (déficit 700€)',
      applied: true,
    },
  ])

  // 5. 2 projets actifs — total allocation mensuelle = 350€ (consomme 350€
  // de la marge théorique sur l'estim budgets via le wiring sprint 03).
  const { error: japonError } = await supabase.from('savings_projects').insert({
    profile_id: USER_A_ID,
    name: 'Voyage Japon',
    target_amount: 7000,
    monthly_allocation: 200,
    amount_saved: 1200,
    deadline_date: '2027-12-01',
    pending_delay_fraction: 0,
  })
  if (japonError) throw new Error(`INSERT savings_projects Japon: ${japonError.message}`)

  const { error: voitureError } = await supabase.from('savings_projects').insert({
    profile_id: USER_A_ID,
    name: 'Voiture',
    target_amount: 5000,
    monthly_allocation: 150,
    amount_saved: 600,
    deadline_date: '2027-06-01',
    pending_delay_fraction: 0,
  })
  if (voitureError) throw new Error(`INSERT savings_projects Voiture: ${voitureError.message}`)

  // 6. Pas de seedRecapRow — on laisse l'utilisateur démarrer le wizard
  // depuis l'écran "Bienvenue" pour exercer le full flow (start → complete
  // → summary → manage_bilan négatif → cascade 4 étages → salary → final).

  printPostSeedInstructions({
    scenarioKey: 'project-deficit-refloat',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard à démarrer depuis l\'écran "Bienvenue". Bilan attendu : -700€. ' +
      "La cascade du BilanNegativeStep doit dérouler les 4 étages dans l'ordre : " +
      'piggy 100€ → savings Courses 50€ → projets 350€ (Japon 200€ + Voiture 150€ ' +
      'split proportionnel sur le déficit restant) → budgets snapshot 200€ pool ' +
      'Courses. À la finalize, vérifier en SQL : (a) savings_projects.amount_saved ' +
      'incrémenté de (monthly - refund) pour chaque projet, (b) pending_delay_fraction ' +
      'mis à jour ou deadline_date shifted, (c) monthly_recaps.project_snapshot_data ' +
      'contient les bonnes valeurs.',
    expectedFigures: {
      Salaire: 1500,
      'Tirelire avant': 100,
      'Solde bancaire': 2000,
      'Budget Courses estimé': 200,
      'Économies Courses (cumulated_savings)': 50,
      'Dépense réelle sur Courses': 900,
      'Déficit budget (Courses)': 700,
      'Allocation mensuelle Japon': 200,
      'Allocation mensuelle Voiture': 150,
      'Économies déjà capitalisées Japon': 1200,
      'Économies déjà capitalisées Voiture': 600,
      'Total estimatedBudgets (incl. allocations projets)': 550,
      'RAV estimé': 950,
      'RAV effectif': 250,
      Bilan: -700,
      'Cascade attendue (piggy → savings → projets → budgets)':
        '100 → 50 → 350 → 200 = 700 (exact cover)',
    },
    cookieHint: true,
  })
})
