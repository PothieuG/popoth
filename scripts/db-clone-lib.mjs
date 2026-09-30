// Helpers de scripts/db-clone.mjs : arguments, plan de copie, SQL généré,
// découpage des envois et mise en forme. Seule I/O : le client Management API
// (fetch injectable), gardé ici pour tester qu'il n'écrit jamais en prod.
// Tests : scripts/__tests__/db-clone-lib.test.ts.

import { DEV_REF, PROD_REF, sqlString } from './db-snapshot-lib.mjs'

export { DEV_REF, PROD_REF }

export const CONFIRM_WORD = 'ECRASER'
export const BUNDLE_FORMAT = 'popoth-db-clone/1'
export const STAGING_SCHEMA = 'zz_db_clone_staging'
export const DRY_RUN_MARKER = 'POPOTH_CLONE_DRY_RUN '

/** Tables vidées puis rechargées en entier. */
export const DATA_SCHEMAS = ['public', 'snapshots']
/** Comptes de connexion (mots de passe compris) : sessions et jetons restent hors copie. */
export const AUTH_TABLES = ['auth.users', 'auth.identities']
/** Historique des migrations (`supabase db push`), créé sur la cible s'il manque. */
export const TRACKER_SCHEMA = 'supabase_migrations'

/**
 * La Management API refuse une requête au-delà de ~2 Mo. Un morceau de 700 Ko
 * reste sous la limite même si l'échappement JSON du corps le double.
 */
export const MAX_PIECE_BYTES = 700_000
export const MAX_BODY_BYTES = 1_900_000

const COMMANDS = ['preview', 'apply', 'backup', 'restore']

export const USAGE = [
  'Usage :',
  '  node scripts/db-clone.mjs preview                aperçu prod → dev, rien n’est écrit',
  '  node scripts/db-clone.mjs apply [--dry-run]      dev devient une copie exacte de la prod',
  '  node scripts/db-clone.mjs backup                 sauvegarde dev dans tmp/db-clone/',
  '  node scripts/db-clone.mjs restore <fichier> [--dry-run]   remet dev dans l’état d’une sauvegarde',
  '',
  '--dry-run : tout est rejoué sur dev dans une transaction annulée à la fin.',
  `Sans clavier (CI, agent) : --confirm=${CONFIRM_WORD} remplace la confirmation tapée.`,
  `La prod (${PROD_REF}) n’est lue qu’en lecture seule ; seule dev (${DEV_REF}) est écrite.`,
].join('\n')

/**
 * @param {string[]} argv arguments après le nom du script
 * @returns {{ command: string, file: string | null, dryRun: boolean, confirm: string | null } | { error: string }}
 */
export function parseArgs(argv) {
  const flags = argv.filter((a) => a.startsWith('--'))
  const positional = argv.filter((a) => !a.startsWith('--'))
  const [command, file, ...rest] = positional

  if (!command) return { error: 'Commande manquante.' }
  if (!COMMANDS.includes(command)) return { error: `Commande inconnue : ${command}` }
  const unknown = flags.find((f) => f !== '--dry-run' && !f.startsWith('--confirm='))
  if (unknown) return { error: `Option inconnue : ${unknown}` }
  if (rest.length > 0) return { error: `Argument en trop : ${rest.join(' ')}` }

  const dryRun = flags.includes('--dry-run')
  const confirmFlag = flags.find((f) => f.startsWith('--confirm='))
  const writes = command === 'apply' || command === 'restore'
  if (dryRun && !writes) return { error: '--dry-run ne sert qu’avec apply ou restore.' }
  if (confirmFlag && (!writes || dryRun)) {
    return { error: '--confirm ne sert qu’avec apply ou restore, hors --dry-run.' }
  }
  if (command === 'restore' && !file) return { error: 'restore attend un fichier de sauvegarde.' }
  if (command !== 'restore' && file) return { error: `${command} ne prend pas d’argument.` }

  return {
    command,
    file: file ?? null,
    dryRun,
    confirm: confirmFlag ? confirmFlag.slice('--confirm='.length) : null,
  }
}

