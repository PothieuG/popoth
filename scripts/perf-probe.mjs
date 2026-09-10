#!/usr/bin/env node
// Mesure la latence réelle des appels d'API qu'un chargement de dashboard
// déclenche, contexte perso ET groupe, contre n'importe quel déploiement
// (prod, preview Vercel, `pnpm dev`). Sprint Perf-Toggle-Targeted-Refresh
// (2026-09-10) : les 3 passes précédentes ont optimisé sur un PLAN de requêtes
// mocké, jamais sur des millisecondes — ce script donne les millisecondes.
//
// Usage :
//   POPOTH_SESSION_COOKIE='<valeur du cookie `session`>' \
//   node scripts/perf-probe.mjs --base=https://popoth.app [--runs=5] [--context=both|profile|group]
//
// Le cookie `session` se copie depuis DevTools → Application → Cookies (c'est
// un JWT signé, valable 1 h). Il n'est jamais affiché par ce script.
//
// Sortie :
//   1. la région Vercel qui a servi chaque réponse (`x-vercel-id`) — si elle ne
//      commence pas par `fra1`, la base est sur un autre continent que la
//      fonction (cf. vercel.json) ;
//   2. par endpoint : médiane / max sur N runs séquentiels (1 run de chauffe
//      écarté), trié du plus lent au plus rapide ;
//   3. la « vague » : tous les endpoints d'un contexte en parallèle, comme le
//      fait le dashboard — c'est le temps que l'utilisateur attend.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? 'true']
  }),
)

const BASE = (args.base ?? process.env.POPOTH_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
)
const RUNS = Math.max(1, Number(args.runs ?? 5))
const CONTEXTS =
  args.context === 'profile' || args.context === 'group' ? [args.context] : ['profile', 'group']
const COOKIE = process.env.POPOTH_SESSION_COOKIE

if (!COOKIE) {
  console.error('ERROR: set POPOTH_SESSION_COOKIE (valeur du cookie `session`) before running.')
  process.exit(1)
}

const headers = { cookie: `session=${COOKIE}`, accept: 'application/json' }

async function timed(path) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' })
  // On lit le corps : c'est ce que le navigateur attend aussi.
  const text = await res.text()
  const ms = performance.now() - t0
  return {
    ms,
    status: res.status,
    bytes: text.length,
    region: (res.headers.get('x-vercel-id') ?? '').split('::')[0] || null,
    body: text,
  }
}

function endpointsFor(ctx, groupId) {
  const isGroup = ctx === 'group'
  const list = [
    '/api/profile',
    '/api/groups',
    '/api/groups/contributions',
    `/api/bank-balance?context=${ctx}`,
    `/api/finance/summary?context=${ctx}`,
    `/api/finance/budgets/estimated?group=${isGroup}`,
    `/api/finance/incomes?context=${ctx}`,
    `/api/finance/projects?group=${isGroup}`,
    `/api/finance/expenses/real?${isGroup ? 'group=true&' : ''}limit=100`,
    `/api/finance/income/real?${isGroup ? 'group=true&' : ''}limit=100`,
    `/api/finance/expenses/progress?context=${ctx}`,
    `/api/finance/income/progress?context=${ctx}`,
  ]
  if (isGroup && groupId) list.push(`/api/groups/${groupId}/members`)
  return list
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const fmt = (ms) => `${Math.round(ms)} ms`.padStart(8)

// ── 1. Session + région ──────────────────────────────────────────────────────
const probe = await timed('/api/profile')
if (probe.status === 401) {
  console.error('ERROR: 401 — le cookie `session` est invalide ou expiré (durée de vie 1 h).')
  process.exit(1)
}
if (probe.status !== 200) {
  console.error(`ERROR: GET /api/profile → HTTP ${probe.status}`)
  process.exit(1)
}
let groupId = null
try {
  const json = JSON.parse(probe.body)
  groupId = json.group_id ?? json.profile?.group_id ?? json.data?.group_id ?? null
} catch {
  // corps non JSON : on continue sans les membres
}
console.log(`Base      : ${BASE}`)
console.log(`Région    : ${probe.region ?? '(pas de x-vercel-id — pas Vercel, ou dev local)'}`)
console.log(`Groupe    : ${groupId ? 'oui' : 'non (contexte groupe ignoré)'}`)
console.log(`Runs      : ${RUNS} par endpoint (+1 de chauffe)\n`)

// ── 2. Par endpoint ──────────────────────────────────────────────────────────
for (const ctx of CONTEXTS) {
  if (ctx === 'group' && !groupId) continue
  const endpoints = endpointsFor(ctx, groupId)
  const rows = []
  for (const path of endpoints) {
    await timed(path) // chauffe (compilation Next en dev, cache CDN, pooler)
    const samples = []
    let status = 0
    let bytes = 0
    for (let i = 0; i < RUNS; i += 1) {
      const r = await timed(path)
      samples.push(r.ms)
      status = r.status
      bytes = r.bytes
    }
    rows.push({ path, status, bytes, med: median(samples), max: Math.max(...samples) })
  }
  rows.sort((a, b) => b.med - a.med)

  console.log(`── Contexte ${ctx} — ${rows.length} endpoints, du plus lent au plus rapide`)
  console.log(`${'médiane'.padStart(8)} ${'max'.padStart(8)}  HTTP   octets  endpoint`)
  for (const r of rows) {
    console.log(
      `${fmt(r.med)} ${fmt(r.max)}   ${String(r.status).padEnd(4)} ${String(r.bytes).padStart(7)}  ${r.path}`,
    )
  }
  const serial = rows.reduce((s, r) => s + r.med, 0)
  console.log(`${fmt(serial)} — somme des médianes (coût si tout partait en série)\n`)

  // ── 3. La vague : tout en parallèle, comme le dashboard ────────────────────
  const waves = []
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now()
    await Promise.all(endpoints.map((p) => timed(p)))
    waves.push(performance.now() - t0)
  }
  console.log(
    `   Vague ${ctx} (${endpoints.length} appels en parallèle) : médiane ${fmt(median(waves)).trim()}, max ${fmt(Math.max(...waves)).trim()}`,
  )
  console.log(
    `   → c'est le temps d'attente réel d'un chargement de dashboard ${ctx} (hors rendu).\n`,
  )
}

console.log(
  'Lecture : si la vague groupe est nettement plus longue que la vague perso, le\n' +
    'coupable est dans le tableau groupe, en tête. Si les deux vagues sont proches\n' +
    'mais longues, le coût est structurel (nombre d’appels, région, pooler).',
)
