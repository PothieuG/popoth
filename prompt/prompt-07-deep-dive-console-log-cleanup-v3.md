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

Pattern miroir Lot 3 (livré 2026-05-10, plan dans `C:\Users\gille\.claude\plans\sprint-cleanup-i8-sleepy-pebble.md`) **mais avec un twist** : Lot 3 était drop-in mécanique (`console.* → logger.*` verbatim). Lot 4a **change l'approche** — au lieu de migrer chaque site, **trier d'abord** : supprimer le plus possible, et ne garder que ce qui a vraiment du sens. La majorité des `console.*` du repo sont du résidu de debug — ils ne servent ni à l'observabilité prod (le strip SWC les supprime), ni au dev (TanStack Query DevTools, Network tab, et la pile d'erreur Next.js couvrent l'essentiel). Découpage suggéré : **3 commits + closeout** (mais le découpage entre static/dynamic devient secondaire ; le découpage par fichier reste utile pour le review).

### Heuristique de triage (à appliquer site par site)

Pour chaque `console.*` rencontré, classer en 3 buckets :

**🗑️ SUPPRIMER (défaut — la majorité)** :

- `console.log('✅ Truc créé:', truc)` ou `console.log('📊 Résultat:', JSON.stringify(...))` — dump de debug. Le client a déjà la réponse, le serveur a déjà fait le travail. Zéro valeur.
- `console.log('🚀 Début POST /api/groups')` ou `console.log('--- step 2 ---')` — flow log de debug. Le rate-of-fire est visible dans les access logs Vercel/Next.js.
- `console.error('Erreur:', error)` quand le `error` est ensuite rethrown ou converti en `NextResponse.json({ error: 'message' }, { status: 500 })` — Next.js logge déjà l'erreur, et le client reçoit le message.
- Tout `console.log` de payload (`console.log('body:', body)`, `console.log('user:', user)`) — exposes éventuellement des données personnelles, jamais utile en prod.

**✏️ GARDER mais migrer en `logger.*`** (minorité justifiée — quand garder ?) :

