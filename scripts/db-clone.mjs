#!/usr/bin/env node
// Copie la base PROD dans DEV, à l'identique : toutes les tables de `public`
// et `snapshots`, les comptes de connexion (auth.users + auth.identities, mots
// de passe compris) et l'historique des migrations. Remplace clone-data.mjs
// (copie partielle, triggers actifs, lignes dev conservées).
//
// Garanties :
//   - la prod n'est lue qu'avec `read_only: true` (rôle supabase_read_only_user,
//     toute écriture refusée par Postgres) ; le client prod n'a pas d'écriture ;
//   - dev est remplacée en UNE transaction (tout ou rien), triggers coupés pour
//     que les lignes arrivent telles quelles ;
//   - dev est sauvegardée dans tmp/db-clone/ juste avant (restore pour revenir) ;
//   - chaque table est vérifiée après coup (nombre de lignes + empreinte md5).
//
// Usage :
//   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//   node scripts/db-clone.mjs preview
//   node scripts/db-clone.mjs apply --dry-run
//   node scripts/db-clone.mjs apply
//   node scripts/db-clone.mjs restore tmp/db-clone/dev-backup-<date>.json
//
// Les sessions dev sont supprimées avec les comptes : se reconnecter ensuite,
// avec le mot de passe de la PROD.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import {
  BUNDLE_FORMAT,
  CATALOG_SQL,
  CONFIRM_WORD,
  DEV_REF,
  MAX_PIECE_BYTES,
  PROD_REF,
  STRUCTURE_SQL,
  USAGE,
  accountOverlap,
  asJson,
  backupFileName,
  buildLoadSql,
  compareFingerprints,
  createApiClient,
  diffStructure,
  exportSql,
  formatCounts,
  groupCatalog,
  parseArgs,
  parseDryRunError,
  planCopy,
  splitUtf8,
  stagingCleanupSql,
  stagingInsertSql,
  stagingSetupSql,
} from './db-clone-lib.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = resolve(REPO_ROOT, 'tmp/db-clone')
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN

const prod = createApiClient(PROD_REF, { token: TOKEN })
const dev = createApiClient(DEV_REF, { token: TOKEN })

async function loadCatalog(client) {
  const rows = await client.read(CATALOG_SQL)
  const catalog = asJson(rows[0].catalog)
  return { tables: groupCatalog(catalog), userIds: catalog.userIds ?? [] }
}

async function loadStructure(client) {
  const rows = await client.read(STRUCTURE_SQL)
  return asJson(rows[0].structure) ?? {}
}

/** Lit chaque table du plan (lignes + empreinte) sur `client`, en lecture seule. */
async function exportTables(client, tables) {
  const out = []
  for (const t of tables) {
    const rows = await client.read(exportSql(t.name, t.columns))
    const r = rows[0]
    out.push({ name: t.name, columns: t.columns, rows: r.rows, checksum: r.checksum, data: r.data })
  }
  return out
}

function insertableColumns({ columns }) {
  return columns.filter((c) => !c.generated).map((c) => c.column)
}

/** Sauvegarde complète de dev (toutes colonnes hors générées). */
async function backupDev(catalog) {
  const tables = []
  for (const [name, entry] of catalog.tables)
    tables.push({ name, columns: insertableColumns(entry) })
  const exported = await exportTables(dev, tables)
  mkdirSync(BACKUP_DIR, { recursive: true })
  const path = resolve(BACKUP_DIR, backupFileName(new Date()))
  const bundle = { format: BUNDLE_FORMAT, project: DEV_REF, takenAt: new Date().toISOString() }
  writeFileSync(path, JSON.stringify({ ...bundle, tables: exported }))
  const rows = exported.reduce((sum, t) => sum + t.rows, 0)
  console.log(`💾 Sauvegarde de dev : ${path} (${exported.length} tables, ${rows} lignes)`)
  return path
}

