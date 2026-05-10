# Sprint Cleanup-I8 / Lot 4b — Migration `app/api/monthly-recap/**` (routes simples)

## Contexte

Lot 1 (filet logger + strip prod), Lot 3 (middleware + expense-allocation, 7 sites), et **Lot 4a** (`app/api/groups/**`, 22 sites → 11 supprimés + 11 migrés via triage Modéré) sont livrés. La **règle d'or de triage** est désormais le standard du repo, documentée dans CLAUDE.md §6 Logs et matérialisée dans Lot 4a (commits `877504b` static / `8de275e` dynamic / `84e4e84` eslint glob / `f6dd1b8` closeout).

**Lot 4b** = deuxième salve API. Scope : `app/api/monthly-recap/**` **routes simples uniquement** — 9 fichiers, **~203 sites**. Toutes les routes sont déjà wrappées en `withAuth(AndProfile)` depuis Sprint Refactor-Architecture v4, donc le travail se concentre sur les `console.*` dans les bodies des handlers (pas du boilerplate auth à toucher).

État actuel par fichier (compté via `grep -c "console\." <file>`, 2026-05-10) :

| Route | Sites | Type dominant attendu |
|-------|-------|-----------------------|
| `status/route.ts` | 4 | flow log (3 `console.log`) + 1 `console.error` |
| `accumulate-piggy-bank/route.ts` | 9 | mix |
| `transfer/route.ts` | 9 | mix |
| `update-step/route.ts` | 9 | mix |
| `resume/route.ts` | 12 | mix |
| `refresh/route.ts` | 22 | flow logs `🔄`/`🔍` (Refresh Debug) + DB error logs |
| `initialize/route.ts` | 23 | mix |
| `step1-data/route.ts` | **58** | dump-debug `🎯🎯🎯`, `🔍 [DEBUG STEP1]`, séparateurs visuels `========` — quasi-tout DROP |
| `step2-data/route.ts` | **57** | même pattern dump-debug que step1-data |
| **Total** | **203** | |

**Différence majeure vs Lot 4a** : Lot 4a était 100% `console.error` allow-listés dans des paths d'erreur (lint baseline stable) ; Lot 4b est **majoritairement `console.log` de debug** (flow logs avec emojis 📅🔄🔍🎯, séparateurs visuels, dump de payloads). Le strip prod SWC les supprime déjà côté production, mais ils polluent le dev (et l'ESLint baseline) — c'est exactement la cible "ménage" de la règle d'or de triage.

Ce qui n'est **PAS** dans ce sprint :

- Routes monthly-recap **stateful** (`complete` 65 sites, `recover`, `balance` 62, `auto-balance`) — couplé I5 (extraction logique métier).
- `process-step1/route.ts` (116 sites) — chantier I5 dédié.
- `status-test/route.ts` — debug route, hors scope (devrait être bloquée par `blockInProduction()` ou supprimée).
- Routes `/api/groups/**` — fini Lot 4a.
- Routes `/api/finance/**` — déjà majoritairement nettoyées implicitement par v3 (à auditer si Lot 4e si reste).
- Routes `/api/profile/**`, `/api/savings/**`, `/api/bank-balance/**` — Lots 4c/4d.
- God files I4/I5, composants UI (Lot 5), sweep final (Lot 6).

## Approach

Pattern miroir Lot 4a — **triage Modéré** (CLAUDE.md §6 Logs / "Règle d'or de triage"). Pour chaque site :

🗑️ **DROP** (défaut majoritaire) :
- `console.log` de flow avec emoji décoratif (`📅`, `🔄`, `🔍`, `🎯`, `🚀`, `📊`) — visible dans Vercel access logs.
- `console.log` de séparateurs visuels (`========`, `---`, lignes vides `console.log('')`) — pollution pure.
- `console.log` de dump de payload (`console.log('body:', body)`, `console.log('Result:', JSON.stringify(...))`) — risque PII en prod.
- `console.log('--- step 2 ---')` ou `console.log('TIMESTAMP: ...')` — flow log de debug ad-hoc.
- `console.error('Error in METHOD /api/...:', error)` catch-all dans `try/catch` qui converti en `NextResponse.json({error}, {status: 500})` — Next.js capture déjà la stack trace côté Vercel.

