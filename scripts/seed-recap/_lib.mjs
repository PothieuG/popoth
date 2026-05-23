// Shared helpers for Monthly Recap V3 dev seed scripts.
// Targets the DEV Supabase project (ddehmjucyfgyppfkbddr) ONLY — hardcoded.
// 1 script per scenario sits next to this file and imports from it.
//
// Required env: SUPABASE_DEV_SERVICE_ROLE_KEY (the service_role key of the
// dev project, distinct from SUPABASE_SERVICE_ROLE_KEY which may target prod).
// Picked up automatically from .env.local (no dotenv dep needed).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// --- .env.local auto-loader (no external dep) -------------------------------
function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (key && !process.env[key]) process.env[key] = val
    }
  } catch {
    // .env.local missing — that's fine if the user set env vars in the shell.
  }
}
loadEnvLocal()

// --- Anti-prod absolute guard ----------------------------------------------
const PROD_REF = 'jzmppreybwabaeycvasz'
const DEV_REF = 'ddehmjucyfgyppfkbddr'
const SUPABASE_URL = `https://${DEV_REF}.supabase.co`

const SERVICE_KEY = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY
if (!SERVICE_KEY) {
  console.error('')
  console.error('🛑 Missing env var SUPABASE_DEV_SERVICE_ROLE_KEY.')
  console.error('   Add this line to .env.local at the repo root:')
  console.error('     SUPABASE_DEV_SERVICE_ROLE_KEY=<service_role key of dev project>')
  console.error('   Get the key at:')
  console.error(`     https://supabase.com/dashboard/project/${DEV_REF}/settings/api`)
  console.error('   This is DISTINCT from SUPABASE_SERVICE_ROLE_KEY (which may target prod).')
  console.error('')
  process.exit(1)
}

// Sanity: refuse to run if the key looks like it was copy-pasted from prod.
// Service-role keys are JWTs that embed their project ref in the "ref" claim.
// Decoding the middle base64 segment is cheap; we just want a "does it
// mention prod ref?" check — no signature validation.
try {
  const payloadB64 = SERVICE_KEY.split('.')[1] ?? ''
  // Base64url → base64
  const padded = payloadB64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=')
  const decoded = Buffer.from(padded, 'base64').toString('utf8')
  if (decoded.includes(PROD_REF)) {
    console.error('')
    console.error('🛑 SUPABASE_DEV_SERVICE_ROLE_KEY contains the PROD project ref.')
    console.error('   The key you set actually targets the prod project. Refusing to run.')
    console.error(`   Replace it with the service_role key from dev project ${DEV_REF}.`)
    console.error('')
    process.exit(1)
  }
} catch {
  // If JWT decoding fails for any reason, fall through — Supabase will reject
  // an invalid key anyway with a clearer error.
}

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// --- Constants (dev DB values provided by user) -----------------------------
export const USER_A_ID = '0679b0f9-830a-44e5-aecf-f8452c8dd101'
export const USER_A_EMAIL = 'gilles.pothieu@gmail.com'
export const USER_B_ID = 'bb53b671-812d-422c-a786-09ee515b680b'
export const USER_B_EMAIL = 'b.pothieu@gmail.com'
export const GROUP_ID = '92dbf6f2-7aa1-4f63-b31c-b85c57e3657e'

const _now = new Date()
export const CURRENT_MONTH = _now.getMonth() + 1
export const CURRENT_YEAR = _now.getFullYear()

