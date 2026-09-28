import { describe, expect, it } from 'vitest'

import {
  CONFIRM_WORD,
  afterRestoreNotes,
  asJson,
  formatDay,
  formatEuro,
  formatParis,
  formatPreview,
  formatSnapshotList,
  parseArgs,
  parseSelector,
  projectLabel,
  selectorWhere,
  sqlString,
} from '../db-snapshot-lib.mjs'

const SNAPSHOT = {
  id: '339cfddc-3c70-4f22-9d74-aa1132101ccc',
  kind: 'month_end',
  note: 'Fin de mois 09/2026',
  taken_at: '2026-09-30T21:45:00.123+00:00',
  period_year: 2026,
  period_month: 9,
  restored_at: null,
  table_counts: { real_expenses: 6, real_income_entries: 3 },
}

const EMPTY_PREVIEW = {
  snapshot: SNAPSHOT,
  blockers: [],
  uncovered_tables: [],
  tables: [
    {
      table: 'real_expenses',
      in_snapshot: true,
      current: 6,
      snapshot: 6,
      to_delete: 0,
      to_recreate: 0,
      to_revert: 0,
    },
  ],
  transactions: [],
  balances: [],
  recaps: [],
  profiles: [],
  new_groups: [],
}

const FULL_PREVIEW = {
  ...EMPTY_PREVIEW,
  tables: [
    {
      table: 'real_expenses',
      in_snapshot: true,
      current: 6,
      snapshot: 6,
      to_delete: 1,
      to_recreate: 1,
      to_revert: 2,
    },
    {
      table: 'piggy_bank',
      in_snapshot: true,
      current: 2,
      snapshot: 2,
      to_delete: 0,
      to_recreate: 0,
      to_revert: 0,
    },
  ],
  transactions: [
    {
      kind: 'expense',
      change: 'modified',
      id: 'ee000000-0000-4000-8000-000000000002',
      owner: 'Alice Martin',
      space: 'perso',
      date: '2026-09-12',
      description: 'Cinéma',
      amount_now: 52.5,
      amount_snapshot: 45,
      automatic: false,
      changed: ['amount', 'amount_from_budget'],
    },
    {
      kind: 'expense',
      change: 'removed',
      id: 'ee000000-0000-4000-8000-000000000006',
      owner: 'Groupe Famille',
      space: 'groupe',
      date: '2026-09-15',
      description: 'Internet',
      amount_now: null,
      amount_snapshot: 60,
      automatic: false,
      changed: null,
    },
    {
      kind: 'income',
      change: 'added',
      id: '1e000000-0000-4000-8000-000000000009',
      owner: 'Alice Martin',
      space: 'perso',
      date: '2026-10-01',
      description: 'Salaire',
      amount_now: 3000,
      amount_snapshot: null,
      automatic: true,
      changed: null,
    },
  ],
  balances: [
    { kind: 'Tirelire', label: null, owner: 'Alice Martin', now: 0, snapshot: 200 },
    { kind: 'Économies du budget', label: 'Courses', owner: 'Alice Martin', now: 0, snapshot: 50 },
  ],
  recaps: [
    {
      change: 'added',
      owner: 'Alice Martin',
      recap_month: 9,
      recap_year: 2026,
      step_now: 'final_recap',
      step_snapshot: null,
      completed_now: false,
      completed_snapshot: false,
    },
  ],
  profiles: [
    {
      name: 'Alice Martin',
      new_since_snapshot: false,
      salary_now: 3500,
      salary_snapshot: 3000,
      group_now: 'Groupe Famille',
      group_snapshot: 'Groupe Famille',
      group_changed: false,
    },
    {
      name: 'Bob Martin',
      new_since_snapshot: false,
      salary_now: 2000,
      salary_snapshot: 2000,
      group_now: null,
      group_snapshot: 'Groupe Famille',
      group_changed: true,
    },
    {
      name: 'Dan New',
      new_since_snapshot: true,
      salary_now: 1800,
      salary_snapshot: null,
      group_now: null,
      group_snapshot: null,
      group_changed: false,
    },
  ],
  new_groups: ['Colocation'],
}