/**
 * Client Management API. `read` passe toujours `read_only: true` : Supabase
 * exécute alors la requête sous `supabase_read_only_user`, toute écriture est
 * refusée par la base. `write` refuse tout autre projet que dev.
 *
 * @param {string} ref
 * @param {{ token?: string, fetchImpl?: typeof fetch }} [options]
 */
export function createApiClient(ref, { token, fetchImpl = fetch } = {}) {
  async function send(sql, readOnly, attempt = 0) {
    const body = JSON.stringify({ query: sql, read_only: readOnly })
    const bytes = Buffer.byteLength(body)
    if (bytes > MAX_BODY_BYTES) throw new Error(`Requête trop grosse (${bytes} octets).`)
    let res
    try {
      res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      })
    } catch (err) {
      // Seules les lectures sont rejouées : une écriture perdue en route a
      // peut-être abouti, la rejouer à l'aveugle n'est pas sûr.
      if (readOnly && attempt < 3) return send(sql, readOnly, attempt + 1)
      throw err
    }
    const text = await res.text()
    if (res.status >= 500 && readOnly && attempt < 3) return send(sql, readOnly, attempt + 1)
    if (!res.ok) {
      const err = new Error(`Management API ${res.status} (${ref}) : ${text}`)
      err.dbMessage = decodeMessage(text)
      throw err
    }
    return JSON.parse(text)
  }

  return {
    ref,
    read: (sql) => send(sql, true),
    write: (sql) => {
      if (ref !== DEV_REF) {
        return Promise.reject(new Error(`Écriture refusée : seul dev (${DEV_REF}) est modifiable.`))
      }
      return send(sql, false)
    },
  }
}

/** Message Postgres contenu dans une réponse d'erreur de la Management API. */
function decodeMessage(text) {
  try {
    return String(JSON.parse(text).message ?? text)
  } catch {
    return text
  }
}

/** Identifiant SQL entre guillemets doubles. */
export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

/** « schema.table » → "schema"."table" */
export function qualified(name) {
  const [schema, table] = name.split('.')
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

/** Littéral dollar-quoted dont le délimiteur n'apparaît pas dans le texte. */
export function dollarQuote(text) {
  let n = 0
  while (text.includes(`$c${n}$`)) n++
  return `$c${n}$${text}$c${n}$`
}

/**
 * Découpe un texte en morceaux d'au plus `maxBytes` octets UTF-8, sans jamais
 * couper une paire de substitution (emoji dans une description, par exemple).
 */
export function splitUtf8(text, maxBytes) {
  const pieces = []
  let start = 0
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3
    if (bytes + size > maxBytes && i > start) {
      pieces.push(text.slice(start, i))
      start = i
      bytes = 0
    }
    bytes += size
    if (pair) i++
  }
  if (start < text.length || pieces.length === 0) pieces.push(text.slice(start))
  return pieces
}

/**
 * Réglages de session identiques des deux côtés : le texte des lignes (donc
 * l'empreinte) ne dépend plus du fuseau ni du format de date du serveur.
 */
const SESSION_SETTINGS = [
  "SET LOCAL TimeZone = 'UTC';",
  "SET LOCAL DateStyle = 'ISO, YMD';",
  "SET LOCAL IntervalStyle = 'postgres';",
  'SET LOCAL extra_float_digits = 3;',
].join('\n')

export const CATALOG_SQL = `
SELECT json_build_object(
  'columns', (
    SELECT coalesce(json_agg(json_build_object(
      'table', n.nspname || '.' || c.relname,
      'column', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'generated', a.attgenerated <> '',
      'identity', a.attidentity::text,
      'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid)
    ) ORDER BY n.nspname, c.relname, a.attnum), '[]')
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE c.relkind = 'r'
       AND (n.nspname IN ('public', 'snapshots', '${TRACKER_SCHEMA}')
            OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))
  ),
  'constraints', (
    SELECT coalesce(json_agg(json_build_object(
      'table', n.nspname || '.' || c.relname,
      'name', co.conname,
      'def', pg_get_constraintdef(co.oid)
    ) ORDER BY c.relname, co.conname), '[]')
      FROM pg_constraint co
      JOIN pg_class c ON c.oid = co.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = '${TRACKER_SCHEMA}' AND co.contype IN ('p', 'u', 'c')
  ),
  'userIds', (SELECT coalesce(json_agg(id::text ORDER BY id), '[]') FROM auth.users)
) AS catalog`

