# Sprint Cleanup-I8 / Lot 5c — Petites libs server-side indépendantes I4/I5

## Contexte

Lot 5b livré 2026-05-10 (3 fichiers serveur orphelins : auth/session + recover triage strict + status-test DELETE, 16 sites → 8 DROP / 4 KEEP / 4 file-deleted, lint baseline 490 → 482, 2 cleanup-attempts CRITIQUES préservés).

**Lot 5c** est la salve consécutive logique qui ramasse les **petites libs server-side foundationnelles** qui n'ont pas été couvertes par les Lots 1-5b. Toutes sont **indépendantes des chantiers I4 (god file financial-calculations) et I5 (extraction process-step1/complete/balance/auto-balance)** — donc migrables tout de suite sans bloquer.

## Scope (estimation à confirmer Phase 1)

| Fichier                                | Sites | Domaine | Note |
|:---------------------------------------|------:|:--------|:-----|
| `lib/monthly-recap-calculations.ts`    | 20    | helper extracted lib | À vérifier : couplé I5 ou indépendant ? |
| `lib/auth.ts`                          | 9     | helpers auth | Foundational, pas de dependency I4/I5 |
| `lib/database-snapshot.ts`             | 8     | snapshot helper | `createFullDatabaseSnapshot`, indépendant |
| `app/auth/confirm/route.ts`            | 6     | route auth | **NOTE**: `app/auth/confirm/`, PAS `app/api/auth/confirm/` |
| `lib/session-server.ts`                | 5     | helpers auth | `validateSessionToken`, foundational |
| `lib/supabase-client.ts`               | 3     | browser client | 2 warn + 1 error (MISSING_VAR au boot) |
| `lib/api/with-auth.ts`                 | 2     | wrapper canonique | À évaluer KEEP ou DROP — si KEEP, signal d'audit |
| `lib/session.ts`                       | 1     | JWT helper | Singleton, à voir |

**Total estimé : 54 sites dans 8 fichiers** (vs grep -c qui peut surcompter sur multi-line — pattern miroir Lots 4b/4d/4e/5b).

## Pourquoi c'est la bonne salve maintenant

1. **Indépendance I4/I5 totale** : aucun de ces fichiers n'est un god file ni dépend d'eux. Migrables sans attendre l'extraction process-step1 / financial-calculations.
2. **Petit volume** : 54 sites max, faisable en 1-2 commits + ESLint glob + closeout.
3. **Foundational** : `lib/session-server.ts` + `lib/supabase-client.ts` + `lib/auth.ts` sont importés par presque toutes les routes. Migrer leur `console.*` aligne le pattern logger.
4. **Lint baseline progress** : 482 → ~470-475 attendu (−7-12 warnings).

## Decisions à arbitrer Phase 1 (à valider AVANT commits)

### Q1 — `lib/monthly-recap-calculations.ts` (20 sites)

Le fichier le plus gros du scope. **À vérifier** : est-il couplé au refactor I5 (qui extrait process-step1/complete/balance/auto-balance) ou est-il indépendant ?

- **A — Inclure dans Lot 5c** si lu/écrit indépendamment des 4 routes monthly-recap stateful
- **B — Reporter à Lot 6** si transitivement utilisé par process-step1 et al. → couplé I5

Phase 1 audit doit :
1. `Grep "from '@/lib/monthly-recap-calculations'"` cross-codebase pour identifier les consumers
2. Si consumers = uniquement les 4 routes stateful → option B
3. Si consumers > 4 routes ou inclut des routes non-stateful → option A

### Q2 — `lib/api/with-auth.ts` (2 sites)

Le wrapper canonique installé Sprint Refactor-Architecture-v3+v4+v5. **2 sites `console.*`** = soit du flow log debug, soit une signal trace volontairement préservée pour audit.

- **A — DROP** si flow log verbose (cohérent strict triage)
- **B — KEEP+migrate logger.error** si trace nécessaire (e.g. expired payload détecté, etc.)

Phase 1 doit lire les 2 sites et arbitrer per règle d'or §6.

### Q3 — `lib/supabase-client.ts` (3 sites)

Probablement 2 sites de validation env vars au module load (e.g. "MISSING NEXT_PUBLIC_SUPABASE_URL") + 1 site error.

- **A — KEEP+migrate logger.warn/error** : ces logs fire au boot si les env vars manquent — load-bearing
- **B — DROP** si redondant avec un throw/exit plus loin

Phase 1 doit confirmer si ces sites sont des early-warning boot helpers ou pure debug.

### Q4 — Découpage commits

