// Helpers purs de scripts/db-snapshot.mjs : parsing des arguments et mise en
// forme des résultats. Aucune I/O ici, pour pouvoir les tester unitairement
// (scripts/__tests__/db-snapshot-lib.test.ts).

export const CONFIRM_WORD = 'RESTAURER'

export const PROD_REF = 'jzmppreybwabaeycvasz'
export const DEV_REF = 'ddehmjucyfgyppfkbddr'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PERIOD_RE = /^(\d{4})-(\d{2})$/

const COMMANDS = ['list', 'status', 'take', 'preview', 'restore']

export const USAGE = [
  'Usage :',
  '  node scripts/db-snapshot.mjs list                 snapshots disponibles',
  '  node scripts/db-snapshot.mjs status               job planifié, dernières exécutions',
  '  node scripts/db-snapshot.mjs take [--note="..."]  snapshot manuel immédiat',
  '  node scripts/db-snapshot.mjs preview <snapshot>   ce que changerait la restauration',
  '  node scripts/db-snapshot.mjs restore <snapshot>   aperçu, confirmation, restauration',
  '',
  '<snapshot> : AAAA-MM (snapshot de fin de ce mois) ou son identifiant complet.',
  `Projet ciblé : $SUPABASE_PROJECT_REF, prod (${PROD_REF}) par défaut.`,
].join('\n')

const KIND_LABELS = {
  month_end: 'fin de mois',
  manual: 'manuel',
  pre_restore: 'avant restauration',
}

const STEP_LABELS = {
  welcome: 'accueil',
  complete_month: 'compléter le mois',
  summary: 'résumé',
  manage_bilan: 'bilan',
  salary_update: 'salaires',
  final_recap: 'récap final',
  completed: 'terminé',
}

const TABLE_LABELS = {
  estimated_budgets: 'Budgets',
  estimated_incomes: 'Revenus estimés',
  savings_projects: "Projets d'épargne",
  piggy_bank: 'Tirelires',
  bank_balances: 'Soldes de compte',
  group_contributions: 'Contributions de groupe',
  monthly_recaps: 'Récaps mensuels',
  budget_transfers: 'Transferts entre budgets',
  real_expenses: 'Dépenses',
  real_income_entries: 'Revenus',
  expense_savings_sources: 'Sources des dépenses',
  remaining_to_live_snapshots: 'Historique du reste à vivre',
}

/** @param {string} ref */
export function projectLabel(ref) {
  if (ref === PROD_REF) return `PROD (${ref})`
  if (ref === DEV_REF) return `DEV (${ref})`
  return ref
}

/**
 * @param {string[]} argv arguments après le nom du script
 * @returns {{ command: string, selector: string | null, note: string | null } | { error: string }}
 */
export function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const noteFlag = argv.find((a) => a.startsWith('--note='))
  const unknownFlag = argv.find((a) => a.startsWith('--') && !a.startsWith('--note='))
  const [command, selector, ...rest] = positional

  if (!command) return { error: 'Commande manquante.' }
  if (!COMMANDS.includes(command)) return { error: `Commande inconnue : ${command}` }
  if (unknownFlag) return { error: `Option inconnue : ${unknownFlag}` }
  if (rest.length > 0) return { error: `Argument en trop : ${rest.join(' ')}` }
  if (noteFlag && command !== 'take') return { error: '--note ne sert qu’avec take.' }

  const needsSelector = command === 'preview' || command === 'restore'
  if (needsSelector && !selector) return { error: `${command} attend un snapshot (AAAA-MM ou id).` }
  if (!needsSelector && selector) return { error: `${command} ne prend pas d’argument.` }

  return {
    command,
    selector: selector ?? null,
    note: noteFlag ? noteFlag.slice('--note='.length) : null,
  }
}

/**
 * @param {string} raw
 * @returns {{ type: 'period', year: number, month: number } | { type: 'id', id: string } | null}
 */
export function parseSelector(raw) {
  if (UUID_RE.test(raw)) return { type: 'id', id: raw.toLowerCase() }
  const m = PERIOD_RE.exec(raw)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { type: 'period', year, month }
}

/** Littéral SQL entre quotes simples (standard_conforming_strings, défaut PG). */
export function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** Condition SQL sur snapshots.db_snapshots pour un sélecteur déjà validé. */
export function selectorWhere(selector) {
  if (selector.type === 'id') return `id = ${sqlString(selector.id)}::uuid`
  return `kind = 'month_end' AND period_year = ${selector.year} AND period_month = ${selector.month}`
}