/** Dépose les données dans le schéma de transit de dev, par morceaux. */
async function uploadStaging(exported) {
  await dev.write(stagingSetupSql())
  let requests = 0
  for (const t of exported) {
    const pieces = splitUtf8(t.data, MAX_PIECE_BYTES)
    for (let seq = 0; seq < pieces.length; seq++) {
      await dev.write(stagingInsertSql(t.name, seq, pieces[seq]))
      requests++
    }
  }
  console.log(`   ${requests} envoi(s) vers la zone de transit de dev.`)
}

/**
 * Remplace les données de dev par `exported`, puis vérifie table par table.
 * @returns {Promise<boolean>} true si tout est identique
 */
async function load(plan, exported, { dryRun }) {
  await uploadStaging(exported)
  const sql = buildLoadSql(plan, { dryRun })
  let actual
  try {
    const rows = await dev.write(sql)
    actual = asJson(rows[0].result)
  } catch (err) {
    const verified = dryRun ? parseDryRunError(err.dbMessage ?? '') : null
    if (!verified) throw err
    actual = verified
  } finally {
    // Après un --dry-run ou un échec, la transaction a été annulée et la zone
    // de transit est toujours là. Après un succès, elle a déjà disparu.
    await dev.write(stagingCleanupSql())
  }

  const expected = exported.map((t) => {
    const planned = plan.tables.find((p) => p.name === t.name)
    const sameColumns = planned && planned.columns.join(',') === t.columns.join(',')
    return { name: t.name, rows: t.rows, checksum: sameColumns ? t.checksum : null }
  })
  const results = compareFingerprints(expected, actual)
  console.log('')
  for (const r of results) {
    const mark = r.ok ? (r.checked ? '✅' : '☑️ ') : '❌'
    const note = r.ok && !r.checked ? '  (nombre de lignes seulement, colonnes différentes)' : ''
    console.log(`${mark} ${r.name.padEnd(40)} ${String(r.actual ?? '—').padStart(6)} lignes${note}`)
  }
  return results.every((r) => r.ok)
}

