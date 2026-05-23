// Reset pur : wipe l'état du mois courant pour profile A + group G,
// sans seeder de nouveau scénario. Utile pour repartir d'un état "no_recap".
//
// Usage:
//   node scripts/seed-recap/_reset.mjs

import {
  cleanupCurrentMonth,
  runScenario,
  USER_A_EMAIL,
  CURRENT_MONTH,
  CURRENT_YEAR,
} from './_lib.mjs'

runScenario('_reset', async () => {
  await cleanupCurrentMonth()
  console.log('')
  console.log('━'.repeat(70))
  console.log(
    `✨ Reset complet pour ${USER_A_EMAIL} (mois ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR})`,
  )
  console.log('━'.repeat(70))
  console.log(`📝 État résultant : no_recap (aucune ligne monthly_recaps du mois).`)
  console.log(`    Tous les budgets/incomes/expenses/incomes du mois ont été supprimés.`)
  console.log(`    Piggy bank A + G remises à 0. Bank balance A remise à 0.`)
  console.log('')
  console.log(`🌐 Pour confirmer : connecte-toi en navigation privée → /dashboard`)
  console.log(`   → tu devrais être redirigé vers /monthly-recap?context=profile`)
  console.log(`     (wizard "Démarrer le recap" car aucun budget/expense ce mois).`)
  console.log('')
  console.log(`⚠️  Si tu reviens d'un recap completed : ouvre en navigation privée OU`)
  console.log(`   clear les cookies popoth.local (cache "completed" 5 min httpOnly).`)
  console.log('━'.repeat(70))
  console.log('')
})