const EURO = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })

/** @param {number | string | null | undefined} value */
export function formatEuro(value) {
  if (value === null || value === undefined) return '—'
  return EURO.format(Number(value)).replace(/\s/g, ' ')
}

const PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Horodatage ISO → « JJ/MM/AAAA HH:MM » heure de Paris. */
export function formatParis(iso) {
  if (!iso) return '—'
  return PARIS.format(new Date(iso)).replace(/\s/g, ' ').replace(' ', ' à ')
}

/** Date ISO « AAAA-MM-JJ » → « JJ/MM/AAAA ». */
export function formatDay(isoDate) {
  if (!isoDate) return '—'
  const [y, m, d] = String(isoDate).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function period(year, month) {
  return `${String(month).padStart(2, '0')}/${year}`
}

/** Le Management API peut renvoyer un jsonb déjà parsé ou en chaîne. */
export function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value
}

/** @param {Array<Record<string, unknown>>} rows lignes de snapshots.db_snapshots */
export function formatSnapshotList(rows) {
  if (rows.length === 0) return ['Aucun snapshot pour l’instant.']
  return rows.map((r) => {
    const counts = asJson(r.table_counts) ?? {}
    const tx = (counts.real_expenses ?? 0) + (counts.real_income_entries ?? 0)
    const restored = r.restored_at ? `  (restauré le ${formatParis(r.restored_at)})` : ''
    return [
      `${period(r.period_year, r.period_month)}  ${KIND_LABELS[r.kind] ?? r.kind}`.padEnd(30),
      `pris le ${formatParis(r.taken_at)}`.padEnd(26),
      `${tx} transactions`.padEnd(18),
      r.id,
      restored,
    ].join('  ')
  })
}

function describeTransaction(t) {
  const kind = t.kind === 'expense' ? 'Dépense' : 'Revenu'
  const who = t.space === 'perso' ? `${t.owner} (perso)` : t.owner
  const auto = t.automatic ? ' [ligne automatique]' : ''
  const head = `${formatDay(t.date)}  ${kind}  ${who}  « ${t.description} »${auto}`
  if (t.change === 'added') return `  + ${head}  ${formatEuro(t.amount_now)}  → sera EFFACÉE`
  if (t.change === 'removed') return `  - ${head}  ${formatEuro(t.amount_snapshot)}  → sera RECRÉÉE`
  const amount =
    Number(t.amount_now) === Number(t.amount_snapshot)
      ? formatEuro(t.amount_now)
      : `${formatEuro(t.amount_now)} → ${formatEuro(t.amount_snapshot)}`
  return `  ~ ${head}  ${amount}  → remise en l’état (${(t.changed ?? []).join(', ')})`
}

function describeRecap(r) {
  const label = `${r.owner} — récap ${period(r.recap_year, r.recap_month)}`
  const stepNow = STEP_LABELS[r.step_now] ?? r.step_now
  const stepSnap = STEP_LABELS[r.step_snapshot] ?? r.step_snapshot
  if (r.change === 'added') return `  ${label} (étape « ${stepNow} ») → sera EFFACÉ, à refaire`
  if (r.change === 'removed') return `  ${label} → sera RECRÉÉ (étape « ${stepSnap} »)`
  return `  ${label} → revient de l’étape « ${stepNow} » à « ${stepSnap} »`
}

function describeProfile(p) {
  if (p.new_since_snapshot) {
    return `  ${p.name} — compte créé depuis le snapshot : ses données financières seront effacées (le compte reste)`
  }
  const parts = []
  if (Number(p.salary_now) !== Number(p.salary_snapshot)) {
    parts.push(`salaire ${formatEuro(p.salary_now)} → ${formatEuro(p.salary_snapshot)}`)
  }
  if (p.group_changed) {
    parts.push(
      `groupe ${p.group_now ?? 'aucun'} → ${p.group_snapshot ?? 'aucun'} (reconnexion nécessaire)`,
    )
  }
  return `  ${p.name} — ${parts.join(' ; ')}`
}

/**
 * Aperçu lisible de snapshots.preview_restore().
 * @param {Record<string, any>} preview
 * @returns {string[]}
 */