function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0')
  const start = `${year}-${mm}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
  return { start, end, mm }
}
const _b = monthBounds(CURRENT_YEAR, CURRENT_MONTH)
export const CURRENT_MONTH_START = _b.start
export const CURRENT_MONTH_END = _b.end
export const DEFAULT_EXPENSE_DATE = `${CURRENT_YEAR}-${_b.mm}-15`
export const DEFAULT_INCOME_DATE = `${CURRENT_YEAR}-${_b.mm}-10`

// --- Cleanup ----------------------------------------------------------------
/**
 * Wipe le state du mois courant pour le profile A et (optionnel) pour le groupe G.
 * Préserve les data des autres mois (sauf reset des is_carried_over flags).
 */
export async function cleanupCurrentMonth({ profile = true, group = true } = {}) {
  console.log(
    `🧹 Cleanup: ${String(CURRENT_MONTH).padStart(2, '0')}/${CURRENT_YEAR} for A=${USER_A_EMAIL}` +
      (group ? ` + group G (${GROUP_ID.slice(0, 8)}…)` : ''),
  )

  // 1. DELETE monthly_recaps du mois (cascade carry_from_recap_id → null, OK)
  if (profile) {
    const { error } = await supabase
      .from('monthly_recaps')
      .delete()
      .eq('profile_id', USER_A_ID)
      .eq('recap_month', CURRENT_MONTH)
      .eq('recap_year', CURRENT_YEAR)
    if (error) throw new Error(`DELETE monthly_recaps profile: ${error.message}`)
  }
  if (group) {
    const { error } = await supabase
      .from('monthly_recaps')
      .delete()
      .eq('group_id', GROUP_ID)
      .eq('recap_month', CURRENT_MONTH)
      .eq('recap_year', CURRENT_YEAR)
    if (error) throw new Error(`DELETE monthly_recaps group: ${error.message}`)
  }

  // 2. DELETE real_expenses du mois courant (profile A + group G)
  await _deleteByMonth('real_expenses', 'expense_date', { profile, group })

  // 3. DELETE real_income_entries du mois courant
  await _deleteByMonth('real_income_entries', 'entry_date', { profile, group })

  // 4. DELETE estimated_budgets (config récurrente, pas month-scope — repart à zéro)
  if (profile) {
    const { error } = await supabase.from('estimated_budgets').delete().eq('profile_id', USER_A_ID)
    if (error) throw new Error(`DELETE estimated_budgets profile: ${error.message}`)
  }
  if (group) {
    const { error } = await supabase.from('estimated_budgets').delete().eq('group_id', GROUP_ID)
    if (error) throw new Error(`DELETE estimated_budgets group: ${error.message}`)
  }

  // 5. DELETE estimated_incomes (idem, récurrent)
  if (profile) {
    const { error } = await supabase.from('estimated_incomes').delete().eq('profile_id', USER_A_ID)
    if (error) throw new Error(`DELETE estimated_incomes profile: ${error.message}`)
  }
  if (group) {
    const { error } = await supabase.from('estimated_incomes').delete().eq('group_id', GROUP_ID)
    if (error) throw new Error(`DELETE estimated_incomes group: ${error.message}`)
  }

  // 6. UPSERT piggy_bank à 0 (A profile + G group si group)
  if (profile) await _upsertPiggy({ profile_id: USER_A_ID }, 0)
  if (group) await _upsertPiggy({ group_id: GROUP_ID }, 0)

  // 7. UPSERT bank_balances profile A à 0 (pas de bank groupe dans la spec)
  if (profile) await _upsertBank({ profile_id: USER_A_ID }, 0)

  // 8. Reset is_carried_over flags sur prior months (au cas où un recap antérieur les a flaggués)
  await _resetCarriedOver({ profile, group })

  console.log(`✅ Cleanup done`)
}

async function _deleteByMonth(table, dateCol, { profile, group }) {
  if (profile) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('profile_id', USER_A_ID)
      .gte(dateCol, CURRENT_MONTH_START)
      .lte(dateCol, CURRENT_MONTH_END)
    if (error) throw new Error(`DELETE ${table} profile: ${error.message}`)
  }
  if (group) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('group_id', GROUP_ID)
      .gte(dateCol, CURRENT_MONTH_START)
      .lte(dateCol, CURRENT_MONTH_END)
    if (error) throw new Error(`DELETE ${table} group: ${error.message}`)
  }
}

async function _resetCarriedOver({ profile, group }) {
  const tables = ['real_expenses', 'real_income_entries']
  for (const table of tables) {
    if (profile) {
      await supabase
        .from(table)
        .update({ is_carried_over: false, carried_from_recap_id: null })
        .eq('profile_id', USER_A_ID)
        .eq('is_carried_over', true)
    }
    if (group) {
      await supabase
        .from(table)
        .update({ is_carried_over: false, carried_from_recap_id: null })
        .eq('group_id', GROUP_ID)
        .eq('is_carried_over', true)
    }
  }
}

async function _upsertPiggy(filter, amount) {
  const { data: existing } = await supabase
    .from('piggy_bank')
    .select('id')
    .match(filter)
    .maybeSingle()
  if (existing) {
    const { error } = await supabase
      .from('piggy_bank')
      .update({ amount, last_updated: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(`UPDATE piggy_bank: ${error.message}`)
  } else {
    const { error } = await supabase
      .from('piggy_bank')
      .insert({ ...filter, amount, last_updated: new Date().toISOString() })
    if (error) throw new Error(`INSERT piggy_bank: ${error.message}`)
  }
}

async function _upsertBank(filter, balance) {
  const { data: existing } = await supabase
    .from('bank_balances')
    .select('id')
    .match(filter)
    .maybeSingle()
  if (existing) {
    const { error } = await supabase
      .from('bank_balances')
      .update({ balance, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) throw new Error(`UPDATE bank_balances: ${error.message}`)
  } else {
    const { error } = await supabase.from('bank_balances').insert({ ...filter, balance })
    if (error) throw new Error(`INSERT bank_balances: ${error.message}`)
  }
}

// --- Insert helpers ---------------------------------------------------------
/**
 * INSERT estimated_budgets for profile A. Returns Map<name, id>.
 * budgets: [{ name, estimated_amount, cumulated_savings?=0, is_monthly_recurring?=true }]
 */
export async function insertProfileBudgets(profileId, budgets) {
  return _insertBudgets({ profile_id: profileId }, budgets)
}

export async function insertGroupBudgets(groupId, budgets) {
  return _insertBudgets({ group_id: groupId }, budgets)
}

async function _insertBudgets(ownerFilter, budgets) {
  if (!budgets.length) return new Map()
  const rows = budgets.map((b) => ({
    ...ownerFilter,
    name: b.name,
    estimated_amount: b.estimated_amount,
    is_monthly_recurring: b.is_monthly_recurring ?? true,
    cumulated_savings: b.cumulated_savings ?? 0,
  }))
  const { data, error } = await supabase.from('estimated_budgets').insert(rows).select('id, name')
  if (error) throw new Error(`INSERT estimated_budgets: ${error.message}`)
  return new Map(data.map((b) => [b.name, b.id]))
}

/**
 * INSERT real_expenses for profile A.
 * expenses: [{ budget_name?, amount, description?, expense_date?, is_exceptional?,
 *              amount_from_piggy_bank?, amount_from_budget_savings?, amount_from_budget?,
 *              applied?=true, is_carried_over?=false }]
 * - `budget_name` est résolu via la Map retournée par insertProfileBudgets/insertGroupBudgets.
 * - `applied=true` (par défaut) ⇒ applied_to_balance_at = expense_date.
 * - Les 3 amount_from_* sont auto-calculés si non fournis : tout sur amount_from_budget
 *   sauf si piggy ou savings est explicitement set.
 */
export async function insertProfileExpenses(profileId, budgetIdsByName, expenses) {
  return _insertExpenses(
    { profile_id: profileId, created_by_profile_id: profileId },
    budgetIdsByName,
    expenses,
  )
}

export async function insertGroupExpenses(
  groupId,
  budgetIdsByName,
  expenses,
  { createdByUserId = USER_A_ID } = {},
) {
  return _insertExpenses(
    { group_id: groupId, created_by_profile_id: createdByUserId },
    budgetIdsByName,
    expenses,
  )
}

async function _insertExpenses(baseFilter, budgetIdsByName, expenses) {
  if (!expenses.length) return
  const rows = expenses.map((e) => {
    let budgetId = null
    if (e.budget_name) {
      budgetId = budgetIdsByName.get(e.budget_name) ?? null
      if (!budgetId) {
        throw new Error(
          `Budget '${e.budget_name}' introuvable dans le Map budgets. Vérifie ton scénario.`,
        )
      }
    }
    const applied = e.applied !== false
    const expenseDate = e.expense_date ?? DEFAULT_EXPENSE_DATE
    const fromPiggy = e.amount_from_piggy_bank ?? 0
    const fromSavings = e.amount_from_budget_savings ?? 0
    const fromBudget = e.amount_from_budget ?? Math.max(0, e.amount - fromPiggy - fromSavings)
    return {
      ...baseFilter,
      estimated_budget_id: budgetId,
      amount: e.amount,
      description: e.description ?? `Test expense ${e.amount}€`,
      expense_date: expenseDate,
      is_exceptional: e.is_exceptional ?? false,
      amount_from_piggy_bank: fromPiggy,
      amount_from_budget_savings: fromSavings,
      amount_from_budget: fromBudget,
      applied_to_balance_at: applied ? new Date(`${expenseDate}T12:00:00Z`).toISOString() : null,
      is_carried_over: e.is_carried_over ?? false,
    }
  })
  const { error } = await supabase.from('real_expenses').insert(rows)
  if (error) throw new Error(`INSERT real_expenses: ${error.message}`)
}

/** INSERT estimated_incomes. incomes: [{ name, estimated_amount, is_monthly_recurring?=true }] */
export async function insertProfileIncomes(profileId, incomes) {
  return _insertIncomes({ profile_id: profileId }, incomes)
}

export async function insertGroupIncomes(groupId, incomes) {
  return _insertIncomes({ group_id: groupId }, incomes)
}

async function _insertIncomes(ownerFilter, incomes) {
  if (!incomes.length) return
  const rows = incomes.map((i) => ({
    ...ownerFilter,
    name: i.name,
    estimated_amount: i.estimated_amount,
    is_monthly_recurring: i.is_monthly_recurring ?? true,
  }))
  const { error } = await supabase.from('estimated_incomes').insert(rows)
  if (error) throw new Error(`INSERT estimated_incomes: ${error.message}`)
}

/**
 * INSERT real_income_entries.
 * realIncomes: [{ amount, description?, is_exceptional?, applied?=true,
 *                 is_carried_over?=false, entry_date? }]
 */
export async function insertProfileRealIncomes(profileId, realIncomes) {
  return _insertRealIncomes(
    { profile_id: profileId, created_by_profile_id: profileId },
    realIncomes,
  )
}

export async function insertGroupRealIncomes(
  groupId,
  realIncomes,
  { createdByUserId = USER_A_ID } = {},
) {
  return _insertRealIncomes(
    { group_id: groupId, created_by_profile_id: createdByUserId },
    realIncomes,
  )
}

async function _insertRealIncomes(baseFilter, realIncomes) {
  if (!realIncomes.length) return
  const rows = realIncomes.map((ri) => {
    const applied = ri.applied !== false
    const entryDate = ri.entry_date ?? DEFAULT_INCOME_DATE
    return {
      ...baseFilter,
      amount: ri.amount,
      description: ri.description ?? `Test income ${ri.amount}€`,
      entry_date: entryDate,
      is_exceptional: ri.is_exceptional ?? false,
      applied_to_balance_at: applied ? new Date(`${entryDate}T12:00:00Z`).toISOString() : null,
      is_carried_over: ri.is_carried_over ?? false,
    }
  })
  const { error } = await supabase.from('real_income_entries').insert(rows)
  if (error) throw new Error(`INSERT real_income_entries: ${error.message}`)
}

// --- Piggy / Bank / Salary direct setters -----------------------------------
export async function setPiggy(filter, amount) {
  await _upsertPiggy(filter, amount)
}

export async function setBank(filter, balance) {
  await _upsertBank(filter, balance)
}

/**
 * UPDATE profiles.salary + recompute group_contributions if profile is in a group.
 * Pass userId = USER_A_ID or USER_B_ID.
 */
export async function setProfileSalary(userId, salary) {
  const { error } = await supabase.from('profiles').update({ salary }).eq('id', userId)
  if (error) throw new Error(`UPDATE profiles salary (user ${userId}): ${error.message}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('group_id')
    .eq('id', userId)
    .single()
  if (profile?.group_id) {
    const { error: rpcError } = await supabase.rpc('calculate_group_contributions', {
      group_id_param: profile.group_id,
    })
    if (rpcError) {
      console.warn(
        `⚠️ RPC calculate_group_contributions failed (la trigger DB pourrait quand même recompute): ${rpcError.message}`,
      )
    }
  }
}