✏️ **KEEP+migrate** vers `logger.error` (minorité justifiée) :
- `console.error` qui discrimine une **branche métier** non-évidente (`'Erreur lors de la récupération des budgets:'` vs `'Erreur lors de la récupération des dépenses:'`) — le code/details Supabase n'apparaît qu'ici.
- `console.error` dans un path **silencieusement avalé** (catch retourne 200 ou un fallback) — sans le log, le serveur perd l'info qu'une op DB a fail.
- `console.log` qui matérialise une **invariant violation** (e.g. `'⚠️ piggy_bank négatif détecté pour ${userId}'`) — devient `logger.warn` ou `logger.error` selon gravité.

🔄 **Cas spécial — `step1-data` / `step2-data`** : ces 2 fichiers totalisent 115 sites, quasiment tous des dump-debug avec séparateurs visuels (`🎯🎯🎯 ========`). **Attendu** : ratio ~95% DROP, ~5% KEEP+migrate. Si tu hésites, défaut = SUPPRIMER. Le remplacement légitime pour ce style de debug verbose serait soit un test (cf. CLAUDE.md §9), soit un logger structuré (`financial-logger` pattern, mais hors scope) — pas du `console.log`.

**Ratio global attendu sur les 203 sites** : **~85% DROP, ~15% KEEP+migrate** (~30 sites migrés sur ~170 supprimés). À matérialiser dans le closeout. Beaucoup plus agressif que Lot 4a parce que la nature des sites est différente (debug verbeux ≠ error path).

### Phase 1 — Audit + classification (30 min)

Plus long que Lot 4a parce que le volume est ~10× supérieur. Je suggère :

```bash
# Inventaire fichier-par-fichier
for f in app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/route.ts; do
  echo "=== $f ==="
  grep -nE "console\.(log|error|warn|info|debug)" "$f"
done
```

Pour chaque site, classer en SUPPRIMER / KEEP+migrate par défaut. **Pour les 2 heavy files (step1-data, step2-data), il est probablement plus rapide de commencer par identifier les 2-3 sites à GARDER puis SUPPRIMER tout le reste en bloc** (vs essayer de classifier 58 sites un par un). Pattern type : un `console.log('🎯 RAV finale: ${rav}')` peut mériter d'être migré en `logger.debug` si le RAV est une invariant métier critique ; tout le reste (séparateurs `🎯🎯🎯 ===`, headers de section, dump de payload) → DROP.

### Découpage suggéré — 3 commits par taille

#### Commit 1 — Routes courtes (5 fichiers, 43 sites en input)

`refactor(api/monthly-recap): triage console.* — short routes`

Fichiers : `status` (4), `accumulate-piggy-bank` (9), `transfer` (9), `update-step` (9), `resume` (12).

Pour chaque fichier :
- Si **DROP** seul : `git rm` de la ligne, pas d'import logger ajouté.
- Si **KEEP+migrate** : ajouter `import { logger } from '@/lib/logger'` au top + remplacer `console.X(...)` par `logger.X(...)`.
- Pour les `} catch (error) {` dont l'erreur n'est plus utilisée après DROP : passer à `} catch {` (CLAUDE.md §6).

**Ratio attendu commit 1** : ~30 supprimés, ~13 migrés (mix de DB-error et 1-2 invariants). Smoke test mental : `status/route.ts` a 3 `console.log` flow + 1 `console.error` catch-all → 4 DROP, 0 KEEP. C'est un bon début.

#### Commit 2 — Routes moyennes (2 fichiers, 45 sites en input)

`refactor(api/monthly-recap): triage console.* — medium routes`

Fichiers : `refresh` (22), `initialize` (23).

Plus de DB-error discriminantes que dans les courtes (CRUD batches). Ratio attendu : ~30 supprimés, ~15 migrés. Surveiller les `console.error('❌ Erreur lors de la récupération des X:', err)` qui sont des Type A légitimes (CLAUDE.md §6 / Lot 4a → KEEP+migrate).

#### Commit 3 — Heavy debug routes (2 fichiers, 115 sites en input)

`refactor(api/monthly-recap): triage console.* — heavy debug routes (step1/2-data)`

Fichiers : `step1-data` (58), `step2-data` (57).