/**
 * Empreinte de la structure (hors données) de public et snapshots : colonnes,
 * contraintes, index, fonctions, triggers, policies, droits, job pg_cron.
 */
export const STRUCTURE_SQL = `
WITH s AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'snapshots'))
SELECT coalesce(json_object_agg(k, d ORDER BY k), '{}') AS structure FROM (
  SELECT 'colonne ' || s.nspname || '.' || c.relname || '.' || a.attname AS k,
         format_type(a.atttypid, a.atttypmod) || ' null=' || (NOT a.attnotnull)
           || ' default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '') AS d
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN s ON s.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'v', 'm', 'p')
  UNION ALL
  SELECT 'table ' || s.nspname || '.' || c.relname,
         c.relkind::text || ' rls=' || c.relrowsecurity || ' droits=' || coalesce(c.relacl::text, '')
    FROM pg_class c JOIN s ON s.oid = c.relnamespace WHERE c.relkind IN ('r', 'v', 'm', 'p', 'S')
  UNION ALL
  SELECT 'contrainte ' || s.nspname || '.' || cl.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
    FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN s ON s.oid = cl.relnamespace
  UNION ALL
  SELECT 'index ' || s.nspname || '.' || ci.relname, pg_get_indexdef(ci.oid)
    FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid JOIN s ON s.oid = ci.relnamespace
  UNION ALL
  SELECT 'fonction ' || s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(pg_get_functiondef(p.oid)) || ' droits=' || coalesce(p.proacl::text, '')
    FROM pg_proc p JOIN s ON s.oid = p.pronamespace WHERE p.prokind IN ('f', 'p')
  UNION ALL
  SELECT 'trigger ' || s.nspname || '.' || c.relname || '.' || t.tgname,
         pg_get_triggerdef(t.oid) || ' actif=' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN s ON s.oid = c.relnamespace
   WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy ' || schemaname || '.' || tablename || '.' || policyname,
         permissive || ' ' || array_to_string(roles, ',') || ' ' || cmd
           || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname IN ('public', 'snapshots')
  UNION ALL
  SELECT 'type ' || s.nspname || '.' || t.typname,
         t.typtype::text || ' ' || coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                               FROM pg_enum e WHERE e.enumtypid = t.oid), '')
    FROM pg_type t JOIN s ON s.oid = t.typnamespace
   WHERE t.typtype IN ('e', 'd', 'c') AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)
  UNION ALL
  SELECT 'job pg_cron ' || jobname, schedule || ' | ' || command || ' | actif=' || active FROM cron.job
) x`

/**
 * @param {{ columns: Array<Record<string, unknown>>, constraints?: Array<Record<string, unknown>> }} catalog
 * @returns {Map<string, { columns: Array<Record<string, unknown>>, constraints: Array<Record<string, unknown>> }>}
 */
export function groupCatalog(catalog) {
  const tables = new Map()
  const entry = (name) => {
    if (!tables.has(name)) tables.set(name, { columns: [], constraints: [] })
    return tables.get(name)
  }
  for (const col of catalog.columns ?? []) entry(col.table).columns.push(col)
  for (const con of catalog.constraints ?? []) entry(con.table).constraints.push(con)
  return tables
}

const schemaOf = (name) => name.split('.')[0]

