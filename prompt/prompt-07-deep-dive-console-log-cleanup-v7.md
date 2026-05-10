# Sprint Cleanup-I8 / Lot 4e — Migration `lib/api/finance/**`

## Contexte

Cinquième salve API du chantier console.log cleanup, après **Lot 4a** (`app/api/groups/**`, 22 sites → 11 DROP / 11 KEEP triage Modéré), **Lot 4b** (`app/api/monthly-recap/{...9 routes simples}/**`, 132 sites → 113/19 triage Agressif), **Lot 4c** (`app/api/{profile,savings/data,bank-balance}/**`, 52 sites → 43/9 triage Strict), et **Lot 4d** (`app/api/savings/transfer/route.ts`, 38 sites → 32/6 triage Strict avec 3 cleanup-attempts CRITIQUES préservés).

Lot 4e cible le **plus gros périmètre du chantier hors god files** : les 12 modules de `lib/api/finance/` qui hébergent les handlers extraits par Sprint Refactor-Architecture-v3 (le namespace canonique unifié `/api/finance/*`). C'est aussi le périmètre le plus dense en `console.log` debug verbeux après les routes `monthly-recap` (Lot 4b).

**Pourquoi `lib/api/finance/**`plutôt que`app/api/finance/**`** : les `route.ts` sous `app/api/finance/` sont des **thin wrappers** (1-ligne `export { GET, POST } from '@/lib/api/finance/<route>'`) — 0 site `console.*`. Toute la logique est dans `lib/api/finance/`. Le pattern de découpage installé Sprint Refactor-Architecture-v3 porte ses fruits : les handlers sont importables (et testables) sans dépendre de la convention `route.ts`. Toutes les 12 fonctions `lib/api/finance/<route>.ts` sont déjà wrappées par `withAuth(AndProfile)` depuis Sprint v3 — pas de boilerplate auth à toucher.

**Hors scope** : `lib/api/finance/income-real.ts` consomme [`lib/financial-logger.ts`](../lib/financial-logger.ts) (la classe `FinancialLogger`, 289 LOC, domain-specific avec `startOperation/success/databaseError/etc.` toujours active sans gate `LOG_LEVEL`). Son alignement avec `lib/logger.ts` est couplé au refactor I4 (cf. CLAUDE.md §6 Logs). Pour Lot 4e : les 14 `console.*` directs dans `income-real.ts` (probablement diagnostics ad-hoc séparés de la FinancialLogger instrumentation) sont à triager comme partout ailleurs ; **ne PAS toucher** aux call sites `FinancialLogger.startOperation(...)` / `log.success(...)` / `log.databaseError(...)` etc. — c'est I4 qui décidera de les fold dans `lib/logger.ts` ou de garder la classe domain-specific.

## Audit pré-sprint (au 2026-05-10 post-Lot 4d)

`Grep -cE "console\.(log|error|warn|info|debug)" lib/api/finance/*.ts` :

