# Sprint Cleanup-I8 / Lot 5 — Migration côté client (composants + hooks + app pages)

## Contexte

Sixième salve du chantier console.log cleanup, après **Lot 4e** (`lib/api/finance/**`, 12 fichiers / 152 sites → 119/33 triage strict avec 3 cleanup-attempts CRITIQUES + 1 fallback 200-on-error préservés, lint baseline 751 → 618).

Lot 5 cible **toute la couche client** restante : composants UI, hooks, et pages App Router. C'est le dernier gros périmètre avant Lot 6 (sweep final + activation globale) et Lot 2 (`lib/finance/*`, couplé I4).

**Pourquoi grouper composants + hooks + pages dans un même Lot** : leur nature est homogène (code client, pas server-side, pas de catch-all `'Error in METHOD /api/...:'` typique des routes API). Le pattern dominant est `console.log('🎯 [Component] state', value)` (debug verbeux) + quelques `console.error('Failed to ...', error)` dans les `.catch()` de promises/mutations. Le triage Strict s'applique de manière uniforme.

**Hors scope** :

- **`lib/finance/*`** (`piggy-bank.ts`, `bank-balance.ts`, `budget-savings.ts`, `context.ts`) — couplé refactor I4 (`lib/financial-calculations.ts` 1075 LOC).
- **6 routes monthly-recap stateful** (`complete`, `balance`, `recover`, `auto-balance`, `process-step1`, `status-test`, ~334 sites cumulés) — couplé I5 (extraction logique métier `process-step1` >700 LOC).
- **`lib/financial-calculations.ts`** + **`lib/financial-logger.ts`** — couplés I4.
- **Lot 6** : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` après que I4/I5 aient atterri.

## Audit pré-sprint (au 2026-05-10 post-Lot 4e)

### Composants UI (~111 sites)

| Fichier                                              | Sites |
| :--------------------------------------------------- | ----: |
| `components/monthly-recap/MonthlyRecapFlow.tsx`      |    44 |
| `components/monthly-recap/MonthlyRecapStep2.tsx`     |    24 |
| `components/monthly-recap/MonthlyRecapStep1.tsx`     |    18 |
| `components/dashboard/SavingsDistributionDrawer.tsx` |    11 |
| `components/dashboard/TransactionTabsComponent.tsx`  |     8 |
| `components/ui/AvatarUpload.tsx`                     |     2 |
| `components/profile/ProfileSettingsCard.tsx`         |     2 |
| `components/dashboard/TransactionListItem.tsx`       |     1 |
| `components/dashboard/EditTransactionModal.tsx`      |     1 |
| `components/dashboard/EditBalanceModal.tsx`          |     1 |
| `components/dashboard/AddTransactionModal.tsx`       |     1 |
| `components/ServiceWorkerRegistration.tsx`           |     1 |

**Concentration** : 4 fichiers (MonthlyRecap × 3 + SavingsDistributionDrawer) = **97 sites sur 111** (87%). Les autres fichiers sont des miettes.

### Hooks (~62 sites)

| Fichier                          | Sites |
| :------------------------------- | ----: |
| `hooks/useRealIncomes.ts`        |    11 |
| `hooks/useRealExpenses.ts`       |    11 |
| `hooks/useMonthlyRecap.ts`       |     8 |
| `hooks/useIncomes.ts`            |     6 |
| `hooks/useGroups.ts`             |     6 |
| `hooks/useBudgets.ts`            |     6 |
| `contexts/AuthContext.tsx`       |     5 |
| `hooks/useProfile.ts`            |     3 |
| `hooks/useGroupContributions.ts` |     3 |
| `hooks/useBankBalance.ts`        |     3 |

### App pages (~26 sites)

| Fichier                      | Sites |
| :--------------------------- | ----: |
| `app/dashboard/page.tsx`     |    19 |
| `app/monthly-recap/page.tsx` |     5 |
| `app/inscription/page.tsx`   |     2 |

**Total brut Lot 5** : **~199 sites** (vs Lot 4e ~152 et Lot 4b ~132 — un peu plus large que Lot 4e). À redresser Phase 1 audit (multi-line console.log inflé typiquement de 20-25%).

## Politique de triage uniforme (héritée Lot 4e)

- **DROP** : flow logs avec emojis et debug state dumps, success traces, redundant catch-all `console.error('Error in X:', err)` dans des `.catch()` qui swallow ou re-throw sans branche métier discriminante.
- **KEEP+migrate to logger.error** : DB error inside `if (error)` après une opération Supabase spécifique (rule b — discrimine non-obvious branch), `.catch(err => ...)` sur des opérations critiques avec branchement spécifique.
- **KEEP+migrate to logger.warn** : silently-swallowed errors (catches qui retournent un fallback UI sans surface l'erreur), validation diagnostics côté client (input invalide reçu d'une API ou d'un formulaire — pour grep le "client buggy" futur).
- **KEEP+migrate (CRITICAL non-négociable)** : cleanup-attempts dans rollback paths. **À auditer Phase 1** : MonthlyRecapFlow et SavingsDistributionDrawer peuvent avoir des paths "rollback côté client" (e.g. recover après failed step), à scruter en priorité.

**Spécificités client** :

- **`useEffect` debug logs** : si un `console.log` dans un `useEffect` dump du state à chaque render, c'est typiquement DROP. La debug console DevTools + React DevTools couvrent largement.
- **`onSuccess`/`onError` callbacks** des mutations TanStack Query : les `console.error('Failed to update X:', error)` sont souvent redondants avec un toast/UI feedback déjà présent. DROP si le UX feedback couvre ; KEEP+migrate si silently-swallowed.
- **PII** : les composants manipulent souvent montants en €, names, IDs. Triage strict comme Lot 4c/4d (drop des dump-debug avec PII).

## Wirage helper logger

`import { logger } from '@/lib/logger'` au top de chaque fichier ayant ≥1 KEEP+migrate. Le logger est déjà Edge-safe (cf. Lot 1) et également utilisable côté client (gated par `LOG_LEVEL` env, accessible via `process.env.LOG_LEVEL` côté Next.js client si besoin — mais en pratique côté browser le strip prod SWC supprime `console.log/info/debug` au build, ce qui rend le logger redondant pour les niveaux gated). **Note importante** : côté browser, les `logger.error` / `logger.warn` arrivent dans la console du navigateur (puisqu'ils délèguent à `console.error`/`console.warn`). Pour l'instrumentation distante (Sentry, etc.), le branchement reste TODO chantier N3.

## Découpage proposé

### Option A — 4 commits par couche

- **Commit 1** : composants `monthly-recap/*` (3 fichiers, **86 sites**) — le gros morceau, état machine `step1 → step2 → complete` souvent dump-debug avec emojis.
- **Commit 2** : composants `dashboard/*` + `profile/*` + `ui/*` + `ServiceWorkerRegistration` (8 fichiers, **25 sites**).
- **Commit 3** : hooks (10 fichiers, **62 sites**) — pattern `mutationFn`/`onError` à uniformiser.
- **Commit 4** : app pages (3 fichiers, **26 sites**) — `app/dashboard/page.tsx` (19) est dominant, peut-être un pivot Phase 1.
- **Commit 5** : ESLint glob extension : `components/**` + `hooks/**` + `contexts/**` + `app/**/page.tsx` (à arbitrer Phase 1 selon la stratégie d'exclusions — `app/api/monthly-recap/{...stateful}` doit rester non-flagué tant qu'I5 n'a pas atterri).
- **Commit 6** : closeout CLAUDE.md + README.md.

### Option B — 3 commits par taille (miroir Lot 4b/4d)

- **Commit 1 — Heavy** : MonthlyRecapFlow (44) + MonthlyRecapStep2 (24) + MonthlyRecapStep1 (18) + app/dashboard/page.tsx (19) = **105 sites** dans 4 fichiers (composants + page).
- **Commit 2 — Medium** : SavingsDistributionDrawer (11) + useRealIncomes (11) + useRealExpenses (11) + useMonthlyRecap (8) + TransactionTabsComponent (8) + 4 hooks à 6 sites chacun (useIncomes, useGroups, useBudgets) = **74 sites**.
- **Commit 3 — Light** : tout le reste (8 hooks/contexts + composants miettes = ~20 sites).
- **Commit 4** ESLint glob + **Commit 5** closeout.

**Recommandation** : **Option B** (cohérent avec Lot 4b/4d/4e — boundaries naturels, review digérable). À arbitrer en Phase 3 selon ce que l'audit révèle.

## Décisions à arbitrer Phase 1

### Q1 — Profondeur triage

Cohérent avec Lot 4c/4d/4e (Strict, ratio ~78-84% DROP) — recommandation par défaut. **Pivot possible** : si l'audit révèle que les `console.log` dans MonthlyRecapFlow sont moins emoji-décoratifs et plus du "trace métier important" (e.g. log des décisions d'allocation à chaque step), ratio Modéré (50/50) à envisager.

### Q2 — ESLint glob — strategy

Le bloc per-file `no-console: 'error'` actuel ([eslint.config.mjs](../eslint.config.mjs:39-52)) liste 11 globs/fichiers post-Lot 4e. Pour Lot 5, **3 options** :

- **α — Globs larges** : `components/**` + `hooks/**` + `contexts/**` + `app/**/page.tsx`. **Risque** : si un fichier hors scope Lot 5 contient encore des `console.*` (e.g. un nouveau composant pas migré), il sortira lint rouge. À confirmer Phase 1 que le scope ratisse 100% des sites client (les 12 fichiers components + 10 hooks + 3 pages = 25 fichiers, à étendre par grep Phase 1 pour ne rien manquer).
- **β — Globs fins par sous-dossier** : `components/monthly-recap/**` + `components/dashboard/**` + `components/profile/**` + `components/ui/**` + `hooks/**` + `contexts/**` + `app/dashboard/page.tsx` + `app/monthly-recap/page.tsx` + `app/inscription/page.tsx`. **Avantage** : précis, future-proof comportement-confirmé.
- **γ — Liste explicite** : 25 fichiers nommés. Overkill, déprécié dès qu'on ajoute un fichier.

**Recommandation** : **α si Phase 1 confirme que tous les fichiers sont migrés**, sinon **β**.

### Q3 — Stratégie pour `app/dashboard/page.tsx` (19 sites)

Est-ce que cette page contient du flow log routinier (DROP) ou du diagnostic métier (KEEP+migrate) ? À auditer en Phase 1. Si elle contient des `console.log` autour de `useFinancialData` ou `useBudgets` callbacks, c'est probablement DROP (les TanStack Query DevTools couvrent). Si elle a des `console.error` dans des branches d'erreur, KEEP+migrate logger.error.

### Q4 — `contexts/AuthContext.tsx` (5 sites)

Ce fichier est sensible (auth flow). Les 5 sites doivent être audités individuellement — un log d'erreur silently-swallowed sur `initializeAuth()` ou `refreshUserSession()` est probablement KEEP+migrate logger.error pour grep des bugs auth en prod. Un log `'✅ User authenticated:'` dump du user object est DROP (PII + redundant avec les state changes observables via React DevTools).

## Phase 1 — Audit (à exécuter)

Lancer 2-3 Explore agents en parallèle (pattern Lot 4e) :

- **Agent 1** : Heavy MonthlyRecap (3 fichiers, 86 sites) — focus sur les patterns `step1 → step2 → complete` état machine, identifier les rollback-côté-client si présents.
- **Agent 2** : Medium components + hooks (4 hooks à 11 sites + drawers) — focus sur les `mutationFn`/`onError`/`onSuccess` callbacks, identifier les redondances avec UI feedback.
- **Agent 3** : Light + app pages — sweep le reste, classifier en DROP / KEEP+migrate.

Pour chaque fichier, demander :

1. Total `console.*` distinct statements (vs grep -c lignes — multi-line inflated typique 20-25%).
2. Numbered list de chaque site avec verdict (DROP / KEEP+migrate to logger.error/warn/debug).
3. Cleanup-attempts ou silently-swallowed errors (KEEP non-négociable).
4. Catch blocks needing `} catch {}` après DROP.

## Critères de succès

### Greps invariants (post commits 1-3)

```
Grep -P "console\.(log|error|warn|info|debug)" components/ hooks/ contexts/ app/dashboard/ app/monthly-recap/ app/inscription/
# 0 hit (sauf exceptions documentées du type ServiceWorkerRegistration)
Grep -l "from '@/lib/logger'" components/ hooks/ contexts/
# ≥N fichiers (1 par fichier ayant ≥1 KEEP)
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 618 → ~450-500 estimé** (~120-160 warnings supprimés via DROP de `console.log` allow-listed-as-warn).
- `pnpm test:run` 30 passed / 34 skipped inchangé
- `pnpm format:check` exit 0 sur les fichiers touchés
- `pnpm build` 56/56 routes exit 0
- `pnpm verify` exit 0

### Smoke browser (deferred to user)

- `/dashboard` + `/group-dashboard` exercent les `app/dashboard/page.tsx` + AddTransactionModal + EditTransactionModal + EditBalanceModal + TransactionTabsComponent + TransactionListItem + SavingsDistributionDrawer
- `/monthly-recap` exerce le flow complet `MonthlyRecapFlow → Step1 → Step2`
- `/settings` exerce ProfileSettingsCard + AvatarUpload
- `/inscription` exerce app/inscription/page.tsx
- Login/logout exerce AuthContext
- Rest des hooks exercés indirectement par les flows ci-dessus

### Ratio supprimé/migré documenté dans le closeout

Format attendu : "X supprimés, Y migrés sur N sites — Z% de bruit éliminé". Estimation triage **Strict** : **~150-160 KEEP / ~30-50 DROP** (~80%/~20%) si l'audit confirme la dominance flow-log debug.

## Pivots possibles à anticiper en Phase 1

1. **Compteur 199 vs sites distincts** : confirmer après lecture intégrale (multi-line console.log peuvent gonfler le `grep -c`). Précédent Lot 4b : 203 → 132 (−35%). Précédent Lot 4d : 45 → 38 (−16%). Précédent Lot 4e : 190 → 152 (−20%).
2. **`MonthlyRecapFlow.tsx` (44 sites)** : c'est le plus gros consommateur du repo hors god files. Il pilote l'état machine recap mensuel. Risque : si certains logs tracent des décisions métier non-évidentes (e.g. routing step1 vs step2 selon un état serveur), KEEP+migrate. Sinon DROP en masse.
3. **Bridge legacy `triggerFinancialRefresh`/`registerFinancialRefreshCallback`** : déjà supprimé Sprint 2. Aucune trace attendue dans hooks. Si trouvée, c'est un oubli — DROP.
4. **TanStack Query `onError`/`onSuccess` callbacks** : pattern courant dans hooks/CRUD. La règle d'or s'applique strictement — DROP si UI feedback couvre, KEEP si silently-swallowed.
5. **`app/dashboard/page.tsx` (19 sites)** : pic anormal pour une page. Probablement debug d'intégration TanStack Query. Audit Phase 1 prioritaire — si ces 19 sites sont du flow log debug verbeux (pattern miroir `app/api/monthly-recap/step1-data` Lot 4b 100% DROP), DROP en masse.

## Référence

- **Lot 4a** (Modéré 50/50) : `app/api/groups/**`, 22 sites, plan `sprint-cleanup-i8-glistening-beaver.md`
- **Lot 4b** (Aggressif 86/14) : `app/api/monthly-recap/{...9 routes simples}`, 132 sites, plan `sprint-cleanup-i8-atomic-minsky.md`
- **Lot 4c** (Strict 83/17) : `app/api/{profile,savings/data,bank-balance}`, 52 sites, plan `sprint-cleanup-i8-temporal-octopus.md`
- **Lot 4d** (Strict single-file 84/16, 3 cleanup-attempts CRITIQUES) : `app/api/savings/transfer`, 38 sites, plan `sprint-cleanup-i8-cached-valley.md`
- **Lot 4e** (Strict 78/22, 3 cleanup-attempts CRITIQUES + 1 fallback 200-on-error) : `lib/api/finance/**`, 152 sites, plan `sprint-cleanup-i8-synthetic-noodle.md`
- Convention §6 Logs (règle d'or de triage + per-file ESLint override) + §8 À-faire / À-ne-pas-faire dans CLAUDE.md
- Logger : [lib/logger.ts](../lib/logger.ts) (Sprint Cleanup-I8 / Lot 1)
- Tests pure-unit logger : [lib/**tests**/logger.test.ts](../lib/__tests__/logger.test.ts) (Sprint Cleanup-I8 / Lot 3 follow-up)
