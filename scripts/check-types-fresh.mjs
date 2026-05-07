#!/usr/bin/env node
// Compare the committed lib/database.types.ts against what `supabase gen
// types typescript --linked --schema public` would produce against prod
// right now.
//
// Companion to scripts/check-drift.mjs — that script catches table/column/
// policy/index drift in the SQL baseline; this one catches the case where
// the schema changed in prod (via apply-sql.mjs or `supabase db push`)
// without `pnpm db:types` being run afterwards. Sprint Hygiene-CI / E2.
//
// Exit 0 -> identical. Exit 1 -> stale; a unified diff is printed to stdout.
// Exit 2 -> fatal (token missing, spawn error, file read error).
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:check-types-fresh

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES_PATH = resolve(REPO_ROOT, 'lib/database.types.ts')

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

// Tiny line-level unified diff. Mirror of scripts/check-drift.mjs:unifiedDiff
// (kept duplicated for now — refactor to a common module if a third callsite
// shows up).
function unifiedDiff(expected, actual) {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const out = []
  out.push('--- lib/database.types.ts (committed)')
  out.push('+++ supabase gen types --linked (live prod)')

  const max = Math.max(expectedLines.length, actualLines.length)
  let removed = 0
  let added = 0
  for (let i = 0; i < max; i++) {
    const e = expectedLines[i]
    const a = actualLines[i]
    if (e === a) continue
    if (e !== undefined) {
      out.push(`-${i + 1}: ${e}`)
      removed++
    }
    if (a !== undefined) {
      out.push(`+${i + 1}: ${a}`)
      added++
    }
  }
  out.push(`\nSummary: ${removed} line(s) only in committed file, ${added} line(s) only in live regen.`)
  return out.join('\n')
}

function genFreshTypes() {
  // shell:true is required on Windows so the `supabase` resolver picks up
  // the `.cmd` shim that pnpm/npm puts in node_modules/.bin. Args are
  // hardcoded so there's no injection surface.
  const result = spawnSync(
    'supabase gen types typescript --linked --schema public',
    {
      cwd: REPO_ROOT,
      shell: true,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    }
  )
  if (result.error) {
    throw new Error(`spawn failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `supabase gen types exited with ${result.status}\n${result.stderr ?? ''}`
    )
  }
  return result.stdout
}

function main() {
  const liveRaw = genFreshTypes()
  let committedRaw
  try {
    committedRaw = readFileSync(TYPES_PATH, 'utf8')
  } catch (err) {
    console.error(`ERROR: cannot read ${TYPES_PATH}: ${err.message}`)
    process.exitCode = 2
    return
  }

  // Normalize CRLF → LF on both sides. Supabase CLI on Windows can emit
  // CRLF; the on-disk file is LF post Sprint Hygiene-CI / E1 but a dev
  // with `core.autocrlf=true` locally could see CRLF in the working copy.
  // Normalize first, then trimEnd to absorb a trailing newline mismatch.
  const normalize = (s) => s.replace(/\r\n/g, '\n').trimEnd()
  const live = normalize(liveRaw)
  const committed = normalize(committedRaw)

  if (live === committed) {
    console.error('OK: lib/database.types.ts matches live `supabase gen types --linked`.')
    process.exitCode = 0
    return
  }

  console.error('STALE: lib/database.types.ts differs from what `supabase gen types --linked` produces now.')
  console.error('To resolve: run `pnpm db:types` and commit the regenerated file.')
  console.error('')
  process.stdout.write(unifiedDiff(committed, live) + '\n')
  process.exitCode = 1
}

// Synchronous flow (spawnSync, readFileSync) — no undici sockets to drain,
// but using process.exitCode for consistency with sibling scripts.
try {
  main()
} catch (err) {
  console.error('FATAL:', err.message)
  process.exitCode = 2
}
