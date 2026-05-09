#!/usr/bin/env node
// Verify the 4 custom PL/pgSQL functions captured by Sprint Audit-Triggers / A2
// still exist in prod. Companion to scripts/check-rpcs.mjs.
//
// Why a separate detector: scripts/export-schema.mjs intentionally does NOT
// dump function bodies into the schema baseline (functions live in their own
// dedicated migrations, same pattern as the C3 RPCs). Drift detection is
// therefore blind to a `DROP FUNCTION` on these. This script closes that gap
// for the 4 custom functions; update_updated_at_column is excluded because
// it's Supabase canonical boilerplate (not pinned here to avoid false
// positives if Supabase evolves it).
//
// Source of truth for the expected functions:
//   supabase/migrations/20260512000000_capture_trigger_functions.sql
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:check-functions
//
// Exit 0 -> all 4 functions present in pg_proc (public schema).
// Exit 1 -> at least one function is missing.
// Exit 2 -> fatal (network, auth, etc.).

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

const URL_API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

const EXPECTED_FUNCTIONS = [
  'calculate_group_contributions',
  'cleanup_group_contributions',
  'cleanup_group_members_on_delete',
  'trigger_group_budget_change',
  'trigger_recalculate_contributions',
]

const MIGRATION_PATHS = [
  'supabase/migrations/20260512000000_capture_trigger_functions.sql',
  'supabase/migrations/20260515000000_add_group_members_cleanup_trigger.sql',
]

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
  const inList = EXPECTED_FUNCTIONS.map((n) => `'${n}'`).join(', ')
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
  const missing = EXPECTED_FUNCTIONS.filter((n) => !found.has(n))

  if (missing.length === 0) {
    console.error(
      `OK: all ${EXPECTED_FUNCTIONS.length} captured trigger functions present in prod (public schema).`,
    )
    for (const name of EXPECTED_FUNCTIONS) console.error(`  - ${name}`)
    process.exitCode = 0
    return
  }

  console.error(
    `DRIFT DETECTED: ${missing.length} trigger function(s) missing in prod public schema.`,
  )
  for (const name of missing) {
    console.error(`  - MISSING: ${name}`)
  }
  console.error('')
  console.error(`To resolve: re-apply the migration that defines these functions.`)
  for (const path of MIGRATION_PATHS) {
    console.error(`Source: ${path}`)
    console.error(`Recovery: node scripts/apply-sql.mjs ${path}`)
  }
  console.error('')
  console.error(`This is the same failure mode as the C3 RPC drift post-mortem`)
  console.error(`(docs/audit/POST-MORTEM-C3-DRIFT.md), applied to trigger functions.`)
  process.exitCode = 1
}

// Use process.exitCode (not process.exit) so Node drains the undici keep-alive
// sockets cleanly. process.exit() while sockets are closing triggers a libuv
// assertion on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`).
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 2
})
