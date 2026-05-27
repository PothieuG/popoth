// Scénario "project-deficit-catastrophe" — gros déficit (-4000€) avec
// projets actifs DRAINÉS À 100% + snapshot budgets overshoot massif. Cas
// pathologique : la cascade complète ne suffit pas, le snapshot doit
// absorber le reliquat en surchargeant chaque budget à ~470%.
//
// Math du déficit (en €) :
//   salaire             = 2500
//   real budgets        = 300 (Courses) + 200 (Loisirs) + 200 (Transport) = 700
//   projets monthly     = 200 (Japon) + 150 (Voiture) = 350
//   estimatedBudgets    = 700 + 350 = 1050
//   real expenses       = 1500 + 1500 + 1700 = 4700
//   budgetDeficit total = 1200 + 1300 + 1500 = 4000
//   ravEstime           = 2500 - 1050 = 1450
//   ravEffectif         = 2500 - 1050 - 4000 = -2550
//   bilan               = -2550 - 1450 = -4000
//
// Cascade -4000€ :
//   piggy 150€              →   3850 restants
//   savings 200€ (3 budgets)→   3650 restants  (100 Courses + 50 Loisirs + 50 Transport)
//   projets 350€ (max)      →   3300 restants  (Japon 200 + Voiture 150, full drain)
//   snapshot 3300€ sur pool 700€  →  0 restant  (overshoot massif)
//     Distribution proportionnelle :
//       Courses    : 300/700 × 3300 = 1414€ → 1414/300 = 471% ⚠
//       Loisirs    : 200/700 × 3300 =  943€ →  943/200 = 472% ⚠
//       Transport  : 200/700 × 3300 =  943€ →  943/200 = 472% ⚠
//
// UX attendue : 4 lignes done + 3 OvershootBadge "⚠ ~471%" sur les budgets
// dans le snapshot. Banner self-healing affichée. Bouton "Continuer" actif.
// À la finalize : (a) savings_projects.amount_saved INCHANGÉ pour les 2
// projets (refund = monthly entier → delta = 0), (b) deadline_date shifted
// +1 mois, (c) project_snapshot_data contient les 2 projets.

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

runScenario('project-deficit-catastrophe', async () => {
  // 1. Wipe mois courant + projets profile A
  await cleanupCurrentMonth({ profile: true, group: false })
  const { error: projectsDeleteError } = await supabase
    .from('savings_projects')
    .delete()
    .eq('profile_id', USER_A_ID)
  if (projectsDeleteError) {
    throw new Error(`DELETE savings_projects profile: ${projectsDeleteError.message}`)
  }

  // 2. Setup financier — tirelire et solde "réalistes" (pas vides) pour que
  // la cascade utilise vraiment ses 4 étages.
  await setProfileSalary(USER_A_ID, 2500)
  await setPiggy({ profile_id: USER_A_ID }, 150)
  await setBank({ profile_id: USER_A_ID }, 1500)

  // 3. 3 budgets avec savings cumulées (total 200€ disponibles au step 2).
  const budgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 300, cumulated_savings: 100 },
    { name: 'Loisirs', estimated_amount: 200, cumulated_savings: 50 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 50 },
  ])

  // 4. Dépenses massives — chaque budget overspent largement.
  await insertProfileExpenses(USER_A_ID, budgets, [
    { budget_name: 'Courses', amount: 1500, description: 'Catastrophe Courses' },
    { budget_name: 'Loisirs', amount: 1500, description: 'Catastrophe Loisirs' },
    { budget_name: 'Transport', amount: 1700, description: 'Catastrophe Transport' },
  ])

  // 5. 2 projets actifs — vont être drainés à 100% par le wizard.
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
    scenarioKey: 'project-deficit-catastrophe',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Wizard à démarrer depuis "Bienvenue". Bilan attendu : -4000€ (catastrophe ' +
      'avec projets actifs). La cascade utilise SES 4 ÉTAGES en plein : tirelire ' +
      '150€ → savings 200€ → projets 350€ (drainés à 100%) → snapshot 3300€ qui ' +
      'overshoot chaque budget à ~471%. UX à vérifier : (a) chaque projet doit ' +
      'afficher "Utiliser 200€" / "Utiliser 150€" et passer en done, (b) le ' +
      'snapshot final doit afficher 3 OvershootBadge "⚠ ~471%" + la banner ' +
      'explicative self-healing, (c) le bouton "Continuer" doit apparaître malgré ' +
      "le shortfall (le wizard ne se bloque pas — c'est volontaire dans la spec).",
    expectedFigures: {
      Salaire: 2500,
      'Tirelire avant': 150,
      'Solde bancaire': 1500,
      'Savings cumulées (3 budgets)': '100 + 50 + 50 = 200',
      'Allocations projets': '200 (Japon) + 150 (Voiture) = 350',
      'Budgets réels estimés': '300 + 200 + 200 = 700',
      'Dépenses réelles': '1500 + 1500 + 1700 = 4700',
      'Déficit budget total': 4000,
      'Total estimatedBudgets (incl. projets)': 1050,
      'RAV estimé': 1450,
      'RAV effectif': -2550,
      Bilan: -4000,
      'Cascade exacte':
        '150 + 200 + 350 + 3300 = 4000 ✓',
      'Overshoot snapshot par budget':
        'Courses 1414/300 (471%), Loisirs 943/200 (472%), Transport 943/200 (472%)',
    },
    cookieHint: true,
  })
})