/** Ordre de chargement : comptes, puis données, snapshots, historique des migrations. */
function sortTables(names) {
  const rank = (name) => {
    const auth = AUTH_TABLES.indexOf(name)
    if (auth >= 0) return auth
    const schema = schemaOf(name)
    if (schema === 'public') return 10
    if (schema === 'snapshots') return 20
    return 30
  }
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** CREATE TABLE pour une table de l'historique des migrations absente de la cible. */
export function createTableSql(name, { columns, constraints }) {
  const defs = columns.map((c) =>
    [
      quoteIdent(c.column),
      c.type,
      c.notNull ? 'NOT NULL' : null,
      c.default ? `DEFAULT ${c.default}` : null,
    ]
      .filter(Boolean)
      .join(' '),
  )
  for (const con of constraints) defs.push(`CONSTRAINT ${quoteIdent(con.name)} ${con.def}`)
  return `CREATE TABLE IF NOT EXISTS ${qualified(name)} (\n  ${defs.join(',\n  ')}\n);`
}

/**
 * Plan de copie source → cible.
 *
 * - public / snapshots : toutes les tables de la cible sont vidées, celles de la
 *   source rechargées. Une table absente de la cible bloque (migrations à passer).
 * - auth.users / auth.identities : comptes remplacés (sessions supprimées en cascade).
 * - supabase_migrations : recopié, et créé sur la cible s'il manque (si la
 *   source fournit ses contraintes, c.-à-d. copie depuis la prod).
 *
 * Les colonnes copiées sont celles de la source qui existent sur la cible, hors
 * colonnes générées. Les écarts sont signalés, pas masqués.
 *
 * @returns {{ tables: Array<{ name: string, columns: string[], overriding: boolean, sequences: Array<{ sequence: string, column: string }>, createSql: string | null }>, truncate: string[], blockers: string[], warnings: string[] }}
 */
export function planCopy(source, target, { createMissingTracker = false } = {}) {
  const tables = []
  const blockers = []
  const warnings = []

  for (const name of sortTables(source.keys())) {
    const schema = schemaOf(name)
    const inScope =
      DATA_SCHEMAS.includes(schema) || AUTH_TABLES.includes(name) || schema === TRACKER_SCHEMA
    if (!inScope) continue
    const src = source.get(name)
    const tgt = target.get(name)
    const srcCols = src.columns.filter((c) => !c.generated)

    if (!tgt) {
      if (schema === TRACKER_SCHEMA && createMissingTracker) {
        tables.push({
          name,
          columns: srcCols.map((c) => c.column),
          overriding: false,
          sequences: [],
          createSql: createTableSql(name, src),
        })
        warnings.push(`${name} absente de dev : créée à l’identique de la prod.`)
      } else if (schema === TRACKER_SCHEMA) {
        warnings.push(`${name} absente de dev : historique des migrations non restauré.`)
      } else {
        blockers.push(
          `${name} existe côté source mais pas sur dev : passer les migrations sur dev.`,
        )
      }
      continue
    }

    const tgtByName = new Map(tgt.columns.map((c) => [c.column, c]))
    const columns = []
    const dropped = []
    for (const col of srcCols) {
      const t = tgtByName.get(col.column)
      if (!t) {
        dropped.push(col.column)
        continue
      }
      if (t.generated) continue
      if (col.type && t.type !== col.type) {
        warnings.push(`${name}.${col.column} : type ${col.type} côté source, ${t.type} sur dev.`)
      }
      columns.push(col.column)
    }
    const kept = new Set(columns)
    const srcNames = new Set(srcCols.map((c) => c.column))
    const onlyTarget = tgt.columns.filter((c) => !c.generated && !srcNames.has(c.column))
    if (dropped.length > 0) {
      warnings.push(`${name} : colonnes absentes de dev, non copiées : ${dropped.join(', ')}.`)
    }
    if (onlyTarget.length > 0) {
      warnings.push(
        `${name} : colonnes seulement sur dev, remplies par défaut : ${onlyTarget.map((c) => c.column).join(', ')}.`,
      )
    }

    const sequences = []
    for (const col of tgt.columns) {
      const m = /^nextval\('([^']+)'::regclass\)$/.exec(col.default ?? '')
      if (m && kept.has(col.column)) sequences.push({ sequence: m[1], column: col.column })
    }
    tables.push({
      name,
      columns,
      overriding: tgt.columns.some((c) => c.identity === 'a' && kept.has(c.column)),
      sequences,
      createSql: null,
    })
  }

  const loaded = new Set(tables.map((t) => t.name))
  const truncate = []
  for (const name of sortTables(target.keys())) {
    const schema = schemaOf(name)
    if (DATA_SCHEMAS.includes(schema)) {
      truncate.push(name)
      if (!loaded.has(name)) warnings.push(`${name} n’existe que sur dev : elle sera vidée.`)
    } else if (schema === TRACKER_SCHEMA && loaded.has(name)) {
      truncate.push(name)
    }
  }
  for (const t of tables) {
    if (t.createSql) truncate.push(t.name)
  }

  return { tables, truncate, blockers, warnings }
}

