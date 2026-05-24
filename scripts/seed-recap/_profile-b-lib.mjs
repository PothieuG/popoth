// Helpers spécifiques User B (b.pothieu@gmail.com) — variante DRY des
// utilitaires de `_lib.mjs` qui sont hardcodés pour User A.
//
// Exporte `cleanupForB()` (wipe estimated_budgets + monthly_recaps +
// real_expenses + real_income_entries + piggy/bank du mois courant pour
// User B) et `printForB({...})` (post-seed instructions ciblées User B).
//
// Re-exporte aussi les helpers data-insert qui acceptent déjà un profileId
// arbitraire (`insertProfileBudgets`, `insertProfileExpenses`, `setPiggy`,
// `setBank`, etc.) — les scripts profile-b-* importent depuis ici.

import {
  CURRENT_MONTH,
  CURRENT_MONTH_END,
  CURRENT_MONTH_START,
  CURRENT_YEAR,
  USER_B_EMAIL,
  USER_B_ID,
  insertProfileBudgets,
  insertProfileExpenses,
  insertProfileIncomes,
  insertProfileRealIncomes,
  runScenario,
  setBank,
  setPiggy,
  setProfileSalary,
  supabase,
} from './_lib.mjs'

export {
  CURRENT_MONTH,
  CURRENT_YEAR,
  USER_B_EMAIL,
  USER_B_ID,
  insertProfileBudgets,
  insertProfileExpenses,
  insertProfileIncomes,
  insertProfileRealIncomes,
  runScenario,
  setBank,
  setPiggy,
  setProfileSalary,
}

/**
 * Cleanup du mois courant pour User B (profile context only — pas de groupe).
 * Mirror de `cleanupCurrentMonth` mais avec USER_B_ID en filtre.
 */
export async function cleanupForB() {
  console.log(
    `🧹 Cleanup User B (${USER_B_EMAIL}) — ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`,
  )

  // monthly_recaps mois courant
  {
    const { error } = await supabase
      .from('monthly_recaps')
      .delete()
      .eq('profile_id', USER_B_ID)
      .eq('recap_month', CURRENT_MONTH)
      .eq('recap_year', CURRENT_YEAR)
    if (error) throw new Error(`DELETE monthly_recaps B: ${error.message}`)
  }

  // real_expenses du mois
  {
    const { error } = await supabase
      .from('real_expenses')
      .delete()
      .eq('profile_id', USER_B_ID)
      .gte('expense_date', CURRENT_MONTH_START)
      .lte('expense_date', CURRENT_MONTH_END)
    if (error) throw new Error(`DELETE real_expenses B: ${error.message}`)
  }

  // real_income_entries du mois
  {
    const { error } = await supabase
      .from('real_income_entries')
      .delete()
      .eq('profile_id', USER_B_ID)
      .gte('entry_date', CURRENT_MONTH_START)
      .lte('entry_date', CURRENT_MONTH_END)
    if (error) throw new Error(`DELETE real_income_entries B: ${error.message}`)
  }

  // estimated_budgets (récurrent, on repart à zéro)
  {
    const { error } = await supabase.from('estimated_budgets').delete().eq('profile_id', USER_B_ID)
    if (error) throw new Error(`DELETE estimated_budgets B: ${error.message}`)
  }

  // estimated_incomes
  {
    const { error } = await supabase.from('estimated_incomes').delete().eq('profile_id', USER_B_ID)
    if (error) throw new Error(`DELETE estimated_incomes B: ${error.message}`)
  }

  // piggy + bank reset à 0 (les helpers _upsertPiggy / _upsertBank de _lib.mjs
  // sont privés ; on passe par setPiggy / setBank publics)
  await setPiggy({ profile_id: USER_B_ID }, 0)
  await setBank({ profile_id: USER_B_ID }, 0)

  // Reset is_carried_over flags des prior months (best-effort)
  await supabase
    .from('real_expenses')
    .update({ is_carried_over: false, carried_from_recap_id: null })
    .eq('profile_id', USER_B_ID)
    .eq('is_carried_over', true)
  await supabase
    .from('real_income_entries')
    .update({ is_carried_over: false, carried_from_recap_id: null })
    .eq('profile_id', USER_B_ID)
    .eq('is_carried_over', true)

  console.log('✅ Cleanup done')
}

/**
 * Post-seed instructions ciblées User B (variant de `printPostSeedInstructions`).
 */
export function printForB({ scenarioKey, expectedBehavior, expectedFigures = {} }) {
  const figuresLines = Object.entries(expectedFigures).map(
    ([k, v]) => `   • ${k} : ${typeof v === 'number' ? `${v}€` : v}`,
  )
  const sep = '━'.repeat(70)

  console.log('')
  console.log(sep)
  console.log(`✨ Scénario "${scenarioKey}" seedé pour User B`)
  console.log(sep)
  console.log(`👤 User QA          : ${USER_B_EMAIL}`)
  console.log(`🗓️  Mois            : ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR}`)
  console.log('')
  console.log(`📝 Comportement UX attendu :`)
  console.log(`   ${expectedBehavior}`)
  if (figuresLines.length) {
    console.log('')
    console.log(`🔢 Valeurs attendues à l'écran :`)
    figuresLines.forEach((l) => console.log(l))
  }
  console.log('')
  console.log('🌐 Étapes UX :')
  console.log(`   1. pnpm dev (si pas déjà lancé)`)
  console.log(`   2. ouvre navigation privée → http://localhost:3000/connexion`)
  console.log(`   3. login : ${USER_B_EMAIL}`)
  console.log(`   4. navigue vers /dashboard → redirection auto vers /monthly-recap`)
  console.log('')
  console.log(sep)
  console.log('')
}
