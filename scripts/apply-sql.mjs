#!/usr/bin/env node
// Apply an arbitrary SQL file against the linked Supabase project via the
// Management API. Useful for ad-hoc fixes when `supabase db push` cannot be
// used (e.g. re-running a migration whose schema_migrations row exists but
// whose SQL never actually executed against the remote — drift recovery).
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   node scripts/apply-sql.mjs <path-to-sql-file>

import { readFileSync } from 'node:fs'

const PROJECT = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const FILE = process.argv[2]

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(1)
}
if (!FILE) {
  console.error('ERROR: pass a path to a .sql file as the first argument.')
  process.exit(1)
}

const sql = readFileSync(FILE, 'utf8')
console.error(`Applying ${FILE} (${sql.length} bytes) to project ${PROJECT}...`)

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
})

const body = await res.text()
console.error(`HTTP ${res.status}`)
process.stdout.write(body + '\n')
if (!res.ok) process.exit(1)
