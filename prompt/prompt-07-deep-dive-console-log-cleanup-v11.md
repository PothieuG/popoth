# Sprint Cleanup-I8 / Lot 5d — Console.* dans `app/api/debug/**`

## Contexte

Lot 5c livré 2026-05-10 (8 fichiers libs server-side foundationnels indépendants I4/I5, 45 sites → 23 KEEP+migrate / 18 DROP / 3 file-internal-deleted + DELETE `testSupabaseConnection()`, 1 cleanup-attempt CRITIQUE + 5 audit-trail CRITIQUES préservés, lint baseline **482 → 461**).

**Lot 5d** est la **septième salve optionnelle** du chantier console.log cleanup, ciblant les routes debug avant que les Lots 6 final + I5 (extraction process-step1) n'arrivent. Scope : `app/api/debug/**` ~68 sites estimés (audit prompt source à confirmer Phase 1, pattern miroir Lots 4b/4d/4e/5/5c où grep -c surcompte multi-line).

**Pourquoi optionnel et pas bloquant** : ces routes sont toutes gardées par `blockInProduction()` (cf. CLAUDE.md §6 + [lib/debug-guard.ts](lib/debug-guard.ts)) — elles renvoient un 404 systématique en prod, donc leur logging n'a aucun impact runtime sur l'utilisateur final. Triage agressif acceptable.

**Pourquoi maintenant et pas plus tard** :

1. Les fichiers debug sont **petits, indépendants, isolés** (préfixe path `app/api/debug/`, pas de dépendance circulaire avec les routes utilisateur).
2. Permet de **boucler la couche serveur côté `app/api/`** avant le grand œuvre I5 — après Lot 5d, seuls les 4 god routes monthly-recap stateful + I4 financial-calculations + financial-logger restent à migrer.
3. **Setup pour Lot 6 final** : Lot 6 activera `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs`. Plus on a fermé de domaines avant, moins le diff Lot 6 sera massif (et plus la détection des oubliés sera précise).

## Scope (estimation à confirmer Phase 1)

Inventaire à exécuter en Phase 1 :

```bash
# Compter les fichiers + sites distincts par fichier
Glob app/api/debug/**/*.ts
# Pour chaque fichier, audit console.* (cf. règle d'or §6 Logs)
```

Estimations indicatives du brief Lot 5c (« ~68 sites ») :

| Fichier (à confirmer) | Sites estimés | Note |
| :--- | ---: | :--- |
| `app/api/debug/reset-budgets/route.ts` | ~21 | Le plus gros du périmètre debug (selon le brief Lot 5c) |
| Autres routes debug (~5-7 fichiers, à inventorier) | ~47 | Reset/seed helpers blockedInProduction |

**Total estimé : ~68 sites distincts dans ~6-8 fichiers** (à corriger en Phase 1 — pattern grep -c inflated multi-line attendu).

## Pourquoi triage Agressif (pas Strict ni Modéré)

**Decisions par défaut** que la Phase 1 doit confirmer/redresser :

- **Argument pour Agressif (recommandé)** : les routes sont blockedInProduction. En dev, le développeur a déjà la console ouverte et la stack trace Vercel-less reste accessible via Next.js dev server logs. Les `console.log` sont du flow log debug pur (qui a appelé le seed, combien de rows insérées, etc.) — l'utilité productive est zéro. Pattern miroir Lot 4b (86/14) ou Lot 5b strict 67/33 par discipline.
- **Argument pour Modéré** : si certaines routes loggent un état post-seed important pour le diagnostic dev (e.g. `'Seeded 47 budgets for userId X'`), on peut KEEP+migrate vers `logger.info` pour qu'il fire en dev (`LOG_LEVEL=debug`) sans polluer prod.
- **Argument pour Strict** : cohérence avec Lots 4c/4d/4e/5/5c qui ont tous strict 67-84/16-33.

**Recommandation Phase 1** : commencer par lister les sites et catégoriser :