| Fichier                                         | Sites | Notes                                                                                                                                                                                           |
| :---------------------------------------------- | ----: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/api/finance/expenses-add-with-logic.ts`    |    35 | **Top consumer**. Probablement de la trace verbeuse sur le smart-allocation tirelire→savings→budget (CLAUDE.md §5)                                                                              |
| `lib/api/finance/incomes.ts`                    |    33 | CRUD incomes — probable mix de flow logs verbeux + DB errors discriminantes (3 méthodes HTTP)                                                                                                   |
| `lib/api/finance/budgets.ts`                    |    33 | CRUD budgets POST/PUT/DELETE (le GET supprimé en Sprint Refactor-Architecture-v2 / B.1) — pattern miroir d'`incomes.ts` attendu                                                                 |
| `lib/api/finance/summary.ts`                    |    28 | Aggregator dashboard — préserve un fallback 200-with-default-data dans le catch (Sprint v3 explicite). Triage doit conserver la sémantique des 200-on-error                                     |
| `lib/api/finance/income-real.ts`                |    14 | **Consume `FinancialLogger`** — ne PAS toucher aux call sites `FinancialLogger.*` ; les 14 `console.*` directs sont à triager séparément, probablement diagnostics ad-hoc (à confirmer Phase 1) |
| `lib/api/finance/expenses-real.ts`              |    14 | CRUD real expenses — smart-allocation possible (mutation result peut être `null` si dépense couverte 100% par piggy/savings, cf. `useRealExpenses` doc CLAUDE.md §4)                            |
| `lib/api/finance/income-estimated.ts`           |    11 | CRUD estimated incomes ; pattern probablement homogène avec `incomes.ts`                                                                                                                        |
| `lib/api/finance/expenses-progress.ts`          |     9 | Aggregator par budget — vérifier patterns 200-with-empty-fallback                                                                                                                               |
| `lib/api/finance/budgets-estimated.ts`          |     8 | Probable read-only handler                                                                                                                                                                      |
| `lib/api/finance/rav.ts`                        |     3 | Reste-À-Vivre calc — trois sites suggèrent un single error path. À audit Phase 1                                                                                                                |
| `lib/api/finance/income-progress.ts`            |     1 | Un seul site — likely DB-error discriminator                                                                                                                                                    |
| `lib/api/finance/expenses-preview-breakdown.ts` |     1 | Idem                                                                                                                                                                                            |

**Total : 190 sites distincts** (compté ligne-par-ligne, possiblement ~155-170 statements distincts si certains spans multi-line — pattern Lot 4b/4d redux).

`Grep -cE "console\.(log|error|warn|info|debug)" $(find app/api/finance -name 'route.ts')` : **0 sites** (re-exports thin).

## Comparaison aux Lots précédents

| Lot        | Périmètre                                        | Sites attendus | Sites réels | Ratio DROP/KEEP livré | Lint baseline             |
| :--------- | :----------------------------------------------- | -------------: | ----------: | :-------------------- | :------------------------ |
| Lot 4a     | `app/api/groups/**`                              |          15-22 |          22 | 50/50 (Modéré)        | 990 stable (allow-listed) |
| Lot 4b     | `app/api/monthly-recap/{...9}/**`                |            203 |         132 | 86/14 (Aggressif)     | 990 → 819 (−171)          |
| Lot 4c     | `app/api/{profile,savings/data,bank-balance}/**` |             52 |          52 | 83/17 (Strict)        | 819 → 783 (−36)           |
| Lot 4d     | `app/api/savings/transfer/route.ts`              |             45 |          38 | 84/16 (Strict)        | 783 → 751 (−32)           |
| **Lot 4e** | `lib/api/finance/**` (12 fichiers)               |        **190** |       **?** | **TBD Phase 1**       | 751 → ~?? (TBD)           |

Lot 4e est ~2× le scope de Lot 4b (le précédent record). C'est suffisamment gros pour **plusieurs commits par taille** (mirror Lot 4b).

## Wirage helper auth (à confirmer Phase 1)

Toutes les 12 fonctions doivent être `export const VERB = withAuth(AndProfile)(...)` per Sprint v3. Vérifier en Phase 1 via `Grep "validateSessionToken" lib/api/finance/` → 0 hit attendu.

## Décisions à arbitrer en Phase 1/3

### Q1 — Profondeur triage

Trois options selon la nature des sites observés Phase 1 :

- **Strict (Lot 4c/4d precedent)** : DROP les flow logs même si discriminateur (ratio attendu ~80% DROP). KEEP+migrate uniquement DB errors discriminantes + cleanup-attempts + silently-swallowed.
- **Modéré (Lot 4a precedent)** : KEEP+migrate les flow logs sur les ops critiques (smart-allocation, RAV calc) si payload utile au diagnostic post-mortem. Ratio attendu ~60% DROP.
- **Aggressif (Lot 4b precedent)** : DROP très large des dump-debug et success paths. Ratio attendu ~85-90% DROP.

**Recommandation par défaut** : **Strict**. Cohérent avec Lot 4c (PII context — ces fichiers manipulent montants en €, IDs budget/income/expense) et Lot 4d. Mais ouvrir au pivot si Phase 1 surface beaucoup de séparateurs `🎯/📊/🏦` (cas Lot 4b → Aggressif) ou si ratio DB-errors >40% (cas Lot 4a → Modéré).

### Q2 — Découpage en commits

3 options selon la taille brute :

- **Option A — 1 commit unique** : tout en un. **Déconseillé** — 190 sites / 12 fichiers, le diff sera massif et peu reviewable.
- **Option B — 3 commits par taille** (recommandé miroir Lot 4b) :
  - **Commit 1 — Heavy** : top 4 fichiers (`expenses-add-with-logic` 35, `incomes` 33, `budgets` 33, `summary` 28) = **129 sites** dans 4 fichiers cohérents (CRUD principaux + aggregator dashboard).
  - **Commit 2 — Medium** : 4 fichiers (`income-real` 14, `expenses-real` 14, `income-estimated` 11, `expenses-progress` 9) = **48 sites** dans 4 fichiers (real CRUD + progress).
  - **Commit 3 — Light** : 4 fichiers restants (`budgets-estimated` 8, `rav` 3, `income-progress` 1, `expenses-preview-breakdown` 1) = **13 sites** + ESLint glob extension.
- **Option C — Split par concern** (CRUD vs aggregators vs real-vs-estimated) : moins lisible, moins facile à reverter. Skip.

**Recommandation** : **Option B**. Commit boundaries naturelles (heavy/medium/light) ; review reste digérable.

### Q3 — Interaction avec `lib/financial-logger.ts` dans `income-real.ts`

`income-real.ts` import `FinancialLogger from '@/lib/financial-logger'` et l'utilise (`FinancialLogger.startOperation(...)`, `log.success(...)`, etc.). Les 14 sites `console.*` directs sont **séparés** de cette instrumentation.

**Décision recommandée** : ne PAS toucher aux call sites `FinancialLogger.*` (couplé I4). Triager les 14 `console.*` directs comme partout ailleurs. Si un `console.*` direct s'avère redondant avec un `log.databaseError(...)` du FinancialLogger sur la même branche d'erreur → DROP (pas migration vers `logger.error`). À évaluer site par site Phase 1.

### Q4 — ESLint glob extension

État actuel ([eslint.config.mjs](../eslint.config.mjs:39-50) post-Lot 4d) :

```js
files: [
  'middleware.ts',
  'lib/expense-allocation.ts',
  'lib/logger.ts',
  'app/api/groups/**',
  'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**',
  'app/api/profile/**',
  'app/api/savings/**',
  'app/api/bank-balance/**',
],
```

État après — **2 globs à ajouter** :

```js
files: [
  ...existing,
  'lib/api/finance/**',
  'app/api/finance/**',  // future-proof : aujourd'hui 0 site, mais protège contre tout futur écart route.ts
],
```

**Sanity test** : injecter `console.log("test")` dans `lib/api/finance/budgets.ts` → `pnpm lint:check` doit exit 1 avec 1 error.

### Q5 — Préservation de `summary.ts` 200-with-default fallback

Sprint Refactor-Architecture-v3 a explicitement préservé le fallback 200-with-default-data dans le `catch` de `summary.ts` (UX choice — ne pas casser le dashboard sur erreur transitoire). Le `console.error` actuel à l'intérieur de ce catch peut être DROP sans risque (Next.js capture la stack côté Vercel) OU KEEP+migrate si l'erreur permet de discriminer un mode dégradé du dashboard.

**Recommandation** : **KEEP+migrate vers `logger.warn`** (pas `error` — le 200 répond OK, sémantique = warning sur fallback déclenché). À arbitrer Phase 1 selon le contenu du log.

## Découpage en 4 commits

### Commit 1 — `refactor(api/finance/heavy): triage console.* — drop flow + dump-debug, migrate DB errors`

Scope : 4 fichiers (top contributors).

- `lib/api/finance/expenses-add-with-logic.ts` (35 sites) — smart-allocation tirelire→savings→budget. **Cleanup-attempts probables** : si une étape de l'allocation fail, rollback des étapes précédentes — à scruter Phase 1 (pattern miroir Lot 4d).
- `lib/api/finance/incomes.ts` (33 sites) — CRUD incomes 3 méthodes HTTP.
- `lib/api/finance/budgets.ts` (33 sites) — CRUD budgets POST/PUT/DELETE.
- `lib/api/finance/summary.ts` (28 sites) — aggregator dashboard avec fallback 200-with-default (cf. Q5).

**Imports** : `import { logger } from '@/lib/logger'` au top de chaque fichier ayant ≥1 KEEP+migrate.

**Estimation triage Strict** : ~25 KEEP / ~104 DROP (~80% DROP).

**Verif intermédiaire** : `pnpm typecheck && pnpm lint:check` exit 0.

### Commit 2 — `refactor(api/finance/medium): triage console.* — real CRUD + progress`

Scope : 4 fichiers.

- `lib/api/finance/income-real.ts` (14 sites) — **interaction `FinancialLogger`** (cf. Q3).
- `lib/api/finance/expenses-real.ts` (14 sites) — smart-allocation possible.
- `lib/api/finance/income-estimated.ts` (11 sites).
- `lib/api/finance/expenses-progress.ts` (9 sites).

**Estimation triage Strict** : ~10 KEEP / ~38 DROP.

### Commit 3 — `refactor(api/finance/light): triage console.* — last 4 files`

Scope : 4 fichiers.

- `lib/api/finance/budgets-estimated.ts` (8 sites)
- `lib/api/finance/rav.ts` (3 sites)
- `lib/api/finance/income-progress.ts` (1 site)
- `lib/api/finance/expenses-preview-breakdown.ts` (1 site)

**Estimation triage Strict** : ~3 KEEP / ~10 DROP.

### Commit 4 — `chore(eslint): add lib/api/finance + app/api/finance globs (Lot 4e)`

Modification [eslint.config.mjs](../eslint.config.mjs) (Q4) — ajout 2 globs.

**Sanity test** : injection `console.log("test")` dans `lib/api/finance/budgets.ts` → `pnpm lint:check` exit 1 avec 1 error sur la ligne injectée. Revert.

### Commit 5 — `docs(claude): closeout Sprint Cleanup-I8 / Lot 4e`

Mises à jour [CLAUDE.md](../CLAUDE.md) :

- **§1 Score line** : ajouter `~98.2 stable après Lot 4e (lib/api/finance/, 12 fichiers, ~190 sites → ~XX/~YY triage strict, lint baseline 751 → ~6XX)`.
- **§6 Logs / titre** : `Lot 1 + Lot 3 + Lot 4a + Lot 4b + Lot 4c + Lot 4d + Lot 4e`.
- **§6 Logs / Per-file ESLint override** : actualiser la liste avec les 2 nouveaux globs `lib/api/finance/**` + `app/api/finance/**` (mention que `app/api/finance/**` est ajouté en future-proof, 0 site actuellement).
- **§6 Logs / Migration progressive** : recompter via `Grep -cE "console\." {fichiers top 5}`. Top 5 fichiers va probablement bouger (process-step1, financial-calculations, complete restent stables ; auto-balance et balance probablement stables aussi). Mention ratio Lot 4e + interaction `financial-logger.ts` à I4.
- **§11 Roadmap** : entry `✅ Sprint Cleanup-I8 / Lot 4e` + update item ⏭️ "Chantier console.log cleanup — Lots 2 / 4e-6" → "Lots 2 / 5-6". Mention en hors scope que `app/api/finance/route.ts` files ont 0 sites (pattern thin re-exports installé Sprint Refactor-Architecture-v3 → couvert par le glob `app/api/finance/**` future-proof).

[README.md](../README.md) ligne 316 et insertion d'un bloc Lot 4e après Lot 4d (ligne 350) si l'auto-update §11 ne suffit pas.

## Critères de succès

### Greps invariants (post commit 3)

```
Grep -P "console\.(log|error|warn|info|debug)" lib/api/finance/*.ts          # 0 hit
Grep -l "from '@/lib/logger'" lib/api/finance/*.ts                           # ≥6 fichiers (1 par fichier ayant ≥1 KEEP)
```

### Verif end-to-end (post commit 5)

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. Lint baseline **751 → ~600-650** estimé (la dette `console.log` allow-listed-as-warn dans `lib/api/finance/` représente ~110-130 warnings selon ratio triage).
- `pnpm test:run` 30 passed / 34 skipped inchangé (les tests gated `SUPABASE_API_TESTS=1` dans `lib/__tests__/api-regressions.test.ts` couvrent déjà les régressions de ces handlers — re-run avec env var pour s'assurer ≥10 passed sur le bucket `SUPABASE_API_TESTS`).
- `pnpm format:check` exit 0 (sur les fichiers touchés).
- `pnpm build` 56/56 routes exit 0.
- `pnpm verify` exit 0 (chaîne complète).

### Smoke browser (deferred to user)

- `/dashboard` → exerce `summary` (aggregator), `budgets-estimated` (read), `expenses-progress` (aggregator), `income-progress`, `rav`.
- `/dashboard` planning drawer → exerce `budgets`, `incomes`, `income-estimated`.
- AddTransactionModal → exerce `expenses-real` POST, `expenses-add-with-logic` (smart-allocation), `expenses-preview-breakdown`.
- AddIncomeDialog / EditIncomeDialog → exerce `income-real`, `income-estimated`.
- `/group-dashboard` → exerce les mêmes mais avec `forGroup=true`.
- **Tests gated SUPABASE_API_TESTS=1** : faire tourner manuellement `SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts` post-commit 1 (ou commit 2) — couvre `summary`, dashboard aggregates, `expenses-progress`, `bank-balance` (Sprint Polish T3 + Sprint Lint-Followups Item 1). Si rouge, le triage a accidentellement modifié un comportement métier — investiguer le diff avant de continuer.

### Ratio supprimé/migré documenté dans le closeout

Format attendu : "X supprimés, Y migrés sur 190 sites — Z% de bruit éliminé". Estimation triage **Strict** : **~38 KEEP / ~152 DROP** (~80%/~20%).

## Pivots possibles à anticiper en Phase 1

L'audit pré-sprint des Lots 4a-d a régulièrement surfacé des écarts vs l'estimation initiale. Pour Lot 4e :

1. **Compteur 190 vs sites distincts** : confirmer après lecture intégrale (multi-line console.log peuvent gonfler le `grep -c`). Précédent Lot 4b : −53 (203 → 132). Précédent Lot 4d : −7 (45 → 38).
2. **Cleanup-attempts dans `expenses-add-with-logic.ts`** : si le smart-allocation fait du SELECT-then-UPDATE ou des updates en chaîne tirelire→savings→budget, des rollback en cascade peuvent exister. Pattern miroir Lot 4d (3 cleanup-attempts CRITIQUES). À auditer en priorité Phase 1 — KEEP non-négociable si trouvés.
3. **`summary.ts` 200-with-default fallback** : 28 sites sur un seul fichier = la majorité dump-debug. Le `console.error` du catch outer mérite KEEP+migrate vers `logger.warn` (pas `error`, sémantique 200-on-error).
4. **`income-real.ts` interaction FinancialLogger** : 14 sites `console.*` directs séparés des 5+ call sites `FinancialLogger.*`. Vérifier que les 14 directs ne dupliquent pas la sémantique du logger class (sinon DROP ; sinon KEEP+migrate vers `logger.error`).
5. **`rav.ts` 3 sites** : possiblement 1 seul try/catch avec error + warn + log debug. Audit rapide → triage simple.
6. **Patterns d'agrégation** dans `summary.ts`, `expenses-progress.ts`, `income-progress.ts` : si l'agrégation contient des branches "data manquante → 0 ou empty array" silencieusement, ces silently-swallowed catches sont KEEP+migrate.

Ces pivots sont normaux — la règle d'or de triage (CLAUDE.md §6 Logs) guide les décisions, mais arbitrage user nécessaire pour les cas frontière.

## Hors scope (rappel)

- **Lot 5** : composants UI. Top consumer attendu : `components/monthly-recap/MonthlyRecapFlow.tsx` 44 sites. Possiblement aussi `components/dashboard/AddTransactionModal.tsx`, `components/dashboard/PlanningDrawer.tsx`, `components/dashboard/SavingsDistributionDrawer.tsx`.
- **Lot 6** : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` + ajout des routes monthly-recap stateful (`complete`, `balance`, `recover`, `auto-balance`, `process-step1`) après que I5 ait extrait leur logique métier (~347 sites).
- **Lot 2** (`lib/finance/*` — `piggy-bank.ts`, `bank-balance.ts`, `budget-savings.ts`, `context.ts`) reste couplé I4 (refactor `lib/financial-calculations.ts` 1075 LOC).
- **Alignement `lib/financial-logger.ts` ↔ `lib/logger.ts`** : couplé I4. Lot 4e laisse les call sites `FinancialLogger.*` intacts ; seuls les `console.*` directs sont migrés.
- Branchement Sentry (chantier N3).

## Référence

- **Lot 4a** (Modéré, 22 sites → 11/11) : commits `877504b` / `8de275e` / `84e4e84` / `f6dd1b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-glistening-beaver.md`. Source de la règle d'or de triage.
- **Lot 4b** (Aggressif, 132 sites → 113/19) : commits `40e6099` / `60a8457` / `1b71f53` / `0694534` / `2df49b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-atomic-minsky.md`. Première salve avec découpage par taille (3 commits heavy/medium/light).
- **Lot 4c** (Strict, 52 sites → 43/9) : commits `6087506` / `48556f0` / `edd068f`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-temporal-octopus.md`. Premier triage strict avec drop critique de PII.
- **Lot 4d** (Strict single-file, 38 sites → 32/6 dont 3 cleanup-attempts CRITIQUES) : commits `79cbe8b` / `e6e5da9` / `56a4532`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-cached-valley.md`. Pattern cleanup-attempt rollback à reproduire si surfaced en Lot 4e (smart-allocation path).
- Convention §6 Logs (règle d'or de triage + per-file ESLint override) + §8 À-faire / À-ne-pas-faire dans CLAUDE.md.
- Pattern test logger : [lib/**tests**/logger.test.ts](../lib/__tests__/logger.test.ts) (11 cas pure-unit non-gated).
- Helper auth : [lib/api/with-auth.ts](../lib/api/with-auth.ts) — toutes les 12 fonctions `lib/api/finance/<route>.ts` sont wrappées (Sprint Refactor-Architecture-v3).
- Logger : [lib/logger.ts](../lib/logger.ts) (Sprint Cleanup-I8 / Lot 1) — `logger.error/warn/info/debug`, gated `LOG_LEVEL`.
- FinancialLogger (hors scope, couplé I4) : [lib/financial-logger.ts](../lib/financial-logger.ts).