- **Option α — 1 gros commit triage** (8 fichiers, 54 sites) + 1 commit ESLint + 1 closeout = **3 commits**
- **Option β — 2 commits par domaine** (commit 1 : auth helpers `auth.ts`+`session.ts`+`session-server.ts`+`supabase-client.ts`+`auth/confirm` = 24 sites ; commit 2 : helpers misc `monthly-recap-calculations.ts`+`database-snapshot.ts`+`with-auth.ts` = 30 sites) + 1 ESLint + 1 closeout = **4 commits**

**Recommandation** : Option α si Q1 = B (monthly-recap-calculations exclu, réduit le scope) ; sinon Option β.

## Wirage ESLint

Stratégie : **étendre le bloc per-file `no-console: 'error'`** ([eslint.config.mjs](eslint.config.mjs)) avec :

- `lib/auth.ts` (foundational helper)
- `lib/session.ts` + `lib/session-server.ts` (JWT helpers — pourrait être globbed `lib/session*.ts` mais pattern à éviter, préférer paths explicites)
- `lib/supabase-client.ts`
- `lib/database-snapshot.ts`
- `lib/api/with-auth.ts`
- `app/auth/**` (couvre `confirm/route.ts` + `auth-code-error/page.tsx` qui n'a pas de console — future-proof)
- Si Q1=A : `lib/monthly-recap-calculations.ts`

**Sanity test** : injection temporaire `console.log('SANITY-LOT5C')` dans 1-2 fichiers → `pnpm lint:check` exit 1, revert vérifié exit 0.

## Critères de succès

### Greps invariants (post commits)

```
Grep -P "console\.(log|error|warn|info|debug)" lib/auth.ts lib/session.ts lib/session-server.ts lib/supabase-client.ts lib/database-snapshot.ts lib/api/with-auth.ts app/auth/
# 0 hit (ou correspond aux KEEP attendus)

Grep -l "from '@/lib/logger'" lib/auth.ts lib/session.ts lib/session-server.ts lib/supabase-client.ts lib/database-snapshot.ts lib/api/with-auth.ts app/auth/confirm/route.ts
# X fichiers (1 par fichier ayant ≥1 KEEP)
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 482 → ~470-475 estimé** (−7-12 warnings)
- `pnpm test:run` 30 passed / 34 skipped inchangé
- `pnpm format:check` exit 0 sur les fichiers touchés
- `pnpm build` 55/55 routes
- `pnpm verify` exit 0

### Smoke browser deferred to user

- Login/logout exerce `lib/session.ts`+`lib/session-server.ts` (création/validation JWT) + `lib/supabase-client.ts` (browser client)
- N'importe quelle page authentifiée exerce `lib/auth.ts` + middleware
- `/auth/confirm?token_hash=...` (callback Supabase OAuth/email confirm) exerce `app/auth/confirm/route.ts`
- Snapshot recovery flow exerce `lib/database-snapshot.ts` (rare, manuel via /monthly-recap)

## Phase 1 — Audit (à exécuter)

1 Explore agent suffit (scope < 60 sites, 8 fichiers tous lus en moins de 800 lignes total) :

```
Audit `console.*` sites in 8 server-side files for Sprint Cleanup-I8 / Lot 5c. Files (working dir: c:\DataGillesPothieu\Personal\Popoth_App_Claude):

- lib/monthly-recap-calculations.ts (~20 sites — also evaluate if file is COUPLED I5 or INDEPENDENT)
- lib/auth.ts (~9 sites)
- lib/database-snapshot.ts (~8 sites)
- app/auth/confirm/route.ts (~6 sites)
- lib/session-server.ts (~5 sites)
- lib/supabase-client.ts (~3 sites — likely env-var validation at module load)
- lib/api/with-auth.ts (~2 sites — wrapper canonique, evaluate KEEP or DROP)
- lib/session.ts (~1 site)

Context: 6th salve of console.log cleanup chantier. Règle d'or de triage (CLAUDE.md §6 Logs):
- (a) outer catch-all returning 500 → DROP (Vercel captures stack)
- (b) DB error discriminating non-obvious branch → KEEP+migrate logger.error
- (c) silently swallowed (catch returns 200/fallback) → KEEP+migrate
- (d) cleanup-attempt CRITICAL → KEEP+migrate non-negotiable

For each file, produce:
1. Total distinct statements vs grep -c lignes (multi-line console.log inflates counts).
2. Numbered list of every site with line, statement (truncated), classification per règle d'or, verdict (DROP / KEEP+migrate to logger.{error,warn,info,debug}).
3. CRITICAL non-négociable cleanup-attempts identified.
4. **For lib/monthly-recap-calculations.ts specifically**: grep `from '@/lib/monthly-recap-calculations'` across the codebase (app/, components/, hooks/, lib/) and list ALL consumers. Recommend INCLUDE in Lot 5c (independent of I5) vs DEFER to Lot 6 (couplé I5).
5. **For lib/api/with-auth.ts specifically**: read the 2 sites and arbitrate KEEP+migrate vs DROP per règle d'or.
6. **For lib/supabase-client.ts specifically**: confirm if the 3 sites are env-var validation at module load (load-bearing → KEEP+migrate) or pure debug (DROP).
7. Catch blocks needing `} catch {}` after DROP per CLAUDE.md §6 TS 4.4+ convention.
8. Per-file totals + grand total.

Target ≤2000 words.
```

## Référence Lots précédents

| Lot | Scope | Sites | Triage | KEEP |
|:----|:------|------:|:-------|:-----|
| 4a  | `app/api/groups/**` | 22 | Modéré 50/50 | 0 cleanup-attempt |
| 4b  | `app/api/monthly-recap/{...9 routes simples}` | 132 | Aggressif 86/14 | 0 cleanup-attempt |
| 4c  | `app/api/{profile,savings/data,bank-balance}` | 52 | Strict 83/17 | 0 cleanup-attempt |
| 4d  | `app/api/savings/transfer` | 38 | Strict 84/16 | 3 cleanup-attempts CRITIQUES |
| 4e  | `lib/api/finance/**` (12 fichiers) | 152 | Strict 78/22 | 3 cleanup-attempts + 1 fallback |
| 5   | couche client (30 fichiers) | 193 | Strict 69/31 | 5 cleanup-attempts + 1 boot-path PWA |
| 5b  | 3 fichiers serveur orphelins (auth/session + recover + status-test DELETE) | 16 | Strict 67/33 sur triage | 2 cleanup-attempts CRITIQUES |
| **5c estimé** | **8 fichiers libs server-side foundationnelles** | **54** | **À arbitrer Phase 1 — probablement Modéré 60/40** | **À déterminer (probablement 1-2 cleanup-attempts si Q3 surface boot validations)** |

## Ce qui reste APRÈS Lot 5c

| Scope | Sites estimés | Bloqué par |
|:------|------:|:-----------|
| `app/api/monthly-recap/process-step1/route.ts` | 120 | I5 (extraction logique métier) |
| `lib/financial-calculations.ts` | 112 | I4 (god file refactor) |
| `app/api/monthly-recap/complete/route.ts` | 85 | I5 |
| `app/api/monthly-recap/auto-balance/route.ts` | 66 | I5 |
| `app/api/monthly-recap/balance/route.ts` | 63 | I5 |
| `app/api/debug/**` (~68 sites) | 68 | rien — opportunité Lot 5d optionnel |
| `lib/financial-logger.ts` | 11 | I4 (alignement avec lib/logger.ts) |
| `lib/logger.ts` | 4 | NEVER (intentional, boundary disable) |
| `lib/__tests__/logger.test.ts` | 1 | NEVER (test du logger lui-même) |

**Total post-Lot 5c estimé : ~225 console.\* restants** (vs ~278 actuel = −54).

**Lot 5d optionnel** (si on veut continuer avant I5) : `app/api/debug/**` ~68 sites. Routes blockedInProduction donc faible enjeu sécurité, mais nettoyer une fois pour toutes. Découpage par fichier (le plus gros : reset-budgets 21).

**Lot 6 final** : sweep + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` après que I5 ait extrait les 4 routes monthly-recap stateful (~334 sites) et I4 ait refactor financial-calculations (112) + financial-logger (11).

## Bonus axes hors-scope mais pertinents

### Axe A — `chore(format): fix pre-existing prettier drift`

`pnpm format:check` retourne 2 issues pré-existantes :
- `doc2/audit/AUDIT-RESOLUTIONS.md` — fichier untracked, `pnpm format` le corrigerait
- `next.config.js` — fichier modifié par Lot 1 (commit 7419657), prettier veut le reformater

**Décision suggérée** : sortir un commit séparé indépendant de Lot 5c. **Hors scope Lot 5c**.

### Axe B — `errorMessage(err: unknown): string` helper

Le pattern `error instanceof Error ? error.message : String(error)` se trouve dans **30+ sites**. Une factorisation `lib/error-helpers.ts` réduirait la duplication. **À faire après I4**. **Hors scope Lot 5c**.

## Sortie attendue

Plan dans `C:\Users\gille\.claude\plans\sprint-cleanup-i8-<random>.md` qui :

1. Confirme/redresse la Phase 1 audit (54 sites distincts ?)
2. Arbitre Q1 (monthly-recap-calculations couplé I5 ou indépendant)
3. Arbitre Q2/Q3/Q4 (verdicts per-site + découpage)
4. Décrit le wirage ESLint (paths explicites vs glob `app/auth/**`)
5. Documente la verif end-to-end attendue

Puis 3-4 commits courts + closeout CLAUDE.md (§1 progression entry + §6 Logs Migration progressive update + §11 Roadmap Lot 5c entry).
