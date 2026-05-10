# Sprint Cleanup-I8 / Lot 4a — Migration `app/api/groups/**`

## Contexte

Lot 1 (filet logger + strip prod) et Lot 3 (middleware + expense-allocation, 7 sites + per-file ESLint override) sont livrés. Le pattern de migration est validé end-to-end et le standard du repo. Reste à propager la migration aux ~985 `console.log` + ~322 `console.error` du code applicatif, par opportunité.

**Lot 4a** = première salve API. Scope volontairement narrow pour rester one-shot et faciliter le review : un seul domaine cohérent, **`app/api/groups/**`** — 5 fichiers, 22 sites, déjà wrappés en `withAuth(AndProfile)`depuis Sprint Refactor-Architecture v4 (donc le code de migration est uniquement les`console.error`dans les`try/catch` route-aware, pas du boilerplate auth à toucher).

État actuel par fichier (compté via `grep -c "console\." <file>`) :

- `app/api/groups/route.ts` — 6 sites (POST/GET, create/list)
- `app/api/groups/[id]/members/route.ts` — 6 sites (GET/POST/DELETE, dynamic route)
- `app/api/groups/contributions/route.ts` — 4 sites
- `app/api/groups/[id]/route.ts` — 4 sites (PUT/DELETE, dynamic route)
- `app/api/groups/search/route.ts` — 2 sites

**Total** : 22 sites, tous probablement `console.error` dans des `try/catch` ou des paths de validation. À auditer via `grep "console\." app/api/groups/` en début de sprint.

Ce qui n'est PAS dans ce sprint :

- Routes finance (déjà wrappées + déjà beaucoup nettoyées implicitement par v3 — à auditer séparément si elles ont des sites résiduels).
- Routes monthly-recap stateful (complete 65 sites, recover, balance 62, auto-balance — couplé I5).
- Routes monthly-recap simples (status, refresh, resume, initialize, step1-data 57, step2-data, accumulate-piggy-bank, transfer, update-step) — à scoper en Lot 4b si Lot 4a se passe bien.
- Routes profile (18), savings/data (19), savings/transfer (45), bank-balance (15) — à scoper en Lots 4c/4d ultérieurs.
- God files I4 (`lib/financial-calculations.ts` 95 sites) et I5 (`process-step1` 116 sites) — explicitement hors scope.
- Composants UI (Lot 5) — par opportunité au fil des PRs feature.
- Sweep final + activation globale `no-console: 'error'` (Lot 6).

## Approach

Pattern miroir Lot 3 (livré 2026-05-10, plan dans `C:\Users\gille\.claude\plans\sprint-cleanup-i8-sleepy-pebble.md`). Découpage suggéré : **3 commits + closeout**.

### Phase 1 — Audit (5 min)

`grep -n "console\." app/api/groups/` pour confirmer le total et le shape des sites. Attendu : tous des `console.error` dans des `catch (error)`. Si un `console.log` apparaît, le traiter au cas par cas (downgrade `logger.debug` ou `logger.info` selon le sens).

### Commit 1 — Migration `app/api/groups/route.ts` + `app/api/groups/search/route.ts` + `app/api/groups/contributions/route.ts`

Les 3 routes statiques (sans param dynamique). 12 sites au total. Drop-in mécanique :