/**
 * Sanity check pour les scénarios groupe : vérifie que A et B sont tous deux
 * membres de GROUP_ID. Throw avec instructions si ce n'est pas le cas.
 *
 * Le sprint 09 a fait l'hypothèse que A et B sont déjà dans le groupe G en dev
 * (cf. sprint 09 plan). Si ce n'est pas le cas, le user doit corriger
 * manuellement avant de lancer un scénario group (via /api/groups/[id]/members
 * ou UPDATE direct).
 */
export async function ensureGroupMembership() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, group_id, first_name, last_name')
    .in('id', [USER_A_ID, USER_B_ID])
  if (error) throw new Error(`SELECT profiles A+B: ${error.message}`)
  if (!data || data.length < 2) {
    throw new Error(
      `Profiles introuvables. Attendu A=${USER_A_ID} + B=${USER_B_ID}, trouvé : ${JSON.stringify(data)}`,
    )
  }
  const wrong = data.filter((p) => p.group_id !== GROUP_ID)
  if (wrong.length) {
    const msg = wrong
      .map(
        (p) => `   • ${p.id} (${p.first_name} ${p.last_name}) : group_id=${p.group_id ?? 'null'}`,
      )
      .join('\n')
    throw new Error(
      `🛑 Pré-requis group: A et B doivent être dans GROUP_ID=${GROUP_ID}.\n` +
        `   Profils hors-groupe :\n${msg}\n` +
        `   Corrige via : UPDATE profiles SET group_id = '${GROUP_ID}' WHERE id IN ('${USER_A_ID}','${USER_B_ID}');`,
    )
  }
}

