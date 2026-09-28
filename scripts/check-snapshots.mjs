#!/usr/bin/env node
// Verify the month-end DB snapshot machinery is in place and actually runs.
// Sprint Monthly-DB-Snapshot (2026-09-28) —
// supabase/migrations/20260928000000_create_monthly_db_snapshots.sql.
//
// The `snapshots` schema sits outside `public`, so check-drift / check-rpcs /
// audit-functions never look at it. A pg_cron job that silently stopped would
// only surface on the day a restore is needed. This script asserts:
//   1. every snapshots.* function is present;
//   2. the pg_cron job exists, is active, with the expected schedule/command;
//   3. no public table escapes the snapshot (snapshots.uncovered_tables());
//   4. once a first month-end snapshot exists, the one for the month that just
//      ended (Europe/Paris) exists too — i.e. the job really ran.
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   pnpm db:check-snapshots
//   # dev: $env:SUPABASE_PROJECT_REF = "ddehmjucyfgyppfkbddr"; pnpm db:check-snapshots
//
// Exit 0 -> all good. Exit 1 -> at least one check failed. Exit 2 -> fatal.

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

if (!TOKEN) {
  console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
  process.exit(2)
}

const URL_API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
const MIGRATION_PATH = 'supabase/migrations/20260928000000_create_monthly_db_snapshots.sql'

const EXPECTED_FUNCTIONS = [
  'owner_label',
  'preview_restore',
  'purge_old_snapshots',
  'restorable_tables',
  'restore_blockers',
  'restore_db_snapshot',
  'snapshot_rows',
  'take_db_snapshot',
  'take_month_end_snapshot',
  'uncovered_tables',
]
const JOB_NAME = 'popoth-month-end-snapshot'
const JOB_SCHEDULE = '45 21,22 28-31 * *'
const JOB_COMMAND = 'SELECT snapshots.take_month_end_snapshot()'

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
  const failures = []

  const fnRows = await query(`
    SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'snapshots'
  `)
  const found = new Set(fnRows.map((r) => r.proname))
  const missing = EXPECTED_FUNCTIONS.filter((name) => !found.has(name))
  if (missing.length > 0) {
    failures.push(`missing snapshots.* function(s): ${missing.join(', ')}`)
    // Nothing below can run without the functions.
    report(failures, true)
    return
  }

  const jobs = await query(
    `SELECT schedule, command, active FROM cron.job WHERE jobname = '${JOB_NAME}'`,
  )
  const job = jobs[0]
  const jobBroken = !job || !job.active || job.schedule !== JOB_SCHEDULE
  if (!job) {
    failures.push(`pg_cron job '${JOB_NAME}' not found`)
  } else {
    if (!job.active) failures.push(`pg_cron job '${JOB_NAME}' is inactive`)
    if (job.schedule !== JOB_SCHEDULE) {
      failures.push(`pg_cron job schedule is '${job.schedule}', expected '${JOB_SCHEDULE}'`)
    }
    if (job.command.trim() !== JOB_COMMAND) {
      failures.push(`pg_cron job command is '${job.command}', expected '${JOB_COMMAND}'`)
    }
  }

  const [uncovered] = await query(`SELECT to_jsonb(snapshots.uncovered_tables()) AS tables`)
  const tables =
    typeof uncovered.tables === 'string' ? JSON.parse(uncovered.tables) : uncovered.tables
  if (tables.length > 0) {
    failures.push(
      `public table(s) outside the snapshot: ${tables.join(', ')} — add them to ` +
        `snapshots.restorable_tables() (FK order) or to the exclusions of snapshots.uncovered_tables()`,
    )
  }

  const [freshness] = await query(`
    WITH prev AS (
      SELECT (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '1 month') AS m
    )
    SELECT
      EXISTS (SELECT 1 FROM snapshots.db_snapshots WHERE kind = 'month_end') AS any_month_end,
      EXISTS (
        SELECT 1 FROM snapshots.db_snapshots, prev
         WHERE kind = 'month_end'
           AND period_year = EXTRACT(YEAR FROM prev.m)
           AND period_month = EXTRACT(MONTH FROM prev.m)
      ) AS previous_month_taken,
      to_char((SELECT m FROM prev), 'MM/YYYY') AS previous_month
  `)
  if (!freshness.any_month_end) {
    console.error('INFO: no month-end snapshot yet (first one comes at the end of this month).')
  } else if (!freshness.previous_month_taken) {
    failures.push(
      `month-end snapshot for ${freshness.previous_month} is missing — the job did not run. ` +
        `Inspect: node scripts/db-snapshot.mjs status`,
    )
  }

  report(failures, jobBroken || job.command.trim() !== JOB_COMMAND)
}

function report(failures, reapply = false) {
  if (failures.length === 0) {
    console.error(`OK: month-end snapshots in place (project ${PROJECT_REF}).`)
    process.exitCode = 0
    return
  }
  console.error(`SNAPSHOT CHECK FAILED (project ${PROJECT_REF}):`)
  for (const f of failures) console.error(`  - ${f}`)
  if (reapply) {
    console.error('')
    console.error(`Source: ${MIGRATION_PATH}`)
    console.error(`Recovery: node scripts/apply-sql.mjs ${MIGRATION_PATH} (idempotent)`)
  }
  process.exitCode = 1
}

// Use process.exitCode (not process.exit) so Node drains the undici keep-alive
// sockets cleanly. process.exit() while sockets are closing triggers a libuv
// assertion on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`).
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 2
})
