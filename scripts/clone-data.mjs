#!/usr/bin/env node
// Clone data from one Supabase project to another via the Management API.
// Uses the user-level SUPABASE_ACCESS_TOKEN which works on all owned projects.
//
// Usage:
//   node scripts/clone-data.mjs <source_ref> <target_ref>
//
// Strategy:
//  - For each table (in FK-safe order), SELECT * from source then build a
//    single INSERT statement and apply on target with ON CONFLICT DO NOTHING.
//  - auth.users is included so users can re-login on the target. Some
//    project-specific columns (instance_id, mfa secrets) may not transfer
//    cleanly — the script logs warnings but continues.
//
// Idempotent : re-running on a partially populated target skips conflicts.

const SOURCE = process.argv[2]
const TARGET = process.argv[3]
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set SUPABASE_ACCESS_TOKEN before running.')
  process.exit(1)
}
if (!SOURCE || !TARGET) {
  console.error('Usage: node scripts/clone-data.mjs <source_ref> <target_ref>')
  process.exit(1)
}
if (SOURCE === TARGET) {
  console.error('ERROR: source and target must differ.')
  process.exit(1)
}

async function executeSQL(projectRef, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${projectRef}: ${text}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

function escapeValue(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') {
    // arrays + objects → JSON, cast to jsonb
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  }
  // string : single-quote escape + cast hint not needed (PG infers)
  return `'${String(v).replace(/'/g, "''")}'`
}

async function getColumns(projectRef, schema, table) {
  const rows = await executeSQL(
    projectRef,
    `SELECT column_name, is_generated FROM information_schema.columns
     WHERE table_schema='${schema}' AND table_name='${table}'
     ORDER BY ordinal_position`,
  )
  // Skip generated columns (PG ALWAYS or BY DEFAULT)
  return rows.filter((r) => r.is_generated !== 'ALWAYS').map((r) => r.column_name)
}

async function cloneTable(schema, table) {
  const cols = await getColumns(SOURCE, schema, table)
  if (cols.length === 0) {
    console.log(`  ${schema}.${table}: (table not found on source)`)
    return
  }
  const colList = cols.map((c) => `"${c}"`).join(', ')
  const data = await executeSQL(SOURCE, `SELECT ${colList} FROM ${schema}."${table}"`)
  if (data.length === 0) {
    console.log(`  ${schema}.${table}: 0 rows`)
    return
  }
  const valuesList = data
    .map((row) => `(${cols.map((c) => escapeValue(row[c])).join(', ')})`)
    .join(', ')

  const insertSQL = `INSERT INTO ${schema}."${table}" (${colList}) VALUES ${valuesList} ON CONFLICT DO NOTHING`
  try {
    await executeSQL(TARGET, insertSQL)
    console.log(`  ${schema}.${table}: ${data.length} rows inserted`)
  } catch (err) {
    console.error(`  ${schema}.${table}: FAILED — ${err.message.slice(0, 200)}`)
  }
}

// FK-safe insert order
const TABLES = [
  // auth schema first (profiles.id has FK to auth.users)
  { schema: 'auth', table: 'users' },
  // public schema in dependency order
  { schema: 'public', table: 'groups' }, // creator_id → auth.users
  { schema: 'public', table: 'profiles' }, // id → auth.users, group_id → groups
  { schema: 'public', table: 'bank_balances' },
  { schema: 'public', table: 'piggy_bank' },
  { schema: 'public', table: 'estimated_budgets' },
  { schema: 'public', table: 'estimated_incomes' },
  { schema: 'public', table: 'real_expenses' }, // → estimated_budgets
  { schema: 'public', table: 'real_income_entries' }, // → estimated_incomes
  { schema: 'public', table: 'group_contributions' },
  { schema: 'public', table: 'remaining_to_live_snapshots' },
  { schema: 'public', table: 'budget_transfers' }, // → estimated_budgets
]

console.log(`Cloning data from ${SOURCE} → ${TARGET}`)
console.log('---')

for (const t of TABLES) {
  await cloneTable(t.schema, t.table)
}

console.log('---')
console.log('Done.')