- Ajouter `import { logger } from '@/lib/logger'` au top de chaque fichier.
- Pour chaque `console.error('msg', error)` → `logger.error('msg', error)`. Message verbatim, rest-spread préservé.
- Pour les rares `console.log` (s'il y en a — probablement 0 ou 1 max) : choisir `logger.debug` (flow log) ou `logger.info` (event utilisateur réussi) selon le sens.

### Commit 2 — Migration `app/api/groups/[id]/route.ts` + `app/api/groups/[id]/members/route.ts`

Les 2 routes dynamiques. 10 sites au total. Même pattern que commit 1. Vérifier que les patterns de `withAuth<RouteParams>` (Sprint v5 overload) ne sont pas accidentellement cassés.

### Commit 3 — Per-file ESLint override

Étendre le bloc d'override dans [eslint.config.mjs](../eslint.config.mjs) pour escalader `no-console: 'error'` sur les 5 nouveaux fichiers :

```js
{
  files: [
    'middleware.ts',
    'lib/expense-allocation.ts',
    'lib/logger.ts',
    'app/api/groups/route.ts',
    'app/api/groups/search/route.ts',
    'app/api/groups/contributions/route.ts',
    'app/api/groups/[id]/route.ts',
    'app/api/groups/[id]/members/route.ts',
  ],
  rules: { 'no-console': 'error' },
},
```

Ou alternativement, refactorer en glob pattern si la liste devient longue : `'app/api/groups/**'`. Le glob est plus future-proof (toute future route groups serait auto-protégée) — préférable une fois qu'on a >3 fichiers d'un même domaine. **Décision recommandée** : utiliser `'app/api/groups/**'` glob.

### Commit 4 — Closeout

Ajouter entry §11 dans CLAUDE.md sur le modèle des entries Lot 1 et Lot 3. Mettre à jour le compteur §6 Logs (~985 → ~963 console.log si tous les sites étaient des log, ou ~985 stable si tous étaient des error ; à ajuster selon l'audit phase 1). Mettre à jour le compteur de fichiers protégés par l'override (3 → 8, ou 3 → 4 si glob).

## Critères de succès

- `grep "console\." app/api/groups/` → 0 hit.
- `grep "from '@/lib/logger'" app/api/groups/` → 5 hits (un par fichier).
- `pnpm lint:check` exit 0. **Lint baseline** doit baisser de ~N (où N = nombre de `console.log` + nouveaux `console.error` non allow-listed dans les 5 fichiers — à mesurer pré/post).
- `pnpm typecheck` + `pnpm test:run` (30 passed / 34 skipped) + `pnpm format:check` + `pnpm build` exit 0.
- Negative regression : `SUPABASE_API_TESTS=1 pnpm test:run` toujours vert (les tests `with-auth.test.ts` couvrent groups dynamic-route, recall les overloads sont préservés).

**Smoke browser** (deferred to user) : créer un groupe via `/dashboard` → join un autre user → leave → delete. Couvre les 5 routes en flow utilisateur.

## Découpage en commits

1. `refactor(api/groups): migrate console.* to logger.* (static routes)` — 3 fichiers, 12 sites.
2. `refactor(api/groups): migrate console.* to logger.* (dynamic routes)` — 2 fichiers, 10 sites.
3. `chore(eslint): extend no-console: error override to app/api/groups/**` — glob pattern recommandé.
4. `docs(claude): closeout Sprint Cleanup-I8 / Lot 4a`

## Hors scope (rappel)

- Lot 4b : monthly-recap simples (~9 routes, ~150 sites probablement).
- Lot 4c : profile + savings/data + bank-balance (3 routes, ~52 sites).
- Lot 4d : savings/transfer (1 route, 45 sites — assez grand pour son propre commit).
- Lot 4e : routes finance résiduelles (à auditer — devraient être proches de 0 grâce à v3).
- Lot 5 : composants UI (top : SavingsDistributionDrawer, ProfileSettingsForm, AddTransactionModal — à auditer par opportunité).
- Lot 6 : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` (drop des per-file overrides quand tout le repo est clean).
- God files I4 (`lib/financial-calculations.ts`) et I5 (`process-step1`) — coordonner avec les sprints I4/I5 dédiés.
- Branchement Sentry (chantier N3 séparé).
- Alignement `lib/financial-logger.ts` (couplé I4).

## Référence

- Lot 1 (filet) : commits `bcb950f` + `7419657` + `4b1d8ad` + closeout `4ebf4ed`.
- Lot 3 (middleware + expense-allocation) : commits `44906b7` + `34cbd33` + `67f48fd` + `2ab696d` + closeout `1a46083`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-sleepy-pebble.md`.
- Convention §6 Logs + §8 À-faire / À-ne-pas-faire dans CLAUDE.md.
- Pattern test logger (regression-guard si jamais on touche `lib/logger.ts`) : [lib/**tests**/logger.test.ts](../lib/__tests__/logger.test.ts) (Sprint Cleanup-I8 / Lot 3 follow-up, 11 cas pure-unit).
