import { describe, expect, it, vi } from 'vitest'

import {
  CONFIRM_WORD,
  DEV_REF,
  DRY_RUN_MARKER,
  PROD_REF,
  STAGING_SCHEMA,
  accountOverlap,
  backupFileName,
  buildLoadSql,
  compareFingerprints,
  createApiClient,
  createTableSql,
  diffStructure,
  dollarQuote,
  formatCounts,
  groupCatalog,
  parseArgs,
  parseDryRunError,
  planCopy,
  qualified,
  splitUtf8,
  stagingInsertSql,
} from '../db-clone-lib.mjs'

type Col = {
  column: string
  type?: string
  generated?: boolean
  identity?: string
  notNull?: boolean
  default?: string | null
}

function catalog(tables: Record<string, Col[]>) {
  const columns = Object.entries(tables).flatMap(([table, cols]) =>
    cols.map((c) => ({ generated: false, identity: '', type: 'text', ...c, table })),
  )
  return groupCatalog({ columns, constraints: [] })
}

function okFetch(body: unknown = []) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }))
}

describe('parseArgs', () => {
  it('accepte les 4 commandes et leurs options', () => {
    expect(parseArgs(['preview'])).toEqual({
      command: 'preview',
      file: null,
      dryRun: false,
      confirm: null,
    })
    expect(parseArgs(['apply', '--dry-run'])).toMatchObject({ command: 'apply', dryRun: true })
    expect(parseArgs(['apply', `--confirm=${CONFIRM_WORD}`])).toMatchObject({
      confirm: CONFIRM_WORD,
    })
    expect(parseArgs(['restore', 'f.json'])).toMatchObject({ command: 'restore', file: 'f.json' })
    expect(parseArgs(['backup'])).toMatchObject({ command: 'backup' })
  })

  it('refuse les usages ambigus', () => {
    expect(parseArgs([])).toHaveProperty('error')
    expect(parseArgs(['push'])).toHaveProperty('error')
    expect(parseArgs(['restore'])).toHaveProperty('error')
    expect(parseArgs(['apply', 'f.json'])).toHaveProperty('error')
    expect(parseArgs(['preview', '--dry-run'])).toHaveProperty('error')
    expect(parseArgs(['apply', '--dry-run', '--confirm=ECRASER'])).toHaveProperty('error')
    expect(parseArgs(['apply', '--force'])).toHaveProperty('error')
  })
})

describe('createApiClient — la prod n’est jamais écrite', () => {
  it('lit toujours en read_only', async () => {
    const fetchImpl = okFetch([{ ok: 1 }])
    const client = createApiClient(PROD_REF, { token: 't', fetchImpl })
    await expect(client.read('SELECT 1')).resolves.toEqual([{ ok: 1 }])
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toContain(PROD_REF)
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'SELECT 1', read_only: true })
  })

  it('refuse toute écriture hors dev, sans appel réseau', async () => {
    const fetchImpl = okFetch()
    const client = createApiClient(PROD_REF, { token: 't', fetchImpl })
    await expect(client.write('DELETE FROM x')).rejects.toThrow(/Écriture refusée/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('écrit sur dev sans read_only', async () => {
    const fetchImpl = okFetch()
    await createApiClient(DEV_REF, { token: 't', fetchImpl }).write('SELECT 1')
    const init = fetchImpl.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body)).read_only).toBe(false)
  })

  it('rejoue une lecture après une erreur 5xx, jamais une écriture', async () => {
    const flaky = () =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('boom', { status: 502 }))
        .mockResolvedValue(new Response('[]', { status: 200 }))
    const readFetch = flaky()
    await createApiClient(DEV_REF, { token: 't', fetchImpl: readFetch }).read('SELECT 1')
    expect(readFetch).toHaveBeenCalledTimes(2)

    const writeFetch = flaky()
    await expect(
      createApiClient(DEV_REF, { token: 't', fetchImpl: writeFetch }).write('SELECT 1'),
    ).rejects.toThrow(/502/)
    expect(writeFetch).toHaveBeenCalledTimes(1)
  })

  it('expose le message Postgres décodé', async () => {
    const body = JSON.stringify({ message: 'ERROR:  P0001: "quoted"' })
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 400 }))
    const err = await createApiClient(DEV_REF, { token: 't', fetchImpl })
      .write('x')
      .catch((e: Error & { dbMessage?: string }) => e)
    expect(err.dbMessage).toBe('ERROR:  P0001: "quoted"')
  })
})

describe('splitUtf8', () => {
  it('respecte la taille en octets et recompose le texte', () => {
    const text = 'aé€😀'.repeat(50)
    const pieces = splitUtf8(text, 10)
    expect(pieces.join('')).toBe(text)
    for (const p of pieces) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(10)
  })

  it('ne coupe jamais une paire de substitution', () => {
    for (const p of splitUtf8('a😀😀😀', 5)) {
      expect(Buffer.from(p).toString()).toBe(p)
    }
  })

  it('renvoie un morceau pour un texte vide ou court', () => {
    expect(splitUtf8('', 10)).toEqual([''])
    expect(splitUtf8('[]', 10)).toEqual(['[]'])
  })
})

