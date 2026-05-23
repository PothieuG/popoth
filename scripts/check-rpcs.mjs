#!/usr/bin/env node
// Verify the 4 atomic finance RPCs from the C3 sprint exist in prod.
// Companion to scripts/check-drift.mjs — that script intentionally excludes
// functions/RPCs from the schema baseline (they live in dedicated migrations),
// so the C3 drift post-mortem (docs/audit/POST-MORTEM-C3-DRIFT.md) noted that
// drift detection has no eyes on RPC presence. This script closes that gap.
//
// Source of truth for the expected RPCs:
//   supabase/migrations/20260506000000_create_finance_rpcs.sql
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:check-rpcs
//
// Exit 0 -> all 4 RPCs present in pg_proc (public schema).
// Exit 1 -> at least one RPC is missing.
// Exit 2 -> fatal (network, auth, etc.).

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

const URL_API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

const EXPECTED_RPCS = [
  'update_piggy_bank_amount',
  'update_bank_balance',
  'update_budget_cumulated_savings',
  'transfer_from_piggy_to_budget',
  'transfer_with_savings_debit',
  'add_expense_with_breakdown',
  'transfer_savings_between_budgets',
  'transfer_budget_to_piggy_bank',
  'add_expense_with_cross_budget_cascade',
  'transfer_piggy_to_budget_with_insert',
  'delete_budget_with_savings_transfer',
  // Sprint Long-Press-Toggle-Apply-To-Balance (2026-05-23) —
  // supabase/migrations/20260523010000_create_toggle_applied_to_balance_rpcs.sql
  'toggle_real_expense_applied_to_balance',
  'toggle_real_income_applied_to_balance',
  // Sprint 05 Monthly Recap V3 (2026-05-25) —
  // supabase/migrations/20260525000000_create_recap_start_rpc.sql
  'start_monthly_recap',
]

const MIGRATION_PATH = 'supabase/migrations/20260506000000_create_finance_rpcs.sql'

async function query(sql) {
  const res = await fetch(URL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Management API ${res.status}: ${body}`)
  }
  return res.json()
}

async function main() {
  const inList = EXPECTED_RPCS.map((n) => `'${n}'`).join(', ')
  const sql = `
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (${inList})
    ORDER BY p.proname
  `
  const rows = await query(sql)
  const found = new Set(rows.map((r) => r.proname))
  const missing = EXPECTED_RPCS.filter((n) => !found.has(n))

  if (missing.length === 0) {
    console.error(`OK: all ${EXPECTED_RPCS.length} finance RPCs present in prod (public schema).`)
    for (const name of EXPECTED_RPCS) console.error(`  - ${name}`)
    process.exitCode = 0
    return
  }

  console.error(`DRIFT DETECTED: ${missing.length} RPC(s) missing in prod public schema.`)
  for (const name of missing) {
    console.error(`  - MISSING: ${name}`)
  }
  console.error('')
  console.error(`To resolve: re-apply the migration that defines these RPCs.`)
  console.error(`Source: ${MIGRATION_PATH}`)
  console.error(`Recovery: node scripts/apply-sql.mjs ${MIGRATION_PATH}`)
  console.error('')
  console.error(`This is exactly the failure mode of the C3 drift post-mortem`)
  console.error(`(docs/audit/POST-MORTEM-C3-DRIFT.md).`)
  process.exitCode = 1
}

// Use process.exitCode (not process.exit) so Node drains the undici keep-alive
// sockets cleanly. process.exit() while sockets are closing triggers a libuv
// assertion on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`).
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 2
})
