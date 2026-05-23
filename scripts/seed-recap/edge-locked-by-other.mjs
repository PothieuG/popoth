// Scénario "edge-locked-by-other" — recap groupe claimé par User B.
// User A se connecte → /monthly-recap?context=group → écran "Verrouillé par B".
// Le lock empêche A de faire QUOI QUE CE SOIT tant que B n'a pas finalisé.

import {
  cleanupCurrentMonth,
  ensureGroupMembership,
  setProfileSalary,
  setPiggy,
  insertGroupBudgets,
  insertGroupExpenses,
  seedRecapRow,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
  USER_B_ID,
  USER_B_EMAIL,
  GROUP_ID,
} from './_lib.mjs'

runScenario('edge-locked-by-other', async () => {
  await ensureGroupMembership()
  await cleanupCurrentMonth()
  await setProfileSalary(USER_A_ID, 2500)
  await setProfileSalary(USER_B_ID, 2500)
  await setPiggy({ group_id: GROUP_ID }, 100)

  const budgets = await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400 },
    { name: 'Sorties groupe', estimated_amount: 300 },
  ])

  await insertGroupExpenses(
    GROUP_ID,
    budgets,
    [
      { budget_name: 'Courses commune', amount: 300 },
      { budget_name: 'Sorties groupe', amount: 200 },
    ],
    { createdByUserId: USER_A_ID },
  )

  // Recap claimé par B (pas par A). A est verrouillé.
  await seedRecapRow({
    context: 'group',
    contextId: GROUP_ID,
    currentStep: 'summary',
    startedByProfileId: USER_B_ID,
  })

  printPostSeedInstructions({
    scenarioKey: 'edge-locked-by-other',
    context: 'group',
    expectedUrl: '/monthly-recap?context=group',
    expectedBehavior: `User A navigue /group-dashboard → proxy redirect /monthly-recap?context=group (le recap n'est pas completed donc gating actif). À l'arrivée, la page détecte status='locked_by_other' (started_by_profile_id=${USER_B_ID} ≠ userId courant=A). Affiche l'écran "Recap verrouillé par ${USER_B_EMAIL}" sans permettre d'action. Pour débloquer : se connecter en tant que B et finaliser, OU lancer le script _reset.mjs.`,
    expectedFigures: {
      'Started by': USER_B_EMAIL,
      'User A peut accéder à /group-dashboard ?': 'NON (redirect vers lock screen)',
      'Étape recap': 'summary',
      'Bilan groupe (visible à B uniquement)': 200,
    },
    cookieHint: true,
  })
})
