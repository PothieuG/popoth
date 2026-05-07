#!/usr/bin/env node
// Sprint Audit-Functions-v2 / B1.
// Generic audit: list every public.* function in prod (pg_proc) and confirm
// each has a `CREATE FUNCTION` (or `CREATE OR REPLACE FUNCTION`) statement
// somewhere under supabase/migrations/.
//
// Why a separate detector vs scripts/check-trigger-functions.mjs:
//   - check-trigger-functions.mjs pins a hardcoded list of 4 names (the
//     functions captured by Sprint Audit-Triggers / A2). A function not on
//     that list escapes the net entirely. That is exactly how
//     `calculate_group_contributions` would have stayed invisible during A2
//     if the wrappers' bodies hadn't been read manually.
//   - This script enumerates pg_proc instead — anything in prod's public
//     schema that doesn't appear in any migration file is flagged.
//
// Not added to the weekly cron (heavier than check-functions). Run after any
// migration touching a PL/pgSQL function. CLAUDE.md §8 documents this.
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:audit-functions
//
// Exit 0 -> every public.* function in pg_proc is referenced by at least one
//           migration file.
// Exit 1 -> at least one prod function has no CREATE FUNCTION statement in
//           supabase/migrations/.
// Exit 2 -> fatal (network, auth, etc.).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

const URL_API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
const MIGRATIONS_DIR = 'supabase/migrations'

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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function loadMigrationCorpus() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
  const parts = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  return { files, corpus: parts.join('\n') }
}

function isVersioned(name, corpus) {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${escapeRegex(name)}\\b`,
    'i'
  )
  return re.test(corpus)
}

async function main() {
  const sql = `
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
    ORDER BY p.proname
  `
  const rows = await query(sql)
  const protocolNames = rows.map((r) => r.proname)

  const { files, corpus } = loadMigrationCorpus()
  console.error(
    `Scanned ${files.length} migration files for ${protocolNames.length} public.* function(s) in pg_proc.`
  )

  const report = protocolNames.map((name) => ({
    name,
    in_pg_proc: true,
    in_migrations: isVersioned(name, corpus),
  }))

  // Print the table to stdout so it can be piped/redirected for audits.
  const nameWidth = Math.max(4, ...report.map((r) => r.name.length))
  const header = `${'name'.padEnd(nameWidth)}  in_pg_proc  in_migrations`
  process.stdout.write(header + '\n')
  process.stdout.write('-'.repeat(header.length) + '\n')
  for (const r of report) {
    process.stdout.write(
      `${r.name.padEnd(nameWidth)}  ${String(r.in_pg_proc).padEnd(10)}  ${r.in_migrations}\n`
    )
  }

  const missing = report.filter((r) => !r.in_migrations).map((r) => r.name)

  if (missing.length === 0) {
    console.error(`\nOK: every public.* function in pg_proc is versioned.`)
    process.exitCode = 0
    return
  }

  console.error(
    `\nMISSING_FROM_MIGRATIONS: ${missing.length} function(s) exist in prod but have no CREATE FUNCTION in supabase/migrations/:`
  )
  for (const name of missing) console.error(`  - ${name}`)
  console.error('')
  console.error('To capture retroactively (Sprint Audit-Triggers / A2 pattern, see CLAUDE.md §8):')
  console.error('  1. Dump the body via scripts/dump-functions.sql (extend the IN list).')
  console.error('  2. Paste verbatim into a new <TS>_capture_<name>.sql migration.')
  console.error('  3. node scripts/apply-sql.mjs <migration> (idempotent CREATE OR REPLACE).')
  console.error('  4. pnpm supabase migration repair --status applied <TS>')
  console.error('  5. Re-run pnpm db:audit-functions to confirm exit 0.')
  process.exitCode = 1
}

// Use process.exitCode (not process.exit) so Node drains the undici keep-alive
// sockets cleanly. process.exit() while sockets are closing triggers a libuv
// assertion on Windows.
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 2
})