1. Combien sont `console.log` flow log pur (DROP en agressif) ?
2. Combien sont `console.error` DB-error qui peuvent quand même surfacer en dev (KEEP+logger.error pour grep-ability) ?
3. Y a-t-il des cleanup-attempts CRITIQUES ? **Très improbable sur des routes de seed** mais à vérifier — un seed transactionnel qui rollback partiellement pourrait fire un log critique.

Ratio attendu : **80-90% DROP / 10-20% KEEP** (plus agressif que Lot 4b 86/14 parce que blockedInProduction ⇒ logs n'ont aucune valeur en prod, contre Lot 4b qui était sur des routes de status user-facing).

## Décisions à arbitrer Phase 1

### Q1 — Triage philosophy

- **A — Agressif 85/15** (Recommandé) : DROP toutes les `console.log` flow, KEEP+migrate `logger.error` les DB errors discriminantes (pour qu'un dev qui debug en dev puisse grep `[error]`).
- **B — Strict 75/25** : cohérence Lots 4c/4d/4e/5/5c, KEEP-side plus large incluant les `console.log` "Seeded N rows" comme audit trail dev.
- **C — Modéré 60/40** : comme A mais les `console.log` "Seeded N rows" migrent à `logger.info` (visible en dev LOG_LEVEL=debug, droppé en prod par SWC strip).

Triage final dépend de la nature exacte des logs trouvés Phase 1. Default = A.

### Q2 — Découpage commits

| Option | Description |
| :--- | :--- |
| **α (Recommandé)** | 1 commit triage (tous fichiers) + 1 commit ESLint + 1 closeout = **3 commits**. Mirror Lot 4d single-fichier mais multi-fichiers (justifiable car cohérent par domaine `app/api/debug/**`). |
| **β** | 2 commits triage (split par sous-domaine si Phase 1 le justifie — e.g. seed vs reset vs query helpers) + ESLint + closeout = **4 commits**. Plus granulaire mais le scope est petit. |

Recommandation : **α** sauf si Phase 1 surface des sous-domaines avec triages divergents (e.g. seed routes vs query routes).

### Q3 — ESLint glob

**Stratégie obvious** : glob global `app/api/debug/**` ajouté au bloc per-file `no-console: 'error'` dans [eslint.config.mjs](eslint.config.mjs). Future-proof : toute future route debug auto-protégée.

Pas de question Q3 — c'est mécanique.

### Q4 — Interaction avec `lib/debug-guard.ts`

[lib/debug-guard.ts](lib/debug-guard.ts) est le module qui exporte `blockInProduction()`. Vérifier Phase 1 si ce fichier a des `console.*` sites — s'il en a, **les inclure dans Lot 5d** (cohérence du domaine debug). S'il n'en a pas, l'ajouter quand même à l'ESLint glob (future-proof). Brief Lot 5c n'a pas mentionné `lib/debug-guard.ts` séparément — à vérifier.

## Wirage ESLint

Extension du bloc per-file `no-console: 'error'` avec :

```js
{
  files: [
    // ... entries existantes Lots 3-5c ...
    'app/api/debug/**',
    'lib/debug-guard.ts',  // si Phase 1 surface des console.* — sinon future-proof
  ],
  rules: { 'no-console': 'error' },
}
```

**Sanity test** : injection `console.log('SANITY-LOT5D')` dans `app/api/debug/<route>/route.ts` → `pnpm lint:check` exit 1 avec 1 error. Revert vérifié exit 0.

## Critères de succès

### Greps invariants (post commits)

```
Grep -P "console\.(log|error|warn|info|debug)" app/api/debug/
# Expect: 0 hit (ou correspond aux KEEP attendus si Modéré)

Grep -l "from '@/lib/logger'" app/api/debug/
# Expect: N hits (selon KEEP-count après triage)
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 461 → ~430-450 estimé** (−10-30 selon DROP `console.log` ratio — `console.error` allow-listés n'impactent pas la baseline)
- `pnpm test:run` 30 passed / 34 skipped inchangé (pas de tests modifiés)
- `pnpm format:check` exit 0 sur les fichiers touchés
- `pnpm build` 55/55 routes inchangé (debug routes sont buildées même si blockedInProduction)
- `pnpm verify` exit 0

### Smoke browser deferred to user

Routes debug ne sont **accessibles qu'en dev** (NODE_ENV !== 'production'). Pour exercer :

```bash
NODE_ENV=development pnpm dev
# Hit chaque route debug via curl ou navigateur, vérifier la réponse fonctionne
# Si LOG_LEVEL=debug, vérifier que les KEEP+migrate logger.* apparaissent dans la console dev server
```

En prod (Vercel preview / production deploy), toutes les routes debug doivent retourner 404 (cf. CLAUDE.md §6 — `blockInProduction()` renvoie 404 pas 403 pour ne pas révéler l'existence).

## Phase 1 — Audit (à exécuter)

1 Explore agent suffit (scope estimé < 80 sites, ~6-8 fichiers tous lus en < 800 lignes total) :

```
Audit `console.*` sites dans `app/api/debug/**` pour Sprint Cleanup-I8 / Lot 5d. Working directory : c:\DataGillesPothieu\Personal\Popoth_App_Claude

Toutes ces routes sont gardées par blockInProduction() (cf. lib/debug-guard.ts) et renvoient 404 en prod. Triage attendu Agressif 80-90% DROP — les logs n'ont aucune valeur prod.

Tasks :
1. Glob app/api/debug/**/*.ts (lister tous les fichiers + LOC).
2. Pour chaque fichier, compter (a) distinct statements `console.*` vs (b) grep -c (multi-line inflation pattern miroir Lots 4b/4d/4e/5c).
3. Pour chaque site, classifier per règle d'or §6 Logs :
   - (a) outer catch-all 500 → DROP (mais ces routes retournent peut-être 200 avec error metadata, à vérifier)
   - (b) DB error discriminant → KEEP+migrate logger.error
   - (c) silently-swallowed → KEEP+migrate
   - (d) cleanup-attempt CRITIQUE → KEEP+migrate (très improbable sur seed routes)
4. Verdict DROP / KEEP+migrate vers logger.{error,warn,info,debug} pour chaque site.
5. Catch blocks à normaliser `} catch (error) { → } catch {}` après DROP (CLAUDE.md §6 TS 4.4+).
6. Vérifier si `lib/debug-guard.ts` contient des `console.*` sites — si oui, l'inclure dans le scope ; sinon, juste l'inclure dans le glob ESLint future-proof.
7. **Cas particuliers à signaler** :
   - Logs qui annoncent "Seeded N rows" / "Reset complete" → décision Q1 (DROP agressif vs logger.info modéré)
   - Logs PII (montants, IDs user) → DROP même en triage Strict (cohérent Lot 4c profile + Lot 4d savings/transfer)
   - Cleanup-attempts (rollback impossible) → KEEP+migrate logger.error **non-négociable** (peu probable sur seed mais à vérifier)
8. Per-file totals + grand total (DROP / KEEP+migrate / cleanup-attempts CRITIQUES count).

Target ≤1500 words. Markdown report, one section per file.
```

## Référence Lots précédents

| Lot | Scope | Sites | Triage | KEEP |
| :--- | :--- | ---: | :--- | :--- |
| 4a | `app/api/groups/**` | 22 | Modéré 50/50 | 0 cleanup-attempt |
| 4b | `app/api/monthly-recap/{...9 simples}` | 132 | Agressif 86/14 | 0 cleanup-attempt |
| 4c | `app/api/{profile,savings/data,bank-balance}` | 52 | Strict 83/17 | 0 cleanup-attempt |
| 4d | `app/api/savings/transfer` | 38 | Strict 84/16 | 3 cleanup-attempts CRITIQUES |
| 4e | `lib/api/finance/**` (12 fichiers) | 152 | Strict 78/22 | 3 cleanup-attempts + 1 fallback |
| 5 | couche client (30 fichiers) | 193 | Strict 69/31 | 5 cleanup-attempts + 1 boot-path PWA |
| 5b | 3 orphelins (auth/session + recover + status-test DELETE) | 16 | Strict 67/33 | 2 cleanup-attempts CRITIQUES |
| 5c | 8 libs server-side foundationnelles I4/I5-indép + DELETE testSupabaseConnection | 45 | Modéré 56/44 | 1 cleanup-attempt + 5 audit-trail CRITIQUES |
| **5d estimé** | **`app/api/debug/**`** | **~68** | **Agressif 80-90/10-20 (à confirmer Phase 1)** | **0-1 cleanup-attempt attendu (très improbable)** |

## Ce qui reste APRÈS Lot 5d

| Scope | Sites estimés | Bloqué par |
| :--- | ---: | :--- |
| `app/api/monthly-recap/process-step1/route.ts` | 120 | I5 (extraction logique métier) |
| `lib/financial-calculations.ts` | 112 | I4 (god file refactor) |
| `app/api/monthly-recap/complete/route.ts` | 85 | I5 |
| `app/api/monthly-recap/auto-balance/route.ts` | 66 | I5 |
| `app/api/monthly-recap/balance/route.ts` | 63 | I5 |
| `lib/financial-logger.ts` | 11 | I4 (alignement avec lib/logger.ts) |
| `lib/logger.ts` | 4 | NEVER (intentional, boundary disable) |
| `lib/__tests__/logger.test.ts` | 1 | NEVER (test du logger lui-même) |

**Total post-Lot 5d estimé : ~462 console.\* restants** (vs ~233 actuel post-5c — wait, ce calcul est faux : ~233 actuel - ~68 (Lot 5d) = ~165 restants après Lot 5d, dominé par I4/I5 = ~457 sites lourds qui ne sont pas en scope avant les chantiers refactor). Re-verify en Phase 1.

**Lot 6 final** (post-I4+I5) : sweep + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` après que :

1. I5 ait extrait les 4 routes monthly-recap stateful (`process-step1`/`complete`/`balance`/`auto-balance`, ~334 sites)
2. I4 ait refactor `financial-calculations.ts` (112 sites) + aligné `financial-logger.ts` (11 sites) avec `lib/logger.ts`

Après Lot 6, le glob principal `no-console: 'error'` couvre tout le repo, et le bloc per-file devient une liste d'exceptions (seulement `lib/logger.ts` boundary).

## Bonus axes hors-scope mais pertinents

### Axe A — `chore(format): fix pre-existing prettier drift`

`pnpm format:check` retourne 2 issues pré-existantes (depuis Lot 5 / Lot 5b déjà documentées) :

- `doc2/audit/AUDIT-RESOLUTIONS.md` — fichier untracked, `pnpm format` le corrigerait
- `next.config.js` — fichier modifié par Lot 1 (commit `7419657`), prettier veut le reformater

**Décision suggérée** : commit séparé indépendant de Lot 5d. **Hors scope Lot 5d**. Peut être bundlé avec un sprint "Cleanup post-Dependabot" si user le préfère.

### Axe B — `lib/auth.ts` dead code purge

Phase 1 audit Lot 5c a surfacé que `signUp`, `resetPassword`, `updatePassword` dans `lib/auth.ts` n'ont **0 consumer dans `app/`** (verified via grep). Dead code candidate. **Hors scope Lot 5d** (c'est un chantier dead-code purge séparé, pas un console.log cleanup) mais documenté ici pour mémoire — sprint v12 ou plus tard.

### Axe C — `doc2/` migration

Working tree a `docs/` deletion staged + `doc2/` untracked. Si user veut formaliser la migration, c'est un sprint doc à part. **Hors scope Lot 5d**.

## Sortie attendue

Plan dans `C:\Users\gille\.claude\plans\sprint-cleanup-i8-<random>.md` qui :

1. Confirme/redresse la Phase 1 audit (~68 sites distincts confirmé ?)
2. Arbitre Q1 (triage philosophy : A agressif vs B strict vs C modéré)
3. Arbitre Q2 (découpage : α vs β)
4. Confirme Q3 (ESLint glob `app/api/debug/**` + éventuel `lib/debug-guard.ts`)
5. Documente la verif end-to-end attendue
6. Liste les fichiers exact qui seront édités

Puis 3-4 commits courts + closeout CLAUDE.md (§1 progression entry + §6 Logs Migration progressive update + §11 Roadmap Lot 5d entry).