**Triage agressif** — le volume + la nature dump-debug avec séparateurs `🎯🎯🎯 ====` justifient un ratio ~95% DROP. Lire les fichiers une fois, identifier les 2-5 sites par fichier qui méritent peut-être d'être migrés (e.g. `console.error` DB qui discrimine une branche), DROP tout le reste en bloc. Si la lecture donne l'impression que beaucoup de logs sont "utiles pour debug", appliquer la règle d'or : **YAGNI — on ré-instrumente quand le bug arrive, on n'instrumente pas pour des bugs hypothétiques** (CLAUDE.md §6).

**Bonus** : à la fin de ce commit, vérifier si `step1-data` / `step2-data` ont des sections de logique métier (calculs RAV, allocation) qui mériteraient une extraction comme `lib/recap/check-status.ts` (Sprint Refactor-Architecture). Si oui, le noter pour un sprint séparé (pas dans ce commit). **Ne pas refactorer en cours de route** — Lot 4b reste un sprint console-cleanup, pas un refactor I5.

#### Commit 4 — ESLint glob override

`chore(eslint): extend no-console: error override to app/api/monthly-recap/**`

Étendre [eslint.config.mjs](../eslint.config.mjs) — bloc per-file override (lignes 39-44) :

```js
{
  files: [
    'middleware.ts',
    'lib/expense-allocation.ts',
    'lib/logger.ts',
    'app/api/groups/**',
    'app/api/monthly-recap/**', // ← AJOUT Lot 4b
  ],
  rules: { 'no-console': 'error' },
},
```

**⚠️ Caveat important** : le glob `app/api/monthly-recap/**` couvrirait AUSSI les 4 routes stateful + `process-step1` + `status-test` qui sont **hors scope** Lot 4b et contiennent encore des `console.*`. **Solution recommandée** : utiliser un glob plus précis listant les 9 routes ciblées :

```js
'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**'
```

OU lister les 9 fichiers explicitement OU exclure les 5 hors scope via une seconde entrée :

```js
{
  files: ['app/api/monthly-recap/**'],
  ignores: [
    'app/api/monthly-recap/complete/**',
    'app/api/monthly-recap/balance/**',
    'app/api/monthly-recap/recover/**',
    'app/api/monthly-recap/auto-balance/**',
    'app/api/monthly-recap/process-step1/**',
    'app/api/monthly-recap/status-test/**',
  ],
  rules: { 'no-console': 'error' },
},
```

À arbitrer en cours de sprint selon ce qui est plus lisible. **Recommandation** : la liste exhaustive `{...,...,...}` glob brace est probablement la plus simple à reviewer.

#### Commit 5 — Closeout

`docs(claude): closeout Sprint Cleanup-I8 / Lot 4b`