export function formatPreview(preview) {
  const s = preview.snapshot
  const lines = []
  lines.push(
    `Snapshot ${KIND_LABELS[s.kind] ?? s.kind} ${period(s.period_year, s.period_month)} — pris le ${formatParis(s.taken_at)} (heure de Paris)`,
  )
  lines.push(`Identifiant : ${s.id}${s.note ? `  —  ${s.note}` : ''}`)
  if (s.restored_at) lines.push(`Déjà restauré le ${formatParis(s.restored_at)}.`)
  lines.push('')

  const blockers = preview.blockers ?? []
  if (blockers.length > 0) {
    lines.push('⛔ Restauration impossible :')
    for (const b of blockers) {
      if (b.reason) {
        lines.push(`  - ${b.table} : ${b.reason} (snapshot plus ancien que la table)`)
      } else {
        lines.push(
          `  - ${b.table}.${b.column} pointe vers ${b.missing.length} élément(s) de ${b.references} supprimé(s) depuis : ${b.missing.join(', ')}`,
        )
      }
    }
    lines.push('')
  }

  const uncovered = preview.uncovered_tables ?? []
  if (uncovered.length > 0) {
    lines.push(
      `⚠️  Tables absentes du snapshot, elles ne seront pas rembobinées : ${uncovered.join(', ')}`,
    )
    lines.push('')
  }

  const changed = (preview.tables ?? []).filter(
    (t) => t.to_delete > 0 || t.to_recreate > 0 || t.to_revert > 0,
  )
  if (changed.length === 0) {
    lines.push('Aucune différence : la base est déjà dans l’état du snapshot.')
    return lines
  }

  lines.push('Par table (lignes) :')
  lines.push(
    `  ${'Table'.padEnd(30)}${'Actuel'.padStart(8)}${'Snapshot'.padStart(10)}${'Effacées'.padStart(10)}${'Recréées'.padStart(10)}${'Remises'.padStart(9)}`,
  )
  for (const t of changed) {
    lines.push(
      `  ${(TABLE_LABELS[t.table] ?? t.table).padEnd(30)}${String(t.current).padStart(8)}${String(t.snapshot).padStart(10)}${String(t.to_delete).padStart(10)}${String(t.to_recreate).padStart(10)}${String(t.to_revert).padStart(9)}`,
    )
  }

  const transactions = preview.transactions ?? []
  if (transactions.length > 0) {
    lines.push('')
    lines.push(`Dépenses et revenus concernés (${transactions.length}) :`)
    for (const t of transactions) lines.push(describeTransaction(t))
  }

  const balances = preview.balances ?? []
  if (balances.length > 0) {
    lines.push('')
    lines.push('Soldes (actuel → après restauration) :')
    for (const b of balances) {
      const what = b.label ? `${b.kind} « ${b.label} »` : b.kind
      lines.push(`  ${b.owner} — ${what} : ${formatEuro(b.now)} → ${formatEuro(b.snapshot)}`)
    }
  }

  const recaps = preview.recaps ?? []
  if (recaps.length > 0) {
    lines.push('')
    lines.push('Récaps mensuels :')
    for (const r of recaps) lines.push(describeRecap(r))
  }

  const profiles = preview.profiles ?? []
  if (profiles.length > 0) {
    lines.push('')
    lines.push('Comptes :')
    for (const p of profiles) lines.push(describeProfile(p))
  }

  const newGroups = preview.new_groups ?? []
  if (newGroups.length > 0) {
    lines.push('')
    lines.push(
      `Groupes créés depuis le snapshot (le groupe reste, ses données financières sont effacées) : ${newGroups.join(', ')}`,
    )
  }

  return lines
}

/**
 * Consignes à afficher après une restauration réussie.
 * @param {Record<string, any>} preview aperçu calculé avant la restauration
 * @param {string} preRestoreId
 */
export function afterRestoreNotes(preview, preRestoreId) {
  const lines = [
    `Snapshot de sécurité pris juste avant : ${preRestoreId}`,
    `Pour annuler : node scripts/db-snapshot.mjs restore ${preRestoreId}`,
    '',
    'À faire maintenant :',
    '  - Chaque utilisateur recharge l’appli (fermer puis rouvrir la PWA).',
    '  - Le récap redémarre à la prochaine ouverture du dashboard. Un navigateur qui venait de',
    '    terminer le récap garde un marqueur valable 5 min : attendre 5 min ou se reconnecter.',
  ]
  const moved = (preview.profiles ?? []).filter((p) => p.group_changed).map((p) => p.name)
  if (moved.length > 0) {
    lines.push(`  - Groupe modifié pour : ${moved.join(', ')}. Ces membres doivent se reconnecter.`)
  }
  return lines
}
