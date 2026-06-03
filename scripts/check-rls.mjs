#!/usr/bin/env node
// Verify every table in the public schema has Row Level Security enabled.
//
// Local mirror of the Supabase database linter rule 0013_rls_disabled_in_public,
// wired into `pnpm verify` so the finding is caught at dev time before it ever
// reaches prod. The root cause it guards against: the `ensure_rls` event trigger
// (which auto-enables RLS on every new public table at CREATE TABLE time) can be
// absent on a project — which is exactly how `monthly_recaps` shipped to prod
// without RLS, exposing every user's recap rows to anyone holding the public
// anon key via the PostgREST REST API.
//   Fix migration:    supabase/migrations/20260609000000_enable_rls_monthly_recaps.sql
//   Trigger restore:  supabase/migrations/20260609000001_create_ensure_rls_event_trigger.sql
//
// Companion to check-drift.mjs (schema shape) and check-rpcs.mjs (RPC presence):
// the baseline export captures per-table RLS-enable state but a green drift check
// only means "prod matches the committed baseline" — if a table is missing RLS in
// BOTH, drift stays green. This script asserts the absolute invariant directly.
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:check-rls
//   # dev: $env:SUPABASE_PROJECT_REF = "ddehmjucyfgyppfkbddr"; pnpm db:check-rls
//
// Exit 0 -> every public table has RLS enabled.
// Exit 1 -> at least one public table has RLS disabled.
// Exit 2 -> fatal (network, auth, etc.).

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

const URL_API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`

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
  // Ordinary ('r') and partitioned ('p') tables in the public schema with RLS
  // disabled. Views / materialized views / foreign tables are not subject to RLS
  // and are intentionally excluded.
  const sql = `
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = false
    ORDER BY c.relname
  `
  const rows = await query(sql)
  const without = rows.map((r) => r.table_name)

  if (without.length === 0) {
    console.error(`OK: every public table has RLS enabled (project ${PROJECT_REF}).`)
    process.exitCode = 0
    return
  }

  console.error(
    `RLS DISABLED: ${without.length} public table(s) without row level security (project ${PROJECT_REF}).`,
  )
  for (const name of without) {
    console.error(`  - ${name}`)
  }
  console.error('')
  console.error('This is the Supabase linter finding 0013_rls_disabled_in_public.')
  console.error('Anyone holding the public anon key can read/write these tables via PostgREST.')
  console.error('To resolve: add a migration with `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;`')
  console.error('(plus owner-scoped policies only if the browser/anon client reads the table).')
  console.error('Pattern: supabase/migrations/20260609000000_enable_rls_monthly_recaps.sql')
  process.exitCode = 1
}

// Use process.exitCode (not process.exit) so Node drains the undici keep-alive
// sockets cleanly. process.exit() while sockets are closing triggers a libuv
// assertion on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`).
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 2
})