describe('parseArgs', () => {
  it('accepts commands without a snapshot', () => {
    expect(parseArgs(['list'])).toEqual({ command: 'list', selector: null, note: null })
    expect(parseArgs(['status'])).toEqual({ command: 'status', selector: null, note: null })
  })

  it('reads the note of a manual snapshot', () => {
    expect(parseArgs(['take', "--note=avant l'import"])).toEqual({
      command: 'take',
      selector: null,
      note: "avant l'import",
    })
  })

  it('requires a snapshot for preview and restore', () => {
    expect(parseArgs(['preview', '2026-09'])).toEqual({
      command: 'preview',
      selector: '2026-09',
      note: null,
    })
    expect(parseArgs(['restore'])).toEqual({
      error: 'restore attend un snapshot (AAAA-MM ou id).',
    })
  })

  it('rejects anything unexpected', () => {
    expect(parseArgs([])).toHaveProperty('error')
    expect(parseArgs(['drop'])).toHaveProperty('error')
    expect(parseArgs(['list', '2026-09'])).toHaveProperty('error')
    expect(parseArgs(['restore', '2026-09', '2026-08'])).toHaveProperty('error')
    expect(parseArgs(['restore', '2026-09', '--yes'])).toHaveProperty('error')
    expect(parseArgs(['restore', '2026-09', '--note=x'])).toHaveProperty('error')
  })
})

describe('parseSelector / selectorWhere', () => {
  it('reads a month-end period', () => {
    const selector = parseSelector('2026-09')
    expect(selector).toEqual({ type: 'period', year: 2026, month: 9 })
    expect(selectorWhere(selector)).toBe(
      "kind = 'month_end' AND period_year = 2026 AND period_month = 9",
    )
  })

  it('reads a snapshot id, normalised to lower case', () => {
    const selector = parseSelector('339CFDDC-3C70-4F22-9D74-AA1132101CCC')
    expect(selector).toEqual({ type: 'id', id: '339cfddc-3c70-4f22-9d74-aa1132101ccc' })
    expect(selectorWhere(selector)).toBe("id = '339cfddc-3c70-4f22-9d74-aa1132101ccc'::uuid")
  })

  it('rejects anything that could reach the SQL unvalidated', () => {
    expect(parseSelector('2026-13')).toBeNull()
    expect(parseSelector('2026-9')).toBeNull()
    expect(parseSelector("2026-09' OR 1=1 --")).toBeNull()
    expect(parseSelector('latest')).toBeNull()
  })
})

describe('sqlString', () => {
  it('doubles single quotes', () => {
    expect(sqlString("d'avant récap")).toBe("'d''avant récap'")
    expect(sqlString("'); DROP TABLE x; --")).toBe("'''); DROP TABLE x; --'")
  })
})