// --- Recap row direct insert (resume / completed / locked-by-other) ---------
/**
 * INSERT direct dans monthly_recaps pour seed un état mid-flow OU completed
 * OU locked-by-other, sans passer par /api/monthly-recap/start.
 *
 * Le DELETE préalable garantit l'idempotency (les partial unique indexes
 * empêchent un UPSERT propre puisqu'on est en XOR profile/group).
 */
export async function seedRecapRow({
  context,
  contextId,
  currentStep = 'welcome',
  startedByProfileId = USER_A_ID,
  startedAt = new Date().toISOString(),
  refloatedFromPiggy = 0,
  refloatedFromSavings = 0,
  budgetSnapshotData = {},
  completedAt = null,
}) {
  if (context !== 'profile' && context !== 'group') {
    throw new Error(`seedRecapRow: context must be 'profile' or 'group', got '${context}'`)
  }
  const filterKey = context === 'profile' ? 'profile_id' : 'group_id'

  await supabase
    .from('monthly_recaps')
    .delete()
    .eq(filterKey, contextId)
    .eq('recap_month', CURRENT_MONTH)
    .eq('recap_year', CURRENT_YEAR)

  const payload = {
    [filterKey]: contextId,
    recap_month: CURRENT_MONTH,
    recap_year: CURRENT_YEAR,
    current_step: currentStep,
    started_by_profile_id: startedByProfileId,
    started_at: startedAt,
    refloated_from_piggy: refloatedFromPiggy,
    refloated_from_savings: refloatedFromSavings,
    budget_snapshot_data: budgetSnapshotData,
    completed_at: completedAt,
  }

  const { data, error } = await supabase
    .from('monthly_recaps')
    .insert(payload)
    .select('id, current_step, completed_at')
    .single()
  if (error) throw new Error(`INSERT monthly_recaps: ${error.message}`)
  return data
}

