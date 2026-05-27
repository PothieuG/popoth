// Scénario "project-deficit-refloat" — cascade complète bilan négatif AVEC
// renflouement via 4 projets d'épargne actifs (dont 1 quasi-fini à 95% du
// target).
//
// Objectif : exercer les 4 étages de la cascade du BilanNegativeStep dans
// l'ordre (piggy → savings → projets → budgets) avec un déficit calibré
// pour qu'aucune étape ne sature ni ne shortfall — chaque ligne du wizard
// doit afficher un bouton "Utiliser X€" cliquable, puis passer en done.
//
// Math du déficit (en €) :
//   salaire             = 2500
//   estimatedBudgets    = 200 (Courses) + 200+150+100+50 (4 projets) = 700
//   real expenses       = 900 (sur Courses) → budgetDeficit(Courses) = 900-200 = 700
//   ravEstime           = 2500 - 700 = 1800
//   ravEffectif         = 2500 - 700 - 700 = 1100
//   bilan               = ravEffectif - ravEstime = 1100 - 1800 = -700
//
// Cascade -700€ :
//   piggy 100€            →   600 restants
//   savings 50€ (Courses) →   550 restants
//   projets 500€ (max)    →    50 restants  (split proportionnel sur les 4 projets,
//                                            chacun capé à son monthly_allocation)
//   budgets snapshot 50€  →     0 restant   (pool = Courses estimated_amount 200€)
//
// État final attendu : déficit = 0 → "Continuer" actif → écran salary → finalize.
// À la finalize, la RPC `apply_recap_projects_snapshot` (sprint 01 + sprint 10
// wiring) doit créditer chaque projet du delta `monthly_allocation - refund`
// (= 0 ici, refund = monthly entier) puis appliquer le décalage d'échéance
// fractionnaire ou entier.
//
// Les 4 projets seedés (illustrent différents états de progression) :
//   • Japon          : target 7000€, monthly 200€, saved 1200€ (17%), deadline 2027-12-01
//   • Voiture        : target 5000€, monthly 150€, saved  600€ (12%), deadline 2027-06-01
//   • Vacances       : target 5000€, monthly 100€, saved 4750€ (95% — QUASI-FINI), deadline 2026-08-01
//   • Électroménager : target 1500€, monthly  50€, saved  200€ (13%), deadline 2028-06-01
//
// Le projet "Vacances" est volontairement à 95% du target pour exercer l'UX
// "projet bientôt terminé" et vérifier que l'allocation mensuelle peut être
// renoncée sans envoyer le projet au-delà de son target.
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
  await setProfileSalary(USER_A_ID, 2500)
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

  // 5. 4 projets actifs — total allocation mensuelle = 500€.
  // Le tableau permet d'itérer sans dupliquer la boucle d'insert.
  const projects = [
    {
      name: 'Voyage Japon',
      target_amount: 7000,
      monthly_allocation: 200,
      amount_saved: 1200,
      deadline_date: '2027-12-01',
    },
    {
      name: 'Voiture',
      target_amount: 5000,
      monthly_allocation: 150,
      amount_saved: 600,
      deadline_date: '2027-06-01',
    },
    {
      // Quasi-fini (95%) — illustre l'UX projet en fin de course.
      name: 'Vacances',
      target_amount: 5000,
      monthly_allocation: 100,
      amount_saved: 4750,
      deadline_date: '2026-08-01',
    },
    {
      name: 'Électroménager',
      target_amount: 1500,
      monthly_allocation: 50,
      amount_saved: 200,
      deadline_date: '2028-06-01',
    },
  ]

  for (const p of projects) {
    const { error } = await supabase.from('savings_projects').insert({
      profile_id: USER_A_ID,
      pending_delay_fraction: 0,
      ...p,
    })
    if (error) throw new Error(`INSERT savings_projects ${p.name}: ${error.message}`)
  }

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
      'piggy 100€ → savings Courses 50€ → projets 500€ (Japon 200 + Voiture 150 + ' +
      'Vacances 100 + Élec 50, chacun capé à son monthly) → budgets snapshot 50€ ' +
      'sur Courses. Le projet Vacances est à 95% (4750/5000) — vérifier l\'UX ' +
      '"projet quasi-fini". À la finalize : (a) savings_projects.amount_saved ' +
      'reste inchangé (refund = monthly, delta = 0), (b) pending_delay_fraction ou ' +
      'deadline_date shifted +1 mois, (c) monthly_recaps.project_snapshot_data ' +
      'contient les 4 entrées.',
    expectedFigures: {
      Salaire: 2500,
      'Tirelire avant': 100,
      'Solde bancaire': 2000,
      'Budget Courses estimé': 200,
      'Économies Courses (cumulated_savings)': 50,
      'Dépense réelle sur Courses': 900,
      'Déficit budget (Courses)': 700,
      'Allocation mensuelle Japon': 200,
      'Allocation mensuelle Voiture': 150,
      'Allocation mensuelle Vacances (QUASI-FINI 95%)': 100,
      'Allocation mensuelle Électroménager': 50,
      'Total allocations projets': 500,
      'Économies déjà capitalisées (4 projets)': '1200 + 600 + 4750 + 200 = 6750',
      'Total estimatedBudgets (incl. allocations projets)': 700,
      'RAV estimé': 1800,
      'RAV effectif': 1100,
      Bilan: -700,
      'Cascade attendue (piggy → savings → projets → budgets)':
        '100 → 50 → 500 → 50 = 700 (exact cover)',
    },
    cookieHint: true,
  })
})