describe('SQL', () => {
  it('dollarQuote choisit un délimiteur absent du texte', () => {
    expect(dollarQuote('abc')).toBe('$c0$abc$c0$')
    expect(dollarQuote('x$c0$y')).toBe('$c1$x$c0$y$c1$')
  })

  it('qualified protège les identifiants', () => {
    expect(qualified('public.real_expenses')).toBe('"public"."real_expenses"')
    expect(qualified('auth.we"ird')).toBe('"auth"."we""ird"')
  })

  it('stagingInsertSql est rejouable et échappe le nom de table', () => {
    const sql = stagingInsertSql("public.o'k", 2, '[{"a":1}]')
    expect(sql).toContain(`${STAGING_SCHEMA}.chunks`)
    expect(sql).toContain("'public.o''k', 2, $c0$[{\"a\":1}]$c0$")
    expect(sql).toContain('ON CONFLICT (tbl, seq) DO UPDATE')
  })

  it('createTableSql reprend colonnes, défauts et contraintes', () => {
    const sql = createTableSql('supabase_migrations.schema_migrations', {
      columns: [
        { column: 'version', type: 'text', notNull: true, default: null },
        { column: 'statements', type: 'text[]', notNull: false, default: null },
        { column: 'created_by', type: 'text', notNull: false, default: "'cli'::text" },
      ],
      constraints: [{ name: 'schema_migrations_pkey', def: 'PRIMARY KEY (version)' }],
    })
    expect(sql).toBe(
      [
        'CREATE TABLE IF NOT EXISTS "supabase_migrations"."schema_migrations" (',
        '  "version" text NOT NULL,',
        '  "statements" text[],',
        `  "created_by" text DEFAULT 'cli'::text,`,
        '  CONSTRAINT "schema_migrations_pkey" PRIMARY KEY (version)',
        ');',
      ].join('\n'),
    )
  })
})

describe('planCopy', () => {
  const prod = catalog({
    'auth.users': [{ column: 'id' }, { column: 'confirmed_at', generated: true }],
    'public.profiles': [{ column: 'id' }, { column: 'legacy' }],
    'public.notes': [{ column: 'id' }],
    'snapshots.db_snapshots': [{ column: 'id' }],
    'storage.objects': [{ column: 'id' }],
  })
  const dev = catalog({
    'auth.users': [{ column: 'id' }, { column: 'confirmed_at', generated: true }],
    'public.profiles': [{ column: 'id' }, { column: 'nickname' }],
    'public.notes': [{ column: 'id' }],
    'public.dev_only': [{ column: 'id' }],
    'snapshots.db_snapshots': [{ column: 'id' }],
  })

  it('charge comptes puis données, hors colonnes générées et schémas hors périmètre', () => {
    const plan = planCopy(prod, dev)
    expect(plan.tables.map((t) => t.name)).toEqual([
      'auth.users',
      'public.notes',
      'public.profiles',
      'snapshots.db_snapshots',
    ])
    expect(plan.tables[0]?.columns).toEqual(['id'])
    expect(plan.blockers).toEqual([])
  })

  it('vide toutes les tables public/snapshots de dev, y compris celles propres à dev', () => {
    const plan = planCopy(prod, dev)
    expect(plan.truncate).toEqual([
      'public.dev_only',
      'public.notes',
      'public.profiles',
      'snapshots.db_snapshots',
    ])
    expect(plan.warnings).toContain('public.dev_only n’existe que sur dev : elle sera vidée.')
  })

  it('signale les colonnes qui diffèrent au lieu de les masquer', () => {
    const plan = planCopy(prod, dev)
    expect(plan.tables.find((t) => t.name === 'public.profiles')?.columns).toEqual(['id'])
    expect(plan.warnings).toContain(
      'public.profiles : colonnes absentes de dev, non copiées : legacy.',
    )
    expect(plan.warnings).toContain(
      'public.profiles : colonnes seulement sur dev, remplies par défaut : nickname.',
    )
  })

  it('bloque si une table de la source manque sur dev', () => {
    const plan = planCopy(catalog({ 'public.new_table': [{ column: 'id' }] }), dev)
    expect(plan.blockers).toEqual([
      'public.new_table existe côté source mais pas sur dev : passer les migrations sur dev.',
    ])
  })

  it('crée l’historique des migrations absent de dev seulement sur demande', () => {
    const source = catalog({ 'supabase_migrations.schema_migrations': [{ column: 'version' }] })
    const created = planCopy(source, dev, { createMissingTracker: true })
    expect(created.tables[0]?.createSql).toContain('CREATE TABLE IF NOT EXISTS')
    expect(created.truncate).toContain('supabase_migrations.schema_migrations')

    const skipped = planCopy(source, dev)
    expect(skipped.tables).toEqual([])
    expect(skipped.truncate).not.toContain('supabase_migrations.schema_migrations')
  })

  it('repère colonnes identité et séquences à recaler', () => {
    const plan = planCopy(
      catalog({ 'public.t': [{ column: 'id' }] }),
      catalog({
        'public.t': [{ column: 'id', identity: 'a', default: "nextval('t_id_seq'::regclass)" }],
      }),
    )
    expect(plan.tables[0]).toMatchObject({
      overriding: true,
      sequences: [{ sequence: 't_id_seq', column: 'id' }],
    })
  })
})