describe('formatting', () => {
  it('labels the known projects', () => {
    expect(projectLabel('jzmppreybwabaeycvasz')).toBe('PROD (jzmppreybwabaeycvasz)')
    expect(projectLabel('ddehmjucyfgyppfkbddr')).toBe('DEV (ddehmjucyfgyppfkbddr)')
    expect(projectLabel('other')).toBe('other')
  })

  it('formats euros the French way', () => {
    expect(formatEuro(1234.5)).toBe('1 234,50 €')
    expect(formatEuro('12.3')).toBe('12,30 €')
    expect(formatEuro(null)).toBe('—')
  })

  it('shows timestamps in Paris time, summer and winter', () => {
    expect(formatParis('2026-09-30T21:45:00+00:00')).toBe('30/09/2026 à 23:45')
    expect(formatParis('2026-10-31T22:45:00Z')).toBe('31/10/2026 à 23:45')
    expect(formatDay('2026-09-05')).toBe('05/09/2026')
  })

  it('parses jsonb whether it arrives as a string or already parsed', () => {
    expect(asJson('{"a":1}')).toEqual({ a: 1 })
    expect(asJson({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('formatSnapshotList', () => {
  it('says so when there is nothing', () => {
    expect(formatSnapshotList([])).toEqual(['Aucun snapshot pour l’instant.'])
  })

  it('shows period, kind, date, transaction count and restore stamp', () => {
    const [line] = formatSnapshotList([
      {
        ...SNAPSHOT,
        table_counts: JSON.stringify(SNAPSHOT.table_counts),
        restored_at: '2026-10-02T08:00:00Z',
      },
    ])
    expect(line).toContain('09/2026  fin de mois')
    expect(line).toContain('pris le 30/09/2026 à 23:45')
    expect(line).toContain('9 transactions')
    expect(line).toContain(SNAPSHOT.id)
    expect(line).toContain('(restauré le 02/10/2026 à 10:00)')
  })
})

describe('formatPreview', () => {
  it('reports an already-restored state', () => {
    const lines = formatPreview(EMPTY_PREVIEW)
    expect(lines[0]).toBe(
      'Snapshot fin de mois 09/2026 — pris le 30/09/2026 à 23:45 (heure de Paris)',
    )
    expect(lines).toContain('Aucune différence : la base est déjà dans l’état du snapshot.')
  })

  it('lists blockers and uncovered tables first', () => {
    const lines = formatPreview({
      ...EMPTY_PREVIEW,
      blockers: [
        { table: 'savings_projects', reason: 'absente du snapshot' },
        {
          table: 'estimated_budgets',
          column: 'profile_id',
          references: 'profiles',
          missing: ['dddddddd-0000-4000-8000-000000000004'],
        },
      ],
      uncovered_tables: ['forgotten_table'],
    })
    expect(lines).toContain('⛔ Restauration impossible :')
    expect(lines).toContain(
      '  - savings_projects : absente du snapshot (snapshot plus ancien que la table)',
    )
    expect(lines).toContain(
      '  - estimated_budgets.profile_id pointe vers 1 élément(s) de profiles supprimé(s) depuis : dddddddd-0000-4000-8000-000000000004',
    )
    expect(lines.some((l) => l.includes('forgotten_table'))).toBe(true)
  })

  it('details every change the restore would make', () => {
    const lines = formatPreview(FULL_PREVIEW)
    // Only tables that change are listed.
    expect(
      lines.some((l) => l.startsWith('  Dépenses') && l.trimEnd().endsWith('1         1        2')),
    ).toBe(true)
    expect(lines.some((l) => l.startsWith('  Tirelires'))).toBe(false)
    expect(lines).toContain(
      '  ~ 12/09/2026  Dépense  Alice Martin (perso)  « Cinéma »  52,50 € → 45,00 €  → remise en l’état (amount, amount_from_budget)',
    )
    expect(lines).toContain(
      '  - 15/09/2026  Dépense  Groupe Famille  « Internet »  60,00 €  → sera RECRÉÉE',
    )
    expect(lines).toContain(
      '  + 01/10/2026  Revenu  Alice Martin (perso)  « Salaire » [ligne automatique]  3 000,00 €  → sera EFFACÉE',
    )
    expect(lines).toContain('  Alice Martin — Tirelire : 0,00 € → 200,00 €')
    expect(lines).toContain('  Alice Martin — Économies du budget « Courses » : 0,00 € → 50,00 €')
    expect(lines).toContain(
      '  Alice Martin — récap 09/2026 (étape « récap final ») → sera EFFACÉ, à refaire',
    )
    expect(lines).toContain('  Alice Martin — salaire 3 500,00 € → 3 000,00 €')
    expect(lines).toContain('  Bob Martin — groupe aucun → Groupe Famille (reconnexion nécessaire)')
    expect(lines).toContain(
      '  Dan New — compte créé depuis le snapshot : ses données financières seront effacées (le compte reste)',
    )
    expect(lines.some((l) => l.includes('Colocation'))).toBe(true)
  })
})

describe('afterRestoreNotes', () => {
  it('explains how to undo and who must log in again', () => {
    const lines = afterRestoreNotes(FULL_PREVIEW, 'a61725b5-b3ef-4bf7-825f-a217e5ea3d23')
    expect(lines).toContain(
      'Pour annuler : node scripts/db-snapshot.mjs restore a61725b5-b3ef-4bf7-825f-a217e5ea3d23',
    )
    expect(lines).toContain(
      '  - Groupe modifié pour : Bob Martin. Ces membres doivent se reconnecter.',
    )
  })

  it('keeps the confirmation word stable', () => {
    expect(CONFIRM_WORD).toBe('RESTAURER')
  })
})
