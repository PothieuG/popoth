# Sprint Cleanup-I8 / Lot 5b — auth/session + recover + status-test triage (post Lot 5)

## Contexte

Lot 5 livré le 2026-05-10 a migré la couche client complète (30 fichiers, 193 sites → 133/60 triage strict, lint 618 → 490, 5 cleanup-attempts CRITIQUES + 1 boot-path PWA préservés).

Lot 5b est une **petite salve consécutive** qui ramasse 3 fichiers serveur orphelins dans le périmètre Lot 5 mais hors-scope explicit (server-side) :

| Fichier                                        | Sites | Note                                                      |
| :--------------------------------------------- | ----: | :-------------------------------------------------------- |
| `app/api/auth/session/route.ts`                |     3 | Hors-scope Lot 5 (server-side, périmètre client uniquement) |
| `app/api/monthly-recap/recover/route.ts`       |     9 | Hors-scope Lot 4b (route stateful, exclue de la brace expansion) |
| `app/api/monthly-recap/status-test/route.ts`   |     4 | Route test/mock — **candidat à la SUPPRESSION pas migration** |

**Total : 16 sites distincts** (estimation grep, à confirmer Phase 1).

## Pourquoi c'est la bonne salve maintenant

- **Pas de dépendance I4/I5** : `recover` n'est pas un god file (~410 LOC dont la logique est claire) ; `auth/session` est un endpoint atomique (3 actions discrètes : login/refresh/logout) ; `status-test` est mock-only (zéro logique métier réelle).
- **Petit volume** : 16 sites au max → 1 commit unique faisable, ou 2-3 commits courts. Lot rapide.
- **Lint baseline progress** : 490 → ~470-475 attendu (−15-20 warnings).
- **Reste cohérent avec Lot 6** : on continue de réserver Lot 6 pour le sweep final + activation globale `no-console: 'error'` après que I5 ait extrait `process-step1` + `complete` + `balance` + `auto-balance` (les 4 god-routes restantes ~334 sites).

## Décisions arbitrables Phase 1 (à valider AVANT commits)

### Q1 — Stratégie pour `app/api/monthly-recap/status-test/route.ts` (4 sites)

Le route retourne des **données mockées** (`hasExistingRecap = false`, `isFirstOfMonth = true`, `test_mode: true`). C'est un dev/test bypass qui ne devrait probablement pas exister en prod.

3 options :

- **A — DELETE entièrement le fichier** (recommended) : 4 sites + ~64 LOC supprimés d'un coup. Aucun consumer applicatif (à confirmer Phase 1 par grep). Si le route n'a jamais été utilisé en prod, c'est du dead code.
- **B — Migration drop-in** : 4 DROP, drop-in mécanique cohérent avec Lot 4b/5. Préserve le route au cas où.
- **C — Bloquer en prod via `blockInProduction()`** : pattern Sprint 0 / C2 (debug routes), mais `status-test` n'est PAS dans `app/api/debug/**`. Inconsistant.

**Recommandation A** sauf si Phase 1 grep révèle un consumer dev-only.

### Q2 — Profondeur triage `recover/route.ts` (9 sites)

L88-89, L100 : flow logs (🔄 début / snapshot info) — **DROP** (verbose dev).
L288 : `console.warn('⚠️ Erreur lors de la désactivation du snapshot:', deactivateSnapshotError)` — **KEEP+migrate logger.warn** (silently-swallowed branch après la recovery, sémantique non-critique).
L291-292 : ✅ success traces — **DROP** (UI feedback couvre).
L306 : `console.error('❌ Erreur lors de la récupération:', recoveryError)` — **KEEP+migrate logger.error CRITICAL** (recovery rollback path : si la fonction recover elle-même échoue après avoir touché des tables, le state de la DB est partiellement restauré).
L316 : outer catch-all → **DROP** (rule a, Vercel capture stack).
L404 : `console.error('❌ Erreur lors de la récupération des snapshots:', error)` — **KEEP+migrate logger.error** (catch dans GET /recover/snapshots, silently propagated to 500 — keep pour grep le bug futur).