describe('buildLoadSql', () => {
  const plan = planCopy(
    catalog({ 'auth.users': [{ column: 'id' }], 'public.notes': [{ column: 'id' }] }),
    catalog({ 'auth.users': [{ column: 'id' }], 'public.notes': [{ column: 'id' }] }),
  )

  it('vide public avant les comptes, coupe les triggers pendant le chargement, puis valide', () => {
    const sql = buildLoadSql(plan, { dryRun: false })
    const at = (s: string) => sql.indexOf(s)
    expect(at('BEGIN;')).toBe(0)
    expect(at('TRUNCATE TABLE "public"."notes";')).toBeLessThan(at('DELETE FROM auth.users;'))
    expect(at('DELETE FROM auth.users;')).toBeLessThan(
      at('SET LOCAL session_replication_role = replica;'),
    )
    expect(at('INSERT INTO "auth"."users"')).toBeGreaterThan(at('replica;'))
    expect(at('INSERT INTO "public"."notes"')).toBeLessThan(at('session_replication_role = origin'))
    expect(at(`DROP SCHEMA ${STAGING_SCHEMA} CASCADE;`)).toBeGreaterThan(at('origin'))
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true)
  })

  it('en --dry-run, finit par une exception au lieu de COMMIT', () => {
    const sql = buildLoadSql(plan, { dryRun: true })
    expect(sql).not.toContain('COMMIT')
    expect(sql).toContain(`RAISE EXCEPTION '${DRY_RUN_MARKER}%'`)
  })
})

describe('vérification', () => {
  it('parseDryRunError relit le résultat porté par l’exception', () => {
    const message = `Failed to run sql query: ERROR:  P0001: ${DRY_RUN_MARKER}{"public.notes" : {"rows" : 2, "checksum" : "abc"}}\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at RAISE\n`
    expect(parseDryRunError(message)).toEqual({ 'public.notes': { rows: 2, checksum: 'abc' } })
    expect(parseDryRunError('ERROR: relation does not exist')).toBeNull()
  })

  it('compareFingerprints exige lignes et empreinte identiques', () => {
    const results = compareFingerprints(
      [
        { name: 'a', rows: 2, checksum: 'x' },
        { name: 'b', rows: 1, checksum: 'y' },
        { name: 'c', rows: 3, checksum: null },
        { name: 'd', rows: 1, checksum: 'z' },
      ],
      {
        a: { rows: 2, checksum: 'x' },
        b: { rows: 1, checksum: 'other' },
        c: { rows: 3, checksum: 'w' },
      },
    )
    expect(results.map((r) => [r.name, r.ok, r.checked])).toEqual([
      ['a', true, true],
      ['b', false, true],
      ['c', true, false],
      ['d', false, true],
    ])
  })

  it('diffStructure liste ajouts, retraits et écarts', () => {
    expect(diffStructure({ a: '1', b: '2' }, { b: '3', c: '4' })).toEqual([
      'seulement côté source : a',
      'différent : b',
      'seulement sur dev : c',
    ])
  })
})

describe('mise en forme', () => {
  it('formatCounts aligne les colonnes et nomme les comptes', () => {
    const lines = formatCounts(
      [
        { name: 'auth.users', source: 2, target: 3 },
        { name: 'public.notes', source: 5, target: null },
      ],
      { sourceLabel: 'prod', targetLabel: 'dev actuel' },
    )
    expect(lines[1]).toMatch(/^auth\.users \(comptes de connexion\)\s+2\s+3$/)
    expect(lines[2]).toMatch(/^public\.notes\s+5\s+—$/)
    expect(new Set(lines.map((l) => l.length)).size).toBe(1)
  })

  it('accountOverlap compte les comptes communs par identifiant', () => {
    expect(accountOverlap(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({
      shared: 2,
      onlySource: 1,
      onlyTarget: 2,
    })
  })

  it('backupFileName est horodaté et sans « : »', () => {
    expect(backupFileName(new Date('2026-09-30T17:43:21.226Z'))).toBe(
      'dev-backup-2026-09-30T17-43-21-226Z.json',
    )
  })
})