CLAUDE.md updates :
- **§6 Logs** : mettre à jour le compteur `~985 console.log + ~311 console.error` → `~<X> console.log + ~<Y> console.error` (avec X, Y le delta réel post-Lot 4b — selon le ratio attendu, X devrait baisser de ~140-160, Y de ~10-20).
- **§6 Logs** : mettre à jour la liste des fichiers protégés par per-file override (3 explicites + 2 globs `app/api/groups/**` + `app/api/monthly-recap/{...}`).
- **§6 Logs** : conserver la règle d'or de triage (déjà installée Lot 4a), pas de modification — Lot 4b la matérialise une 2e fois.
- **§11 Roadmap** : ajouter entry `✅ Sprint Cleanup-I8 / Lot 4b` sur le modèle des entries Lot 4a. Mentionner :
  - Audit (203 sites — 10× plus volumineux que Lot 4a)
  - Triage agressif arbitré (ratio ~85% DROP attendu, à confirmer real)
  - Découpage 3 commits par taille (short / medium / heavy debug)
  - Glob brace expansion pour ESLint override (au lieu d'un `app/api/monthly-recap/**` global qui couvrirait les hors-scope)
  - Verif `pnpm verify` exit 0
  - Score stable ~98.2/100 (cleanup, pas de saut métier)
- **§11 Roadmap** : mettre à jour l'item ⏭️ "Chantier console.log cleanup — Lots 2 / 4-6" avec le nouveau compteur et noter qu'il reste : Lot 4c (profile + savings/data + bank-balance), Lot 4d (savings/transfer), Lot 4e (finance résiduelles), Lot 5 (UI), Lot 6 (sweep final).

## Critères de succès

- `Grep "console\." app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/` → **0 hit**.
- `Grep "from '@/lib/logger'" app/api/monthly-recap/{...}` → **entre 2 et 9 hits** (1 par fichier ayant au moins 1 site KEEP). **Si tu obtiens 9 (1 par fichier), questionne-toi si la phase de triage a été assez agressive** — sur 203 sites majoritairement debug, il devrait rester ~30 KEEP, donc certains fichiers (notamment status, step1-data, step2-data) devraient sortir avec 0 ou 1 KEEP seulement.
- `pnpm typecheck` exit 0.
- `pnpm lint:check` exit 0. **Lint baseline doit baisser de ~140-160** (les `console.log` de debug n'étaient pas allow-listés). Mesurer pré/post via `pnpm lint:check 2>&1 | tail -1` pour avoir le `✖ N problems`.
- `pnpm test:run` 30 passed / 34 skipped inchangé (les tests gated avec env vars couvrent les routes stateful, pas les simples). Si jamais un test gated couvre une des routes Lot 4b, vérifier qu'il reste vert.
- `pnpm format:check` exit 0 (fichiers reformatés par lint-staged au commit).
- `pnpm build` 56/56 routes exit 0.
- `pnpm verify` exit 0 (chaîne complète typecheck + tests + 6 db:* checks).
- **Ratio supprimé/migré documenté dans le closeout** : "X supprimés, Y migrés sur 203 sites — Z% de bruit éliminé" pour matérialiser la philosophie "ménage avant migration".

**Smoke browser** (deferred to user) : exercer le flow récap mensuel — accès `/monthly-recap` qui appelle `status` → `step1-data` → `step2-data` → `update-step` → `transfer` / `accumulate-piggy-bank` selon les actions utilisateur. Vérifier que le dashboard `/dashboard` ou `/group-dashboard` charge sans erreur après un récap (touche `refresh`, `resume`).

## Découpage en commits (récapitulatif)

1. `refactor(api/monthly-recap): triage console.* — short routes` — 5 fichiers, 43 sites
2. `refactor(api/monthly-recap): triage console.* — medium routes` — 2 fichiers, 45 sites
3. `refactor(api/monthly-recap): triage console.* — heavy debug routes (step1/2-data)` — 2 fichiers, 115 sites
4. `chore(eslint): extend no-console: error override to app/api/monthly-recap/{...}` — glob brace expansion (recommandé) ou liste explicite
5. `docs(claude): closeout Sprint Cleanup-I8 / Lot 4b` — compteurs §6 + entry §11

## Hors scope (rappel)

- `app/api/monthly-recap/complete/**`, `balance/**`, `recover/**`, `auto-balance/**` — routes stateful, couplé I5.
- `app/api/monthly-recap/process-step1/**` — god route, chantier I5 dédié.
- `app/api/monthly-recap/status-test/**` — debug route, blockInProduction-able.
- Lot 4c : `profile` + `savings/data` + `bank-balance`.
- Lot 4d : `savings/transfer` (~45 sites — son propre commit).
- Lot 4e : routes finance résiduelles (à auditer via `Grep "console\." app/api/finance/`).
- Lot 5 : composants UI.
- Lot 6 : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs`.
- Branchement Sentry (chantier N3).
- Alignement `lib/financial-logger.ts` (couplé I4).

## Référence

- Lot 1 (filet) : commits `bcb950f` + `7419657` + `4b1d8ad` + closeout `4ebf4ed`.
- Lot 3 (middleware + expense-allocation) : commits `44906b7` + `34cbd33` + `67f48fd` + `2ab696d` + closeout `1a46083`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-sleepy-pebble.md`.
- **Lot 4a** (`app/api/groups/**`, 22 sites → 11/11) : commits `877504b` static / `8de275e` dynamic / `84e4e84` eslint glob / `f6dd1b8` closeout. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-glistening-beaver.md`. Source de la règle d'or de triage (CLAUDE.md §6 Logs).
- Convention §6 Logs (règle d'or de triage) + §8 À-faire / À-ne-pas-faire dans CLAUDE.md.
- Pattern test logger : [lib/__tests__/logger.test.ts](../lib/__tests__/logger.test.ts) (11 cas pure-unit non-gated, regression-guard si jamais on touche `lib/logger.ts`).