**Ratio attendu** : 5 DROP / 4 KEEP (~56%/44%) — Modéré. Plus KEEP-heavy que Lot 5 parce que recover est intrinsèquement un path de rollback.

### Q3 — Profondeur triage `auth/session/route.ts` (3 sites)

L56 : `console.error('Session creation error:', sessionError)` dans le nested try/catch après `signInWithPassword` succès puis `createSession` fail — **KEEP+migrate logger.error CRITICAL** (le user a été authentifié Supabase-side mais le serveur n'a pas créé la session JWT custom — état inconsistant, le client va voir une erreur sans savoir que Supabase considère qu'il est connecté).
L97 : outer catch-all sur POST — **DROP** (rule a).
L129 : outer catch-all sur GET — **DROP** (rule a).

**Ratio** : 1 KEEP / 2 DROP (33%/67%) — Modéré. Le cleanup-attempt L56 est CRITICAL.

## Decoupage proposé

### Option α — 1 commit unique (recommended si scope reste petit)

Tous les 3 fichiers en un seul commit + 1 commit ESLint glob extension + 1 commit closeout.

### Option β — 2 commits par nature

- Commit 1 : auth/session + recover (les 2 fichiers métier, 12 sites)
- Commit 2 : status-test DELETE (si Q1=A) ou migration trivial (si Q1=B)
- Commit 3 : ESLint glob
- Commit 4 : closeout

## Wirage ESLint

Stratégie : **étendre le bloc per-file `no-console: 'error'`** ([eslint.config.mjs](eslint.config.mjs)) avec :

