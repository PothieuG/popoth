// Init recap léger — DELETE la row `monthly_recaps` du mois courant SANS
// toucher au reste (budgets, expenses, piggy, bank, projets, savings). Le
// proxy gating redirigera automatiquement /dashboard vers /monthly-recap
// dès la prochaine visite, le wizard repart de l'écran "Bienvenue" sur
// tes données réelles intactes. Tu cliques "Démarrer" → POST /start
// recrée la row.
//
// Usage:
//   node scripts/seed-recap/_init-recap.mjs              # profile A (défaut)
//   node scripts/seed-recap/_init-recap.mjs --group      # group G uniquement
//   node scripts/seed-recap/_init-recap.mjs --both       # profile A + group G

import {
  CURRENT_MONTH,
  CURRENT_YEAR,
  GROUP_ID,
  USER_A_EMAIL,
  USER_A_ID,
  USER_B_EMAIL,
  runScenario,
  supabase,
} from './_lib.mjs'

const args = process.argv.slice(2)
const onlyGroup = args.includes('--group')
const both = args.includes('--both')
const wantsProfile = both || !onlyGroup
const wantsGroup = both || onlyGroup

async function deleteRecap(filterKey, contextId, label) {
  const { error, count } = await supabase
    .from('monthly_recaps')
    .delete({ count: 'exact' })
    .eq(filterKey, contextId)
    .eq('recap_month', CURRENT_MONTH)
    .eq('recap_year', CURRENT_YEAR)
  if (error) throw new Error(`DELETE monthly_recaps ${label}: ${error.message}`)
  return count ?? 0
}

runScenario('_init-recap', async () => {
  const monthLabel = `${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`
  console.log(`🔄 Init recap ${monthLabel} (data préservée)`)

  let profileDeleted = 0
  let groupDeleted = 0
  if (wantsProfile) {
    profileDeleted = await deleteRecap('profile_id', USER_A_ID, 'profile A')
    console.log(
      `   • Profile A (${USER_A_EMAIL}) : ${profileDeleted} row${profileDeleted > 1 ? 's' : ''} deleted`,
    )
  }
  if (wantsGroup) {
    groupDeleted = await deleteRecap('group_id', GROUP_ID, 'group G')
    console.log(
      `   • Group G (${GROUP_ID.slice(0, 8)}…) : ${groupDeleted} row${groupDeleted > 1 ? 's' : ''} deleted`,
    )
  }

  const sep = '━'.repeat(70)
  console.log('')
  console.log(sep)
  console.log(`✨ Recap initialisé pour ${monthLabel} (state existant préservé)`)
  console.log(sep)
  console.log(`👤 User QA          : ${USER_A_EMAIL}`)
  if (wantsGroup) console.log(`👥 Co-équipier      : ${USER_B_EMAIL}`)
  console.log('')
  console.log(`📝 Aucune donnée touchée :`)
  console.log(`   • budgets, expenses, incomes : intacts`)
  console.log(`   • piggy_bank, bank_balances  : intacts`)
  console.log(`   • savings_projects           : intacts`)
  console.log('')
  console.log(`📝 Comportement attendu :`)
  console.log(`   Le proxy gating détecte 'no_recap' → redirect vers /monthly-recap`)
  console.log(`   → écran "Bienvenue" → bouton "Démarrer" → POST /start recrée la row`)
  console.log(`   → wizard se déroule sur TES données réelles.`)
  console.log('')
  const url = onlyGroup ? '/group-dashboard' : '/dashboard'
  console.log(`🌐 URL à ouvrir     : http://localhost:3000${url}`)
  console.log('')
  console.log(`⚠️  Navigation privée recommandée pour bypass le cookie httpOnly 5min`)
  console.log(`   (sinon le proxy croira encore que le précédent recap est completed).`)
  console.log(sep)
  console.log('')
})
