// One-off helper : seed 5 estimated_budgets variés pour User B
// (bb53b671-812d-422c-a786-09ee515b680b / b.pothieu@gmail.com) dans la
// DB dev. Mix d'économies cumulées et de budgets propres. Le mois courant
// est wipe (monthly_recaps + budgets de B) avant le seed pour repartir
// d'une page blanche, mais on NE touche PAS aux real_expenses /
// real_income_entries (User B peut continuer à itérer sur ses transactions).
//
// Hors-pattern seed-recap classique : la lib `_lib.mjs` est hardcodée
// pour cleanup/insert sur User A, donc on parle direct à `supabase`
// avec USER_B_ID en filtre.
//
// Idempotent : re-run = wipe + re-seed propre.

import {
  CURRENT_MONTH,
  CURRENT_YEAR,
  USER_B_EMAIL,
  USER_B_ID,
  insertProfileBudgets,
  runScenario,
  supabase,
} from './_lib.mjs'

const BUDGETS = [
  { name: 'Courses', estimated_amount: 400, cumulated_savings: 75 },
  { name: 'Loisirs', estimated_amount: 150, cumulated_savings: 0 },
  { name: 'Transport', estimated_amount: 80, cumulated_savings: 40 },
  { name: 'Restos', estimated_amount: 200, cumulated_savings: 0 },
  { name: 'Abonnements', estimated_amount: 50, cumulated_savings: 25 },
]

async function main() {
  console.log(
    `🧹 Cleanup User B (${USER_B_EMAIL}) — month ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`,
  )

  // DELETE recap row du mois courant pour User B (parcours re-démarrable)
  const { error: recapErr } = await supabase
    .from('monthly_recaps')
    .delete()
    .eq('profile_id', USER_B_ID)
    .eq('recap_month', CURRENT_MONTH)
    .eq('recap_year', CURRENT_YEAR)
  if (recapErr) throw new Error(`DELETE monthly_recaps B: ${recapErr.message}`)

  // DELETE estimated_budgets de User B (récurrents, on repart à zéro)
  const { error: budErr } = await supabase
    .from('estimated_budgets')
    .delete()
    .eq('profile_id', USER_B_ID)
  if (budErr) throw new Error(`DELETE estimated_budgets B: ${budErr.message}`)

  console.log('✅ Cleanup done')

  await insertProfileBudgets(USER_B_ID, BUDGETS)

  const totalEstimated = BUDGETS.reduce((s, b) => s + b.estimated_amount, 0)
  const totalSavings = BUDGETS.reduce((s, b) => s + (b.cumulated_savings ?? 0), 0)

  console.log('')
  console.log('━'.repeat(70))
  console.log(`✨ 5 budgets seedés pour User B (${USER_B_EMAIL})`)
  console.log('━'.repeat(70))
  for (const b of BUDGETS) {
    const savings = b.cumulated_savings
      ? ` (économies cumulées : ${b.cumulated_savings}€)`
      : ' (pas d’économies)'
    console.log(`   • ${b.name.padEnd(13)} ${String(b.estimated_amount).padStart(4)}€${savings}`)
  }
  console.log('')
  console.log(`   📊 Total estimé   : ${totalEstimated}€`)
  console.log(`   💰 Total économies : ${totalSavings}€`)
  console.log('')
  console.log(`🗓️  Mois             : ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`)
  console.log(`🔄 Recap du mois    : wipe (le parcours redémarre à welcome)`)
  console.log('')
  console.log('🌐 Étapes UX :')
  console.log(`   1. pnpm dev (si pas déjà lancé)`)
  console.log(`   2. ouvre navigation privée → http://localhost:3000/connexion`)
  console.log(`   3. login : ${USER_B_EMAIL}`)
  console.log(`   4. navigue vers /dashboard → tu seras redirigé sur /monthly-recap`)
  console.log('')
  console.log('━'.repeat(70))
  console.log('')
}

runScenario('profile-b-budgets', main)
