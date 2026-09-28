#!/usr/bin/env node
// Snapshots de la base : consulter, prendre, prévisualiser, restaurer.
// Sprint Monthly-DB-Snapshot (2026-09-28) — migration
// supabase/migrations/20260928000000_create_monthly_db_snapshots.sql.
//
// Le job pg_cron prend un snapshot le dernier jour de chaque mois à 23h45
// (heure de Paris). Si un Monthly Recap casse les données, `restore` remet
// TOUTE l'appli dans l'état du snapshot : tout ce qui a été saisi depuis est
// perdu (l'aperçu le liste avant de demander confirmation). Un snapshot de
// sécurité est pris juste avant chaque restauration, pour pouvoir l'annuler.
//
// Usage :
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   node scripts/db-snapshot.mjs list
//   node scripts/db-snapshot.mjs preview 2026-09
//   node scripts/db-snapshot.mjs restore 2026-09
//   # dev : $env:SUPABASE_PROJECT_REF = "ddehmjucyfgyppfkbddr"
//
// Passe par la Management API (rôle propriétaire) : le schéma `snapshots`
// n'est exposé ni à PostgREST ni à la clé service_role de l'appli.

import { createInterface } from 'node:readline/promises'

import {
  CONFIRM_WORD,
  PROD_REF,
  USAGE,
  afterRestoreNotes,
  asJson,
  formatParis,
  formatPreview,
  formatSnapshotList,
  parseArgs,
  parseSelector,
  projectLabel,
  selectorWhere,
  sqlString,
} from './db-snapshot-lib.mjs'

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? PROD_REF
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
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
  const body = await res.text()
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body}`)
  return JSON.parse(body)
}

async function resolveSnapshot(raw) {
  const selector = parseSelector(raw)
  if (!selector) throw new Error(`Snapshot invalide : « ${raw} » (attendu AAAA-MM ou identifiant).`)
  const rows = await query(`SELECT id FROM snapshots.db_snapshots WHERE ${selectorWhere(selector)}`)
  const id = rows[0]?.id
  if (!id)
    throw new Error(
      `Aucun snapshot trouvé pour « ${raw} ». Voir : node scripts/db-snapshot.mjs list`,
    )
  return id
}

async function loadPreview(id) {
  const rows = await query(`SELECT snapshots.preview_restore(${sqlString(id)}::uuid) AS preview`)
  return asJson(rows[0].preview)
}

async function list() {
  const rows = await query(
    `SELECT id, kind, period_year, period_month, taken_at, note, table_counts, restored_at
       FROM snapshots.db_snapshots
      ORDER BY taken_at DESC`,
  )
  for (const line of formatSnapshotList(rows)) console.log(line)
}

async function status() {
  const jobs = await query(
    `SELECT jobid, schedule, command, active FROM cron.job WHERE jobname = 'popoth-month-end-snapshot'`,
  )
  const job = jobs[0]
  if (!job) {
    console.log('⛔ Job planifié absent : la migration 20260928000000 n’est pas appliquée ici.')
  } else {
    console.log(`Job planifié : ${job.schedule}  ${job.active ? 'actif' : '⛔ INACTIF'}`)
    const runs = await query(
      `SELECT status, return_message, start_time
         FROM cron.job_run_details
        WHERE jobid = ${Number(job.jobid)}
        ORDER BY start_time DESC
        LIMIT 8`,
    )
    if (runs.length === 0) console.log('Aucune exécution pour l’instant.')
    for (const r of runs) {
      console.log(`  ${formatParis(r.start_time)}  ${r.status}  ${r.return_message ?? ''}`)
    }
  }

  const last = await query(
    `SELECT period_year, period_month, taken_at FROM snapshots.db_snapshots
      WHERE kind = 'month_end' ORDER BY period_year DESC, period_month DESC LIMIT 1`,
  )
  console.log(
    last[0]
      ? `Dernier snapshot de fin de mois : ${String(last[0].period_month).padStart(2, '0')}/${last[0].period_year} (pris le ${formatParis(last[0].taken_at)})`
      : 'Aucun snapshot de fin de mois pour l’instant.',
  )

  const uncovered = await query(`SELECT to_jsonb(snapshots.uncovered_tables()) AS t`)
  const tables = asJson(uncovered[0].t) ?? []
  console.log(
    tables.length === 0
      ? 'Toutes les tables publiques sont couvertes.'
      : `⚠️  Tables publiques hors snapshot : ${tables.join(', ')} (à déclarer dans la migration)`,
  )
}

async function take(note) {
  const rows = await query(
    `SELECT snapshots.take_db_snapshot('manual', ${note ? sqlString(note) : 'NULL'}) AS id`,
  )
  console.log(`✅ Snapshot manuel pris : ${rows[0].id}`)
}

async function preview(raw) {
  const id = await resolveSnapshot(raw)
  for (const line of formatPreview(await loadPreview(id))) console.log(line)
}

async function restore(raw) {
  const id = await resolveSnapshot(raw)
  const before = await loadPreview(id)
  for (const line of formatPreview(before)) console.log(line)
  console.log('')

  if ((before.blockers ?? []).length > 0) {
    process.exitCode = 1
    return
  }
  if (!process.stdin.isTTY) {
    console.error('Restauration refusée : une confirmation tapée au clavier est obligatoire.')
    process.exitCode = 1
    return
  }

  console.log(`⚠️  Projet : ${projectLabel(PROJECT_REF)}`)
  console.log('⚠️  TOUTE l’appli revient à l’état ci-dessus, pour tous les utilisateurs.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Tape ${CONFIRM_WORD} pour confirmer : `)
  rl.close()
  if (answer.trim() !== CONFIRM_WORD) {
    console.log('Annulé, rien n’a été modifié.')
    return
  }

  const rows = await query(`SELECT snapshots.restore_db_snapshot(${sqlString(id)}::uuid) AS result`)
  const result = asJson(rows[0].result)
  console.log('')
  console.log('✅ Restauration terminée.')
  for (const line of afterRestoreNotes(before, result.pre_restore_snapshot_id)) console.log(line)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if ('error' in args) {
    console.error(`${args.error}\n\n${USAGE}`)
    process.exitCode = 1
    return
  }
  if (!TOKEN) {
    console.error('ERROR: set $env:SUPABASE_ACCESS_TOKEN before running.')
    process.exitCode = 1
    return
  }
  console.error(`Projet : ${projectLabel(PROJECT_REF)}\n`)

  if (args.command === 'list') await list()
  else if (args.command === 'status') await status()
  else if (args.command === 'take') await take(args.note)
  else if (args.command === 'preview') await preview(args.selector)
  else await restore(args.selector)
}

// process.exitCode plutôt que process.exit : laisse undici fermer ses sockets
// proprement (assertion libuv sous Windows sinon, cf. check-rpcs.mjs).
main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exitCode = 1
})
