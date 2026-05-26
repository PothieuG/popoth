// Script utility — démarre un Monthly Recap V3 au step 'welcome' pour le
// profil dev courant (USER_A) ou le groupe G, sans seeder aucune donnée
// (budgets / dépenses / revenus / piggy / bank intacts).
//
// Usage :
//   node scripts/start-recap.mjs                    # context=profile (USER_A)
//   node scripts/start-recap.mjs --context=group    # context=group (GROUP_ID)
//
// `seedRecapRow` fait DELETE puis INSERT idempotent → relancer le script wipe
// la row recap existante et repart à 'welcome'. Aucune autre table touchée.

import {
  CURRENT_MONTH,
  CURRENT_YEAR,
  GROUP_ID,
  USER_A_EMAIL,
  USER_A_ID,
  runScenario,
  seedRecapRow,
  supabase,
} from './seed-recap/_lib.mjs'

const ctxArg = process.argv.find((a) => a.startsWith('--context='))?.split('=')[1] ?? 'profile'

runScenario('start-recap', async () => {
  if (ctxArg !== 'profile' && ctxArg !== 'group') {
    throw new Error(`--context must be 'profile' or 'group', got '${ctxArg}'`)
  }
  const contextId = ctxArg === 'profile' ? USER_A_ID : GROUP_ID
  const filterKey = ctxArg === 'profile' ? 'profile_id' : 'group_id'

  console.log(`📅 Mois ciblé      : ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`)
  console.log(`👤 ${filterKey}     : ${contextId}`)
  console.log(`🏷️  Initiateur      : ${USER_A_ID} (${USER_A_EMAIL})`)
  console.log('')

  const inserted = await seedRecapRow({
    context: ctxArg,
    contextId,
    currentStep: 'welcome',
    startedByProfileId: USER_A_ID,
  })

  console.log(`✅ INSERT ok       : id=${inserted.id}`)
  console.log(`   current_step    : ${inserted.current_step}`)
  console.log(`   completed_at    : ${inserted.completed_at ?? 'null'}`)
  console.log('')

  // Re-lecture pour confirmer ce que verra `checkRecapStatus` côté app :
  // mêmes filtres, mêmes colonnes.
  const { data: verify, error: verifyError } = await supabase
    .from('monthly_recaps')
    .select('id, current_step, started_at, started_by_profile_id, completed_at')
    .eq(filterKey, contextId)
    .eq('recap_month', CURRENT_MONTH)
    .eq('recap_year', CURRENT_YEAR)
    .maybeSingle()

  if (verifyError) {
    console.error(`❌ SELECT verify failed: ${verifyError.message}`)
    process.exit(1)
  }
  if (!verify) {
    console.error('❌ SELECT verify : aucune row trouvée APRÈS INSERT — incohérence DB.')
    process.exit(1)
  }
  console.log(
    `🔎 Re-lecture OK   : checkRecapStatus verra status='in_progress' step='${verify.current_step}'`,
  )
  console.log('')

  const sep = '━'.repeat(70)
  console.log(sep)
  console.log(`✨ Recap démarré sans seeder de données`)
  console.log(sep)
  console.log(`📍 Contexte        : ${ctxArg}`)
  console.log(
    `🌐 URL à ouvrir    : http://localhost:3000${ctxArg === 'group' ? '/group-dashboard' : '/dashboard'}`,
  )
  console.log(`   → redirige auto vers /monthly-recap${ctxArg === 'group' ? '?context=group' : ''}`)
  console.log('')
  console.log(`⚠️  Si /dashboard NE redirige PAS vers le wizard :`)
  console.log(`   1. Ouvre DevTools (F12) → Application → Cookies → localhost:3000`)
  console.log(`      Supprime tout cookie commençant par 'recap-ok-' (cache httpOnly 5min`)
  console.log(`      posé quand le précédent recap était 'completed').`)
  console.log(`   2. Reload /dashboard.`)
  console.log(`   3. Si toujours pas : vérifie que SUPABASE_SERVICE_ROLE_KEY dans .env.local`)
  console.log(`      pointe bien vers le projet dev (ddehmjucyfgyppfkbddr) — c'est cette`)
  console.log(`      clé qu'utilise checkRecapStatus côté server, distincte de`)
  console.log(`      SUPABASE_DEV_SERVICE_ROLE_KEY consommée par ce script.`)
  console.log(sep)
})