/**
 * Nombre de lignes + empreinte md5 d'une table sur des colonnes données
 * (+ les lignes en JSON si `withData`). Même requête des deux côtés : les
 * empreintes source et cible sont comparables.
 */
export function fingerprintSelect(name, columns, { withData = false } = {}) {
  const cols = columns.map(quoteIdent).join(', ')
  const data = withData ? ",\n       coalesce(json_agg(r), '[]')::text AS data" : ''
  return `SELECT count(*)::int AS rows,
       md5(coalesce(string_agg(r::text, E'\\n' ORDER BY r::text COLLATE "C"), '')) AS checksum${data}
  FROM (SELECT ${cols} FROM ${qualified(name)}) r`
}

/** Export d'une table (lignes + empreinte), à lancer en lecture seule. */
export function exportSql(name, columns) {
  return `${SESSION_SETTINGS}\n${fingerprintSelect(name, columns, { withData: true })}`
}

export function stagingSetupSql() {
  return [
    `DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE;`,
    `CREATE SCHEMA ${STAGING_SCHEMA};`,
    `CREATE TABLE ${STAGING_SCHEMA}.chunks (tbl text NOT NULL, seq int NOT NULL, piece text NOT NULL, PRIMARY KEY (tbl, seq));`,
  ].join('\n')
}

export function stagingCleanupSql() {
  return `DROP SCHEMA IF EXISTS ${STAGING_SCHEMA} CASCADE;`
}

/** Idempotent : un envoi rejoué remplace le morceau au lieu d'échouer. */
export function stagingInsertSql(name, seq, piece) {
  return `INSERT INTO ${STAGING_SCHEMA}.chunks (tbl, seq, piece) VALUES (${sqlString(name)}, ${seq}, ${dollarQuote(piece)})
ON CONFLICT (tbl, seq) DO UPDATE SET piece = EXCLUDED.piece;`
}

function insertSql({ name, columns, overriding }) {
  const cols = columns.map(quoteIdent).join(', ')
  const payload = `(SELECT string_agg(piece, '' ORDER BY seq) FROM ${STAGING_SCHEMA}.chunks WHERE tbl = ${sqlString(name)})::json`
  return `INSERT INTO ${qualified(name)} (${cols})${overriding ? ' OVERRIDING SYSTEM VALUE' : ''}
SELECT ${cols} FROM json_populate_recordset(NULL::${qualified(name)}, ${payload});`
}

function verifySql(tables) {
  const parts = tables.map(
    ({ name, columns }) => `SELECT ${sqlString(name)} AS t, (
  SELECT json_build_object('rows', f.rows, 'checksum', f.checksum)
    FROM (${fingerprintSelect(name, columns)}) f
) AS v`,
  )
  return `SELECT json_object_agg(t, v) AS result FROM (\n${parts.join('\nUNION ALL\n')}\n) s`
}

/**
 * Remplacement atomique de la cible par les données déposées dans le schéma de
 * transit : une seule transaction, tout ou rien. Les triggers sont coupés
 * pendant le chargement (session_replication_role = replica) : les lignes
 * arrivent telles quelles, sans recalcul ni ligne miroir créée en double.
 * En --dry-run, la transaction se termine par une exception qui porte le
 * résultat de la vérification : rien n'est conservé.
 */