- L'erreur est **silencieusement avalée** (le catch retourne 200 ou un fallback) — sans le log, le serveur perd l'info que quelque chose s'est mal passé. Exemple : `lib/expense-allocation.ts` Lot 3, où l'erreur est rethrown mais le contexte (`'Erreur restauration tirelire'` vs `'Erreur restauration economies'`) discrimine la branche métier qui a fail.
- Le log capture un **état métier non-trivial** qui ne reapparaîtra pas dans la stack trace ni la réponse. Exemple : `'Récap requis pour group X, redirection'` dans middleware Lot 3 (downgradé à `logger.debug` parce que c'est utile en dev mais bruit en prod).
- Une erreur d'invariant (e.g. "trigger function returned unexpected shape") qui mérite un alert si jamais elle arrive — `logger.error` avec un message distinctif qui sera grep-able.

**🔄 GARDER mais ré-architecturer** (rare — éviter scope creep) :

- Si tu trouves un `console.log` dump qui est en fait critical pour le debug d'un bug actif, c'est probablement un signe qu'il faut un test ou un logger structuré (financial-logger pattern) — mais hors scope Lot 4a, à noter pour le sprint dédié.

**Règle d'or** : la question à se poser pour chaque site est "est-ce que quelqu'un (toi, dans 6 mois, devant une prod en panne) lira ce log ?". Si la réponse est non → SUPPRIMER. Si la réponse est "ça pourrait aider" mais sans cas concret → SUPPRIMER aussi (YAGNI : on ré-instrumente quand le bug arrive, on n'instrumente pas pour des bugs hypothétiques).

**Estimation** : sur 22 sites Lot 4a, attendre **~15-18 suppressions purs** + **~4-7 migrations `logger.*`**. Le ratio sera variable par fichier ; les routes CRUD simples auront probablement 0-1 log à garder, alors que les routes avec branches métier (`groups/[id]/members` POST/DELETE) auront peut-être 2-3 logs justifiés sur les paths d'erreur métier (FK violation, member not found, etc.).

### Phase 1 — Audit + classification (15 min)

`grep -n "console\." app/api/groups/` pour confirmer le total et le shape des sites. **Pour chaque site, appliquer l'heuristique ci-dessus** et noter SUPPRIMER / GARDER+migrer dans un scratchpad mental ou un commit message draft. **Si tu hésites pour un site, défaut = SUPPRIMER** (on peut toujours rajouter un log ciblé si un bug surface plus tard ; on ne peut pas "désencombrer" une fois la dette installée).

### Commit 1 — Cleanup `app/api/groups/route.ts` + `app/api/groups/search/route.ts` + `app/api/groups/contributions/route.ts`

Les 3 routes statiques. 12 sites au total. Pour chacun :

- Si **SUPPRIMER** : juste `git rm` la ligne (ou la séquence `console.log + commentaires associés s'il y en a`). Pas d'import `logger` à ajouter si toutes les lignes sont suppressed dans le fichier.
- Si **GARDER+migrer** : ajouter `import { logger } from '@/lib/logger'` au top + remplacer `console.X(...)` par `logger.X(...)`. Message verbatim si la chaîne identifie déjà la branche métier ; sinon enrichir le message pour qu'il soit grep-able.

### Commit 2 — Cleanup `app/api/groups/[id]/route.ts` + `app/api/groups/[id]/members/route.ts`

Les 2 routes dynamiques. 10 sites au total. Même pattern. Vérifier que les patterns de `withAuth<RouteParams>` (Sprint v5 overload) ne sont pas accidentellement cassés. Les routes dynamiques avec branches métier (member not found, group not found, FK violation) sont les plus susceptibles d'avoir des logs justifiés à garder.

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

Ajouter entry §11 dans CLAUDE.md sur le modèle des entries Lot 1 et Lot 3. Mettre à jour le compteur §6 Logs : si tu as suppressed N sites et migré M sites, le compteur baisse de N (pour les `console.log`) ; les `console.error` allow-listés ne comptaient pas en warning de toute façon. Annoncer le ratio supprimé/gardé dans le closeout (e.g. "18 supprimés, 4 migrés sur 22 sites — 82% de bruit éliminé"). Mettre à jour le compteur de fichiers protégés par l'override (3 → 8, ou 3 → 4 si glob). **Bonus** : mettre à jour CLAUDE.md §6 Logs pour ajouter explicitement l'heuristique de triage (SUPPRIMER par défaut, GARDER+migrer seulement si le log a vraiment du sens) — ce sera la règle pour les Lots 4b-6.

## Critères de succès

- `grep "console\." app/api/groups/` → 0 hit.
- `grep "from '@/lib/logger'" app/api/groups/` → **entre 0 et 5 hits** (= 1 par fichier ayant au moins 1 site GARDÉ ; si un fichier voit tous ses logs supprimés, l'import disparaît avec). **Si ce nombre est 5 (un par fichier), c'est probablement un signe que la phase de triage a été trop conservative** — re-questionner chaque migrate pour confirmer qu'il a vraiment du sens.
- `pnpm lint:check` exit 0. **Lint baseline** doit baisser de N (où N = nombre de `console.log` supprimés/migrés + le delta de `console.error` non allow-listed s'il y en a — à mesurer pré/post).
- `pnpm typecheck` + `pnpm test:run` (30 passed / 34 skipped) + `pnpm format:check` + `pnpm build` exit 0.
- Negative regression : `SUPABASE_API_TESTS=1 pnpm test:run` toujours vert (les tests `with-auth.test.ts` couvrent groups dynamic-route, recall les overloads sont préservés).
- **Ratio supprimé/migré documenté dans le closeout** : annoncer "X supprimés, Y migrés sur Z sites" pour matérialiser la philosophie "ménage, pas refactor mécanique".

**Smoke browser** (deferred to user) : créer un groupe via `/dashboard` → join un autre user → leave → delete. Couvre les 5 routes en flow utilisateur.

## Découpage en commits

1. `refactor(api/groups): triage console.* — drop noise, migrate the rest (static routes)` — 3 fichiers, 12 sites en input.
2. `refactor(api/groups): triage console.* — drop noise, migrate the rest (dynamic routes)` — 2 fichiers, 10 sites en input.
3. `chore(eslint): extend no-console: error override to app/api/groups/**` — glob pattern recommandé.
4. `docs(claude): closeout Sprint Cleanup-I8 / Lot 4a` — inclure le ratio supprimé/migré + mise à jour de l'heuristique CLAUDE.md §6.

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