// --- Output ----------------------------------------------------------------
/**
 * Print les instructions UX en fin de seed (URL à ouvrir, user à utiliser,
 * valeurs attendues, warning cookies).
 */
export function printPostSeedInstructions({
  scenarioKey,
  context = 'profile',
  expectedUrl,
  expectedBehavior,
  expectedFigures = {},
  cookieHint = true,
} = {}) {
  const targetUrl = expectedUrl ?? (context === 'group' ? '/group-dashboard' : '/dashboard')
  const figuresLines = Object.entries(expectedFigures).map(
    ([k, v]) => `   • ${k} : ${typeof v === 'number' ? `${v}€` : v}`,
  )
  const sep = '━'.repeat(70)

  console.log('')
  console.log(sep)
  console.log(`✨ Scénario "${scenarioKey}" seedé`)
  console.log(sep)
  console.log(`📍 Contexte         : ${context}`)
  console.log(`👤 User QA          : ${USER_A_EMAIL} (mot de passe dev habituel)`)
  if (context === 'group') {
    console.log(`👥 Co-équipier      : ${USER_B_EMAIL}`)
    console.log(`🏷️  Group ID        : ${GROUP_ID}`)
  }
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
  console.log(`🌐 URL à ouvrir     : http://localhost:3000${targetUrl}`)
  if (cookieHint) {
    console.log('')
    console.log(`⚠️  Si tu viens de terminer un recap récemment :`)
    console.log(`   → ouvre en navigation privée, OU clear les cookies du domaine`)
    console.log(`     (le gating recap cache l'état "completed" 5 min dans un cookie httpOnly).`)
  }
  console.log(sep)
  console.log('')
}

/** Helper to wrap main() with consistent error handling. */
export function runScenario(name, fn) {
  fn().catch((err) => {
    console.error(`❌ Scenario "${name}" failed:`)
    console.error(err)
    process.exit(1)
  })
}