async function confirm(args, message) {
  if (args.confirm !== null) return args.confirm === CONFIRM_WORD
  if (!process.stdin.isTTY) {
    console.error(
      `Confirmation requise : taper ${CONFIRM_WORD} au clavier, ou --confirm=${CONFIRM_WORD}.`,
    )
    return false
  }
  console.log(message)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Tape ${CONFIRM_WORD} pour confirmer : `)
  rl.close()
  return answer.trim() === CONFIRM_WORD
}

function printList(title, lines) {
  if (lines.length === 0) return
  console.log(title)
  for (const l of lines) console.log(`  - ${l}`)
}

/** Aperçu prod → dev. Renvoie le plan et les données prod lues. */
async function previewProdToDev() {
  console.log(`Lecture de la prod (${PROD_REF}) en lecture seule…`)
  const [src, tgt, srcStructure, tgtStructure] = await Promise.all([
    loadCatalog(prod),
    loadCatalog(dev),
    loadStructure(prod),
    loadStructure(dev),
  ])
  const plan = planCopy(src.tables, tgt.tables, { createMissingTracker: true })
  const exported = await exportTables(prod, plan.tables)

  const names = [...new Set([...plan.tables.map((t) => t.name), ...plan.truncate])]
  const devCounts = await exportTables(
    dev,
    names
      .filter((name) => tgt.tables.has(name))
      .map((name) => ({ name, columns: insertableColumns(tgt.tables.get(name)) })),
  )
  console.log('')
  const counts = names.map((name) => ({
    name,
    source: exported.find((t) => t.name === name)?.rows ?? 0,
    target: devCounts.find((t) => t.name === name)?.rows ?? '—',
  }))
  for (const line of formatCounts(counts, { sourceLabel: 'prod', targetLabel: 'dev actuel' })) {
    console.log(line)
  }

  const overlap = accountOverlap(src.userIds, tgt.userIds)
  console.log('')
  console.log(
    `Comptes : ${src.userIds.length} en prod, dont ${overlap.shared} déjà en dev avec le même identifiant` +
      (overlap.onlyTarget > 0
        ? ` ; ${overlap.onlyTarget} compte(s) propre(s) à dev seront supprimés.`
        : '.'),
  )
  const structure = diffStructure(srcStructure, tgtStructure)
  console.log(
    structure.length === 0
      ? 'Structure (tables, fonctions, triggers, policies, droits, job cron) : identique.'
      : `⚠️  Structure : ${structure.length} différence(s) entre prod et dev.`,
  )
  printList('Détail :', structure.slice(0, 30))
  printList('⚠️  À savoir :', plan.warnings)
  printList('⛔ Bloquant :', plan.blockers)
  return { plan, exported, devCatalog: tgt }
}

async function apply(args) {
  const { plan, exported, devCatalog } = await previewProdToDev()
  console.log('')
  if (plan.blockers.length > 0) {
    process.exitCode = 1
    return
  }
  if (!args.dryRun) {
    const ok = await confirm(
      args,
      `⚠️  Toutes les données de DEV (${DEV_REF}) vont être remplacées par celles de la prod.`,
    )
    if (!ok) {
      console.log('Annulé, rien n’a été modifié.')
      return
    }
    await backupDev(devCatalog)
  }
  console.log(args.dryRun ? '🧪 Simulation sur dev (annulée à la fin)…' : '⏳ Copie vers dev…')
  const identical = await load(plan, exported, { dryRun: args.dryRun })
  console.log('')
  if (!identical) {
    process.exitCode = 1
    console.log('❌ Des tables diffèrent de la prod (voir ci-dessus).')
  } else if (args.dryRun) {
    console.log(
      '✅ Simulation réussie : la copie donnerait exactement la prod. Dev n’a pas été modifiée.',
    )
  } else {
    console.log('✅ Dev est maintenant une copie exacte de la prod.')
    console.log(
      '   Se reconnecter sur dev avec le mot de passe de la PROD (sessions dev supprimées).',
    )
  }
}

async function restore(args) {
  const bundle = JSON.parse(readFileSync(resolve(args.file), 'utf8'))
  if (bundle.format !== BUNDLE_FORMAT || bundle.project !== DEV_REF) {
    throw new Error(`${args.file} n’est pas une sauvegarde de dev (${BUNDLE_FORMAT}).`)
  }
  const source = new Map(
    bundle.tables.map((t) => [
      t.name,
      { columns: t.columns.map((column) => ({ column, generated: false })), constraints: [] },
    ]),
  )
  const devCatalog = await loadCatalog(dev)
  const plan = planCopy(source, devCatalog.tables)
  console.log(`Sauvegarde du ${bundle.takenAt} → DEV (${DEV_REF})`)
  printList('⚠️  À savoir :', plan.warnings)
  printList('⛔ Bloquant :', plan.blockers)
  if (plan.blockers.length > 0) {
    process.exitCode = 1
    return
  }
  if (!args.dryRun) {
    const ok = await confirm(args, `⚠️  Les données actuelles de DEV vont être remplacées.`)
    if (!ok) {
      console.log('Annulé, rien n’a été modifié.')
      return
    }
    await backupDev(devCatalog)
  }
  const exported = bundle.tables.filter((t) => plan.tables.some((p) => p.name === t.name))
  const identical = await load(plan, exported, { dryRun: args.dryRun })
  console.log('')
  if (!identical) process.exitCode = 1
  console.log(
    identical
      ? args.dryRun
        ? '✅ Simulation réussie. Dev n’a pas été modifiée.'
        : '✅ Dev est revenue à l’état de la sauvegarde.'
      : '❌ Des tables diffèrent de la sauvegarde (voir ci-dessus).',
  )
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

  if (args.command === 'preview') await previewProdToDev()
  else if (args.command === 'apply') await apply(args)
  else if (args.command === 'backup') await backupDev(await loadCatalog(dev))
  else await restore(args)
}

// process.exitCode plutôt que process.exit : laisse undici fermer ses sockets
// proprement (assertion libuv sous Windows sinon, cf. check-rpcs.mjs).
main().catch((err) => {
  console.error('FATAL:', err.dbMessage ?? err.message)
  process.exitCode = 1
})
