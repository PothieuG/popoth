// Scénario "chain-profile-done-group-pending" — sprint 14 follow-up 2026-05-25.
//
// État cible : user A est à l'écran 5 (final_recap) de son recap PERSONNEL,
// prêt à cliquer le bouton final. ET son groupe G n'a PAS encore lancé son
// propre recap pour ce mois.
//
// Comportement attendu côté UI :
//   - À l'écran 5 du wizard profile, le bouton lit "Aller au recap du
//     groupe « <name> »" au lieu de "Retourner au dashboard".
//   - Clic sur le bouton → /api/monthly-recap/complete (finalize le recap
//     personnel) → RecapWizard détecte status=completed + groupRecapPending=true
//     → router.replace('/monthly-recap?context=group').
//   - Le wizard du groupe s'ouvre sur Welcome (status=no_recap pour G).
//
// Parcours du recap personnel : bilan positif déjà résolu (surplus +200€
// "transformé en économies" via la branche 4.A). Aucun refloat, donc l'écran
// 5 affiche le résumé positif standard, pas le cascade.

import {
  cleanupCurrentMonth,
  ensureGroupMembership,
  setProfileSalary,
  setPiggy,
  setBank,
  insertProfileBudgets,
  insertProfileExpenses,
  insertGroupBudgets,
  seedRecapRow,
  printPostSeedInstructions,
  runScenario,
  USER_A_ID,
  USER_B_ID,
  GROUP_ID,
} from './_lib.mjs'

runScenario('chain-profile-done-group-pending', async () => {
  // Pré-requis : A et B dans le groupe G (groupId hardcodé == celui demandé
  // par le user : 92dbf6f2-7aa1-4f63-b31c-b85c57e3657e).
  await ensureGroupMembership()

  // Wipe profile A + group G pour le mois courant (recap row + budgets +
  // expenses + incomes + piggy + bank reset à 0).
  await cleanupCurrentMonth()

  // Salaires (alimente le calcul des contributions de groupe via trigger).
  await setProfileSalary(USER_A_ID, 2500)
  await setProfileSalary(USER_B_ID, 2500)

  // Tirelires A et G initialement à 0 (laisse les écrans simples : la
  // tirelire perso n'est pas pertinente pour le surplus transformé).
  await setPiggy({ profile_id: USER_A_ID }, 0)
  await setPiggy({ group_id: GROUP_ID }, 0)

  // Solde A à 1500€ (cohérent avec un mois bouclé en positif).
  await setBank({ profile_id: USER_A_ID }, 1500)

  // 3 budgets profile A. Total estimé 700€ ; dépensé 500€ ; surplus +200€.
  const aBudgets = await insertProfileBudgets(USER_A_ID, [
    { name: 'Courses', estimated_amount: 400, cumulated_savings: 0 },
    { name: 'Transport', estimated_amount: 200, cumulated_savings: 0 },
    { name: 'Loisirs', estimated_amount: 100, cumulated_savings: 0 },
  ])

  await insertProfileExpenses(USER_A_ID, aBudgets, [
    { budget_name: 'Courses', amount: 280, description: 'Carrefour' },
    { budget_name: 'Transport', amount: 120, description: 'Métro mensuel' },
    { budget_name: 'Loisirs', amount: 100, description: 'Cinéma + café' },
  ])

  // 2 budgets groupe — pour que le wizard groupe ait quelque chose à faire
  // après le redirect. Le user pourra commencer le recap groupe à blanc.
  await insertGroupBudgets(GROUP_ID, [
    { name: 'Courses commune', estimated_amount: 400 },
    { name: 'Voiture', estimated_amount: 200 },
  ])

  // Recap PERSONNEL au step final_recap, parcours positif (aucun refloat).
  // Les trackers sont à 0 → l'écran 5 utilise la branche PositiveSummary
  // (summary.totalSurplus = 200€ "transformé").
  await seedRecapRow({
    context: 'profile',
    contextId: USER_A_ID,
    currentStep: 'final_recap',
    startedByProfileId: USER_A_ID,
    refloatedFromPiggy: 0,
    refloatedFromSavings: 0,
    budgetSnapshotData: {},
  })

  // PAS de seedRecapRow pour le groupe → checkRecapStatus(group) renvoie
  // no_recap → groupRecapPending=true côté wizard → bouton "Aller au recap
  // du groupe «…»" sur l'écran 5.

  printPostSeedInstructions({
    scenarioKey: 'chain-profile-done-group-pending',
    context: 'profile',
    expectedUrl: '/dashboard',
    expectedBehavior:
      'Le proxy redirige /dashboard → /monthly-recap?context=profile (le ' +
      'recap perso est encore in_progress à final_recap). Le wizard rouvre ' +
      'à l\'écran 5 Final Recap, parcours positif (+200€ transformés en ' +
      'économies). Le bouton du bas affiche "Aller au recap du groupe « … »" ' +
      'parce que le groupe G n\'a pas encore commencé son propre recap. ' +
      'Le clic finalise le recap perso puis redirige vers ' +
      '/monthly-recap?context=group où le wizard groupe démarre sur Welcome.',
    expectedFigures: {
      'Étape attendue (profile)': 'final_recap',
      'Bilan profile': 200,
      'Total budgets profile': 700,
      'Total dépensé profile': 500,
      'Surplus profile transformé': 200,
      'État recap groupe': 'no_recap (pas encore lancé)',
      'Salaire A': 2500,
      'Salaire B': 2500,
      'Tirelire profile': 0,
      'Tirelire groupe': 0,
      'Solde compte A': 1500,
    },
    cookieHint: true,
  })
})