export function buildLoadSql(plan, { dryRun }) {
  const lines = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", SESSION_SETTINGS]
  const created = plan.tables.filter((t) => t.createSql)
  if (created.length > 0) lines.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(TRACKER_SCHEMA)};`)
  for (const t of created) lines.push(t.createSql)
  // TRUNCATE ne déclenche aucun trigger ligne. Les tables publiques sont vidées
  // avant les comptes pour que la cascade auth.users → profiles ne touche rien.
  if (plan.truncate.length > 0) {
    lines.push(`TRUNCATE TABLE ${plan.truncate.map(qualified).join(', ')};`)
  }
  if (plan.tables.some((t) => t.name === 'auth.users')) {
    // Cascade native vers identities, sessions, refresh_tokens, facteurs MFA…
    lines.push('DELETE FROM auth.users;')
  }
  lines.push('SET LOCAL session_replication_role = replica;')
  for (const t of plan.tables) lines.push(insertSql(t))
  lines.push('SET LOCAL session_replication_role = origin;')
  for (const t of plan.tables) {
    for (const s of t.sequences) {
      const col = quoteIdent(s.column)
      lines.push(
        `SELECT setval(${sqlString(s.sequence)}, coalesce((SELECT max(${col}) FROM ${qualified(t.name)}), 1), (SELECT max(${col}) FROM ${qualified(t.name)}) IS NOT NULL);`,
      )
    }
  }
  lines.push(`DROP SCHEMA ${STAGING_SCHEMA} CASCADE;`)
  const verify = verifySql(plan.tables)
  if (dryRun) {
    lines.push(`DO $dry$ BEGIN RAISE EXCEPTION '${DRY_RUN_MARKER}%', (${verify})::text; END $dry$;`)
  } else {
    lines.push(`${verify};`, 'COMMIT;')
  }
  return lines.join('\n')
}

/**
 * Extrait la vérification portée par l'exception d'un --dry-run.
 * @param {string} message message d'erreur Postgres (déjà décodé)
 */
export function parseDryRunError(message) {
  const start = message.indexOf(DRY_RUN_MARKER)
  if (start < 0) return null
  const rest = message.slice(start + DRY_RUN_MARKER.length)
  return JSON.parse(rest.slice(0, rest.lastIndexOf('}') + 1))
}

/** Le Management API peut renvoyer un json déjà parsé ou en chaîne. */
export function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value
}

/**
 * Compare les empreintes attendues (source) et obtenues (cible).
 * @param {Array<{ name: string, rows: number, checksum: string | null }>} expected
 * @param {Record<string, { rows: number, checksum: string }>} actual
 */
export function compareFingerprints(expected, actual) {
  return expected.map((e) => {
    const a = actual[e.name]
    const ok = Boolean(a) && a.rows === e.rows && (e.checksum === null || a.checksum === e.checksum)
    return {
      name: e.name,
      expected: e.rows,
      actual: a?.rows ?? null,
      ok,
      checked: e.checksum !== null,
    }
  })
}

/** Différences de structure entre deux empreintes STRUCTURE_SQL. */
export function diffStructure(source, target) {
  const lines = []
  for (const [k, v] of Object.entries(source)) {
    if (!(k in target)) lines.push(`seulement côté source : ${k}`)
    else if (target[k] !== v) lines.push(`différent : ${k}`)
  }
  for (const k of Object.keys(target)) {
    if (!(k in source)) lines.push(`seulement sur dev : ${k}`)
  }
  return lines
}

const TABLE_LABELS = {
  'auth.users': 'comptes de connexion',
  'auth.identities': 'identités de connexion',
}

/** Tableau « table / source / dev ». */
export function formatCounts(rows, { sourceLabel, targetLabel }) {
  const label = (name) => (TABLE_LABELS[name] ? `${name} (${TABLE_LABELS[name]})` : name)
  const width = Math.max('Table'.length, ...rows.map((r) => label(r.name).length))
  const line = (a, b, c) =>
    `${a.padEnd(width)}  ${String(b).padStart(10)}  ${String(c).padStart(10)}`
  return [
    line('Table', sourceLabel, targetLabel),
    ...rows.map((r) => line(label(r.name), r.source ?? '—', r.target ?? '—')),
  ]
}

/** Comptes source déjà présents en dev avec le même identifiant. */
export function accountOverlap(sourceIds, targetIds) {
  const target = new Set(targetIds)
  const shared = sourceIds.filter((id) => target.has(id)).length
  return {
    shared,
    onlySource: sourceIds.length - shared,
    onlyTarget: targetIds.length - shared,
  }
}

/** Nom de fichier de sauvegarde horodaté (UTC, sans « : » pour Windows). */
export function backupFileName(date) {
  return `dev-backup-${date.toISOString().replace(/[:.]/g, '-')}.json`
}
