# Sprint Cleanup-I8 / Lot 1 follow-up + Lot 3 — Tests logger + migration middleware/expense-allocation

## Contexte

Le Lot 1 du chantier console.log cleanup est livré (Sprint Cleanup-I8 / Lot 1, 2026-05-10, commits `bcb950f` + `7419657` + `4b1d8ad`). État actuel :

- ✅ [`lib/logger.ts`](../lib/logger.ts) en place — 4 niveaux (`error/warn/info/debug`), gated par `LOG_LEVEL`, défaut `warn` prod / `debug` dev, Edge-safe.
- ✅ [`next.config.js`](../next.config.js) `compiler.removeConsole` strip les `console.log/info/debug` au build prod (`exclude: ['error', 'warn']`). Verifié post-build : 0 `console.log` dans `.next/server/app/`.
- ✅ ESLint `'no-console': ['warn', { allow: ['warn', 'error'] }]` déjà en place ([eslint.config.mjs:29](../eslint.config.mjs#L29)) depuis Sprint Lint-Baseline-Cleanup.
- ✅ CLAUDE.md §6 Logs + §8 + §10 + §11 + `.env.example` documentés.

**Ce qui reste** (state actuel) :

- 986 `console.log` + 328 `console.error` dans le code source (top 5 fichiers : `process-step1/route.ts` 116, `financial-calculations.ts` 95, `complete/route.ts` 65, `balance/route.ts` 62, `step1-data/route.ts` 57).
- 0 test sur [`lib/logger.ts`](../lib/logger.ts) — la level-filtering logic + `getCurrentLevel()` env handling ne sont pinned par aucune régression-guard.
- `lib/financial-logger.ts` (289 LOC, 1 consumer dans `lib/api/finance/income-real.ts`) reste tel quel — alignement deferred au refactor I4.

Ce prompt couvre **2 items indépendants** qui peuvent être livrés ensemble ou séparément. L'un est un follow-up Lot 1 (tests), l'autre est le **Lot 3** du plan original (migration `middleware.ts` + `lib/expense-allocation.ts`). Le Lot 2 (`lib/finance/*`) reste explicitement couplé au refactor I4 — pas de scope ici.

## Item 1 — Tests pure-unit pour `lib/logger.ts`

### Pourquoi maintenant

- Le Lot 1 a installé un module utilisé partout dans les Lots 2-6 à venir. Si on regrette la signature ou un edge case (ex: `LOG_LEVEL=invalid` qui devrait fall back au défaut), les tests le pin avant que 50+ call sites ne dépendent du comportement actuel.
- Pattern miroir [Sprint 2-followup-v4](../CLAUDE.md) : `authReducer` extrait → tests pure-unit non-gated (14 cas). Le repo a une convention claire pour les modules pure (sans Supabase / sans React) → tests dans `lib/__tests__/`, import direct (pas de dynamic import dans `beforeAll`), pas de gate.

### Critères

- Créer [`lib/__tests__/logger.test.ts`](../lib/__tests__/logger.test.ts) (mirror [`lib/__tests__/auth-reducer.test.ts`](../lib/__tests__/auth-reducer.test.ts) pattern).
- Tests à inclure :
  1. Default level en dev (`process.env.NODE_ENV` autre que 'production') = `debug`.
  2. Default level en prod = `warn`.
  3. `LOG_LEVEL=error` → seul `logger.error` sort.
  4. `LOG_LEVEL=warn` → `error` + `warn` sortent, `info`/`debug` filtrés.
  5. `LOG_LEVEL=info` → `error`/`warn`/`info` sortent, `debug` filtré.
  6. `LOG_LEVEL=debug` → tous sortent.
  7. `LOG_LEVEL=invalid` ou `LOG_LEVEL=''` → fall back au défaut (en dev `debug`, en prod `warn`).
  8. `LOG_LEVEL` est case-insensitive (`'INFO'`, `'Info'`, `'info'` équivalents).
  9. Le rest-spread args sont passés à `console.*` après le préfixe `[level]` (e.g. `logger.debug('msg', 1, 'a')` → `console.debug('[debug] msg', 1, 'a')`).
- **Gotcha attendu** : `lib/logger.ts` cache `currentLevel` à module load. Pour tester différentes valeurs de `LOG_LEVEL` / `NODE_ENV`, il faut :
  - `vi.stubEnv('LOG_LEVEL', '...')` + `vi.resetModules()` + `await import('@/lib/logger')` à chaque test (ou dans `beforeEach`).
  - `vi.restoreAllMocks()` + `vi.unstubAllEnvs()` dans `afterEach`.
  - Mock `console.error/warn/info/debug` via `vi.spyOn(console, '...')` pour assert sur les appels sans pollution stdout.
- **Pas d'`console.log` testé** — le logger n'utilise pas `console.log` (il utilise `console.info`/`debug` qui sont strippés par `removeConsole` en prod, vérifié au build du Sprint Cleanup-I8 / Lot 1).

### Fichiers à toucher

- `lib/__tests__/logger.test.ts` — créé. ~80-120 LOC attendu.

### Verif

- `pnpm test:run` → 19 → ~28 passed (selon nombre exact de cas), 34 skipped (gated inchangés).
- `pnpm typecheck` + `pnpm lint:check` exit 0.
- Pas de touche à `pnpm verify` (ce script ne lance que `typecheck` + `test:run` + `db:*` checks).

---

## Item 2 — Lot 3 : migration `middleware.ts` + `lib/expense-allocation.ts`

### Pourquoi ces 2 fichiers

- **Petit scope, propre, isolé.** Pas de coupling avec I4/I5. Valide le pattern de migration sur un volume gérable avant de commencer le god file `process-step1` (couplé I5) ou `financial-calculations.ts` (couplé I4).
- **`middleware.ts`** : 1 `console.log` (line 71) + 2 `console.error` (lines 80, 93). Edge runtime (vérifier compat).
- **`lib/expense-allocation.ts`** : à auditer en début de sprint via `grep "console\." lib/expense-allocation.ts -c`. Les call sites devraient être tous des debug/error (le fichier est consommateur d'API, pas d'IO direct).

### Workflow par fichier

1. **Lire le fichier** entièrement.
2. **Pour chaque `console.log`** :
   - Choisir le niveau approprié — `debug` pour les flow logs (ex: `📅 [Middleware] Récap mensuel requis`), `info` pour les events utilisateur (ex: login successful, transaction created), `error` pour les erreurs.
   - Garder le contenu du message **verbatim** (préserver les emojis, les préfixes `[Middleware]`, etc.). C'est le compromis "drop-in mécanique" : on ne réécrit pas le message, on change juste le mécanisme.
   - Préserver les arguments rest-spread (`...rest`).
3. **Pour chaque `console.error`** :
   - Devenir `logger.error`.
   - Si l'appel est dans un `catch (error)` : ajouter du contexte structuré quand pertinent. Exemple :
     ```ts
     // Avant
     console.error('❌ [Middleware] Erreur lors de la vérification du récap mensuel:', error)
     // Après
     logger.error('❌ [Middleware] Erreur lors de la vérification du récap mensuel', {
       error: error instanceof Error ? error.message : String(error),
     })
     ```
   - Mais : **ne pas refactor si l'appel n'a qu'un message simple**. Drop-in mécanique seulement. Le rest-spread `...rest: unknown[]` accepte les patterns existants comme `console.error('msg:', error)`.
4. **Ajouter un `import { logger } from '@/lib/logger'`** en haut du fichier.
5. **Pour `middleware.ts`** : vérifier que l'import `lib/logger.ts` est Edge-safe (le module ne fait que `console.*` + `process.env`, donc OK — déjà confirmé au Sprint Cleanup-I8 / Lot 1).
6. **Per-file ESLint override** dans [`eslint.config.mjs`](../eslint.config.mjs) : ajouter une nouvelle config block après le block existant pour escalader `no-console: 'error'` sur les fichiers migrés. Pattern :
   ```js
   {
     files: ['middleware.ts', 'lib/expense-allocation.ts', 'lib/logger.ts'],
     rules: { 'no-console': 'error' },
   },
   ```

   - Ça garantit qu'aucun nouveau `console.log` ne réapparaît dans ces fichiers.
   - `lib/logger.ts` est inclus dans la liste car le block `eslint-disable no-console` au top du fichier est volontaire (le module est la frontière) — le passer à `error` ne fait que durcir le contrat.

### Critères de succès Lot 3

- `grep -rn "console\." middleware.ts lib/expense-allocation.ts | grep -v logger.ts` → 0 hit.
- `pnpm lint:check` exit 0 — la baseline 991 warnings doit baisser de N (où N = nombre de `console.*` migrés ; ~3 pour middleware + ~X pour expense-allocation à compter au démarrage).
- `pnpm typecheck` + `pnpm test:run` (19 passed / 34 skipped) + `pnpm format:check` + `pnpm build` (56/56 routes) exit 0.
- Smoke browser : naviguer une route protégée pour faire fire le middleware (e.g. `/dashboard` non-loggé → redirect `/connexion`) ; vérifier qu'aucune erreur runtime nouvelle.

### Risques / pièges

- **Ne PAS toucher `lib/financial-calculations.ts`** (god file I4) ni `app/api/monthly-recap/process-step1/route.ts` (god file I5) — explicitement hors scope, coordonner avec les sprints I4/I5.
- **Ne PAS toucher `lib/financial-logger.ts`** — alignement deferred I4. Son seul consumer (`lib/api/finance/income-real.ts`) reste tel quel.
- **Pour `middleware.ts`** : le code dans le `try/catch` outer (line 36-103) est Edge runtime sensible. Tester qu'aucun import dans `lib/logger.ts` ne casse l'Edge build (devrait passer puisque déjà validé Sprint Cleanup-I8 — mais valider visuellement le `pnpm build` n'émet aucun warning Edge).
- **Per-file override ESLint** — vérifier qu'il s'applique bien après les autres blocks (ESLint flat config = order matters, le dernier match wins).

---

## Combinaison vs séparation

Les 2 items sont **indépendants**. Recommandation :

- **Si la session est courte** : faire Item 1 seul (tests logger). Item 2 nécessite vérif end-to-end (smoke browser middleware) qui prend du temps.
- **Si la session est longue** : faire les 2 dans l'ordre (Item 1 → Item 2). L'Item 1 pin le comportement du logger avant que des call sites en dépendent.
- **Si on veut juste valider le filet** : faire Item 2 seul. Item 1 est un nice-to-have mais pas un blocker.

Découpage en commits suggéré :

- **Commit 1** (Item 1) : `test(logger): add pure-unit tests for level filtering and LOG_LEVEL env handling`
- **Commit 2** (Item 2 / middleware) : `refactor(middleware): migrate console.* to logger.*`
- **Commit 3** (Item 2 / expense-allocation) : `refactor(expense-allocation): migrate console.* to logger.*`
- **Commit 4** (Item 2 / ESLint) : `chore(eslint): escalate no-console to error for migrated files`
- **Commit 5** (closeout) : `docs(claude): closeout Sprint Cleanup-I8 / Lot 3`

CLAUDE.md §11 entry à ajouter au closeout :

```markdown
- ✅ **Sprint Cleanup-I8 / Lot 3 + Lot 1 follow-up** (livré YYYY-MM-DD) : Item 1 — tests pure-unit `lib/__tests__/logger.test.ts` (N cas, 0 → N passed non-gated, regression-guard level filtering + LOG_LEVEL env). Item 2 — `middleware.ts` (3 sites) + `lib/expense-allocation.ts` (X sites) migrés vers `logger.*` ; per-file ESLint override `no-console: 'error'` sur les 3 fichiers (incl. `lib/logger.ts`). Lint baseline : 991 → ~991-N warnings. Lots 2/4-6 (lib/finance, routes API critiques, composants, sweep final) restent à venir.
```

---

## Hors scope (rappel)

- `lib/financial-calculations.ts` (chantier I4 séparé, couple Lot 2).
- `app/api/monthly-recap/process-step1/route.ts` (chantier I5 séparé).
- Migration des autres routes `app/api/**` (Lot 4, par opportunité).
- Composants UI (Lot 5, par opportunité).
- Sweep final + activation globale `no-console: 'error'` (Lot 6).
- Branchement Sentry (chantier N3 séparé).
- Alignement `lib/financial-logger.ts` (couplé I4).
