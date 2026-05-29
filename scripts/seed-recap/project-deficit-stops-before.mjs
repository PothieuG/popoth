// Scénario "project-deficit-stops-before" — déficit petit (-150€) couvert
// intégralement par la tirelire + les économies, AVANT que la cascade
// n'atteigne les projets. Les 2 projets actifs restent intacts mais
// VISIBLES dans le wizard (état `unneeded` greyé "Pas nécessaire — déficit
// déjà comblé").
//
// Objectif : vérifier que la cascade séquentielle court-circuite proprement
// quand les ressources amont suffisent. Les projets ne doivent pas être
// touchés (`savings_projects.amount_saved` inchangé après finalize) et
// `monthly_recaps.project_snapshot_data` doit être `{}` ou null.
//
// Math du déficit (en €) :
//   salaire             = 2500
//   estimatedBudgets    = 200 (Courses) + 200+150 (2 projets) = 550
//   real expense        = 350 (sur Courses) → budgetDeficit(Courses) = 350-200 = 150
//   ravEstime           = 2500 - 550 = 1950
//   ravEffectif         = 2500 - 550 - 150 = 1800
//   bilan               = 1800 - 1950 = -150
//
// Cascade -150€ :
//   piggy 100€              →   50 restants
//   savings 50€ (Courses)   →    0 restants ✓
//   projets               →  UNNEEDED (greyé, "Pas nécessaire — déficit comblé")
//   snapshot budgets      →  UNNEEDED (idem)
//
// UX attendue : 2 lignes done (piggy + savings) suivies de 2 lignes greyées
// (projets + budgets). Bouton "Continuer" actif. À la finalize, les projets
// reçoivent leur monthly_allocation normale (refund = 0, delta = monthly).

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

runScenario('project-deficit-stops-before', async () => {
  // 1. Wipe mois courant + projets profile A
  await cleanupCurrentMonth({ profile: true, group: false })
  const { error: projectsDeleteError } = await supabase
    .from('savings_projects')
    .delete()
    .eq('profile_id', USER_A_ID)
  if (projectsDeleteError) {
    throw new Error(`DELETE savings_projects profile: ${projectsDeleteError.message}`)
  }

  // 2. Setup financier de base
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 100)
  await setBank({ profile_id: USER_A_ID }, 2000)

  // 3. 1 budget Courses, savings 100€ (assez pour couvrir le reliquat 50€
  // après que la tirelire a absorbé 100€).
  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 200, cumulated_savings: 100 },
  ])

  // 4. 1 dépense réelle 350€ sur Courses → déficit 150€ (modéré).
  await insertProfileExpenses(USER_A_ID, budgets, [
    {
      budget_name: 'Courses',
      amount: 350,
      description: 'Léger dépassement (déficit 150€)',
      applied: true,
    },
  ])

  // 5. 2 projets actifs — ne doivent PAS être touchés par le wizard.
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
  ]

  for (const p of projects) {
    const { error } = await supabase.from('savings_projects').insert({
      profile_id: USER_A_ID,
      pending_delay_fraction: 0,
      ...p,
    })
    if (error) throw new Error(`INSERT savings_projects ${p.name}: ${error.message}`)
  }

  printPostSeedInstructions({
    scenarioKey: 'project-deficit-stops-before',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard à démarrer depuis "Bienvenue". Bilan attendu : -150€. La cascade ' +
      "s'arrête après l'étape 2 (savings) : tirelire 100€ + économies Courses 50€ " +
      "= 150€ → déficit 0. Les lignes 'Projets' (Japon + Voiture visibles avec " +
      "leurs allocations) et 'Équilibrer avec les budgets' apparaissent en " +
      'gris ("Pas nécessaire — déficit déjà comblé"). Bouton "Continuer" actif. ' +
      'À la finalize : (a) savings_projects.amount_saved des 2 projets reste ' +
      'inchangé (1200 et 600), (b) project_snapshot_data est null ou {} dans ' +
      'monthly_recaps, (c) pending_delay_fraction inchangé.',
    expectedFigures: {
      Salaire: 2500,
      'Tirelire avant': 100,
      'Économies Courses': 100,
      'Dépense réelle Courses': 350,
      'Déficit budget': 150,
      'Allocation mensuelle Japon': 200,
      'Allocation mensuelle Voiture': 150,
      'Économies déjà capitalisées Japon': 1200,
      'Économies déjà capitalisées Voiture': 600,
      'Total estimatedBudgets (incl. projets)': 550,
      'RAV estimé': 1950,
      'RAV effectif': 1800,
      Bilan: -150,
      'Cascade attendue': 'piggy 100 → savings 50 → projets UNNEEDED → snapshot UNNEEDED',
    },
    cookieHint: true,
  })
})