- `app/api/auth/**` (couvre `session/route.ts` + `confirm/route.ts` qui n'a pas de console mais protège futur)
- Si Q1=A (status-test deleted) : `app/api/monthly-recap/{...9 routes}/**` reste tel quel
- Si Q1=B/C (status-test migré) : étendre la brace expansion à inclure `status-test`
- `app/api/monthly-recap/recover/**` ajouté

**Sanity test** : injection temporaire `console.log('SANITY-LOT5B')` → exit 1 expected, revert vérifié exit 0.

## Critères de succès

### Greps invariants (post commits 1-2)

```
Grep -P "console\.(log|error|warn|info|debug)" app/api/auth/ app/api/monthly-recap/recover/ app/api/monthly-recap/status-test/
# 0 hit (ou file deleted si Q1=A)
Grep -l "from '@/lib/logger'" app/api/auth/ app/api/monthly-recap/recover/
# ≥2 fichiers (1 par fichier ayant ≥1 KEEP)
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 490 → ~470-475 estimé** (−15-20 warnings).
- `pnpm test:run` 30 passed / 34 skipped inchangé
- `pnpm format:check` exit 0 sur les fichiers touchés (les 2 issues pré-existantes `doc2/audit/AUDIT-RESOLUTIONS.md` + `next.config.js` restent hors scope)
- `pnpm build` 56/56 routes (ou 55/55 si status-test deleted)
- `pnpm verify` exit 0

### Smoke browser deferred to user

- Login/logout flow exerce `/api/auth/session` POST
- `/dashboard` GET exerce `/api/auth/session` GET (refresh check via middleware)
- Le path recovery n'est pas exercé manuellement (declenche seulement quand un récap mensuel a une erreur en cours, rare)
- Si `status-test` deleted : aucun smoke browser nécessaire (route mock-only)

## Phase 1 — Audit (à exécuter)

1 Explore agent suffit (scope < 20 sites, 3 fichiers tous lus en moins de 200 lignes total) :

```
Audit `console.*` sites in 3 server-side files for Sprint Cleanup-I8 / Lot 5b. Files:
- app/api/auth/session/route.ts (~3 sites)
- app/api/monthly-recap/recover/route.ts (~9 sites)
- app/api/monthly-recap/status-test/route.ts (~4 sites — also evaluate if file is DEAD CODE)

For each file, produce:
1. Total distinct statements vs grep -c lignes.
2. Numbered list of every site with line, statement, and verdict per règle d'or de triage (DROP / KEEP+migrate to logger.{error,warn,debug}).
3. CRITICAL non-négociable cleanup-attempts identified.
4. For status-test specifically: confirm 0 consumer (grep `/api/monthly-recap/status-test` across app/, components/, hooks/, contexts/, lib/) and recommend DELETE vs migrate.
5. Catch blocks needing `} catch {}` after DROP per CLAUDE.md §6 TS 4.4+ convention.
6. Per-file totals + grand total.

Target ≤1500 words.
```

## Référence Lots précédents

- **Lot 4a** (Modéré 50/50) : `app/api/groups/**`, 22 sites
- **Lot 4b** (Aggressif 86/14) : `app/api/monthly-recap/{...9 routes simples}`, 132 sites
- **Lot 4c** (Strict 83/17) : `app/api/{profile,savings/data,bank-balance}`, 52 sites
- **Lot 4d** (Strict single-file 84/16, 3 cleanup-attempts) : `app/api/savings/transfer`, 38 sites
- **Lot 4e** (Strict 78/22, 3 cleanup-attempts + 1 fallback) : `lib/api/finance/**`, 152 sites
- **Lot 5** (Strict 69/31, 5 cleanup-attempts + 1 boot-path) : couche client, 30 fichiers, 193 sites
- **Lot 5b estimé** (Modéré ~50/50, 2 cleanup-attempts CRITIQUES) : 3 fichiers serveur orphelins, 16 sites

## Sortie attendue

Plan dans `C:\Users\gille\.claude\plans\sprint-cleanup-i8-<random>.md` qui :

1. Confirme/redresse la Phase 1 audit (16 sites distincts ?)
2. Arbitre Q1 (DELETE vs migrate status-test)
3. Arbitre Q2/Q3 (verdict per-site exact)
4. Choisit Option α ou β découpage
5. Décrit le wirage ESLint (avec ou sans extension de la brace expansion)
6. Documente la verif end-to-end attendue

Puis 3-5 commits courts + closeout CLAUDE.md (§1 progression entry + §6 Logs Migration progressive update + §11 Roadmap Lot 5b entry).

---

## Bonus — axes hors-scope mais pertinents

### Axe A — Format:check cleanup (non bloquant mais bruit)

`pnpm format:check` retourne 2 issues pré-existantes :
- `doc2/audit/AUDIT-RESOLUTIONS.md` — fichier untracked, `pnpm format` le corrigerait mais pas dans le commit Lot 5b
- `next.config.js` — fichier modifié par Lot 1 (commit 7419657 ajout `compiler.removeConsole`), prettier veut le reformatter

**Décision suggérée** : sortir un commit séparé `chore(format): fix pre-existing prettier drift` qui run `pnpm format` puis commit les 2 fichiers. Sortable indépendamment de Lot 5b.

### Axe B — Helper `errorMessage(err: unknown): string` (factorisation)

Le pattern `error instanceof Error ? error.message : String(error)` se trouve dans **30+ sites** dans le repo (greppable). Une factorisation `lib/error-helpers.ts` exportant `errorMessage(err: unknown): string` réduirait la duplication.

**Décision suggérée** : axe séparé, pas couplé Lot 5b. Sprint dédié si on veut reduce le bruit. À faire **après** I4 (`lib/financial-calculations.ts` refactor) qui touchera massivement ces patterns.

### Axe C — Smoke browser test Lot 5 (deferred)

Le user devait tester manuellement les 5 cleanup-attempts CRITIQUES de Lot 5 + boot path PWA + flow login/logout. Si une régression est détectée, **fix-forward dans Lot 5b** (pas un revert).

**Décision suggérée** : commencer Lot 5b par confirmer "pas de régression Lot 5" avec le user avant de plonger dans le triage.
