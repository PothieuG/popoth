# Sprint Cleanup-I8 / Lot 4d — Migration `app/api/savings/transfer/**`

## Contexte

Quatrième salve API du chantier console.log cleanup, après **Lot 4a** (`app/api/groups/**`, 22 sites → 11/11 triage Modéré), **Lot 4b** (`app/api/monthly-recap/{...9 routes simples}/**`, 132 sites → 113/19 triage Agressif), et **Lot 4c** (`app/api/{profile,savings/data,bank-balance}/**`, 52 sites → 43/9 triage Strict). Lot 4d cible **un seul fichier**, suffisamment dense pour son propre commit : `app/api/savings/transfer/route.ts` (~45 sites, 401 LOC).

**Pourquoi un fichier seul** : `savings/transfer` est le plus gros consommateur de `console.*` qui reste en dehors des god files (process-step1, financial-calculations, complete, balance, auto-balance — tous hors scope, couplés I5 / I4). L'isoler en commit propre permet une review serrée sans noise des autres routes.

**Audit pré-sprint** (`grep -cE "console\.(log|error|warn|info|debug)"` sur `cleanup` au 2026-05-10 post-Lot 4c) :

| Fichier                     | Sites | LOC | Pattern dominant attendu                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ----: | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `savings/transfer/route.ts` |    45 | 401 | Mix dense : (a) headers visuels `💸💸💸 ===` + `🐷🐷🐷 ===` (~12 sites — pattern miroir savings/data Lot 4c et step1-data Lot 4b) + (b) flow logs PII (montants €, budget IDs, user IDs ~13 sites) + (c) DB errors discriminantes (~12 sites) + (d) **cleanup-attempts critiques** (~3 sites — rollback budget si tirelire update fail, pattern miroir Lot 4a L140) + (e) success logs + catch-all (~5 sites) |

**Wirage helper auth** : route déjà wrappée en `withAuthAndProfile` depuis Sprint Refactor-Architecture-v4 — pas de boilerplate auth à toucher. Voir [`lib/api/with-auth.ts`](../lib/api/with-auth.ts).

**Ratio attendu** : **~55-60% DROP / ~40-45% KEEP+migrate** — intermédiaire entre Lot 4a Modéré (50/50, beaucoup d'erreurs DB) et Lot 4c Strict (83/17, beaucoup de flow logs DROP). Plus de KEEP que Lot 4c parce que `savings/transfer` a des **cleanup-attempts critiques** (rollback budget source/dest) qui méritent absolument une trace si elles fire — ce qui ne devrait JAMAIS arriver en steady state, donc précisément le genre de log qu'un dev ira chercher en post-mortem si la base finit dans un état inconsistant.

**Critique fichiers à modifier** :

- [app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts) — 45 sites
- [eslint.config.mjs](../eslint.config.mjs) — extension du glob (1 path à ajouter)
- [CLAUDE.md](../CLAUDE.md) §6 (compteur logs + liste fichiers protégés) + §11 (entry roadmap)

**Pattern de référence** : Lot 4c, commits `6087506` (triage 3 fichiers) / `48556f0` (eslint glob) / `edd068f` (closeout). Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-temporal-octopus.md`.

## Audit ligne-par-ligne (à confirmer en Phase 1)

L'audit Grep préliminaire (head 50/45) a surfacé les patterns suivants. À valider intégralement par lecture du fichier en Phase 1.

### Headers visuels et flow logs PII (~25 sites — DROP attendu)

**POST handler — bloc transfert budget→budget** (L57-66, L112-114, L149-154) :

- L58-66 (9 sites) : header `💸💸💸 ===` + `[SAVINGS TRANSFER] DÉBUT DU TRANSFERT` + 4 lignes payload (`Contexte`, `De budget`, `Vers budget`, `Montant`) + footer.
  → **DROP** : pur cosmétique + dump PII (montant en clair).
- L112-114 : `'✅ Validation OK:'` + 2 dump stats (`Budget source` + `Budget destination`).
  → **DROP** : success path verbeux.
- L149-154 : header succès `✅✅✅ TRANSFERT RÉUSSI` + 2 lignes "before → after" (PII : montants `€` en clair) + footer.
  → **DROP** : pur cosmétique.

**Helper `transferToPiggyBank` ou similaire** (L191-198, L211, L229, L247, L278-280) :

- L191-198 (8 sites) : header `🐷🐷🐷 ===` + `[PIGGY BANK]` + 4 lignes payload (`Action`, `Montant`, `Contexte`, `User ID`) + footer.
  → **DROP** : pur cosmétique + dump PII.
- L211 : `'🐷 Filtre appliqué:', matchFilter` — debug dump.
  → **DROP**.
- L229 : `'🐷 Montant actuel tirelire: ${currentAmount}€'` — flow + PII.
  → **DROP**.
- L247 : `'🐷 Nouveau montant tirelire: ${newAmount}€'` — flow + PII.
  → **DROP**.
- L278-280 : `'✅ Tirelire mise à jour avec succès'` + footer + ligne vide.
  → **DROP**.

### DB errors discriminantes (~12 sites — KEEP+migrate attendu)

| Ligne | Méthode | Contenu approx                                               | Justification KEEP                                                   |
| ----: | :------ | :----------------------------------------------------------- | :------------------------------------------------------------------- |
|    83 | error   | `'❌ Budget source non trouvé:', fromError`                  | DB select budget source — discriminante (vs L96 dest)                |
|    96 | error   | `'❌ Budget destination non trouvé:', toError`               | DB select budget dest — discriminante (vs L83 source)                |
|   123 | error   | `'❌ Erreur mise à jour budget source:', updateFromError`    | DB update budget source — discriminante                              |
|   135 | error   | `'❌ Erreur mise à jour budget destination:', updateToError` | DB update budget dest                                                |
|   221 | error   | `'❌ Erreur récupération tirelire:', getPiggyError`          | DB select piggy_bank                                                 |
|   255 | error   | `'❌ Erreur mise à jour tirelire:', updateError`             | DB update piggy_bank                                                 |
|   270 | error   | `'❌ Erreur création tirelire:', insertError`                | DB insert piggy_bank (création initiale si pas de row pré-existante) |
|   336 | error   | `'❌ Erreur mise à jour budget:', updateBudgetError`         | DB update budget (autre helper)                                      |
|   364 | error   | `'❌ Erreur mise à jour tirelire:', updateError`             | DB update piggy_bank (autre helper)                                  |

### Cleanup-attempts critiques (~3 sites — KEEP+migrate **prioritaire**)

| Ligne | Méthode | Contenu approx                                       | Justification KEEP **critique**                                                                                                                                                                                                                                                                    |
| ----: | :------ | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   140 | error   | `'❌ Erreur rollback budget source:', rollbackError` | **Cleanup-attempt** : si l'update destination fail après l'update source réussi, on tente un rollback du source. Si ce rollback fail aussi, la base est dans un état inconsistant — log critique pour post-mortem. Pattern miroir Lot 4a L140 (cleanup `delete groups` après `profile join` fail). |
|   369 | error   | `'❌ Rollback budget impossible:', rollbackErr`      | Idem (autre helper) — état inconsistant détecté                                                                                                                                                                                                                                                    |
|   385 | error   | `'❌ Rollback budget impossible:', rollbackErr`      | Idem (3e occurrence dans un 3e helper)                                                                                                                                                                                                                                                             |

**Règle d'or appliquée** : ces 3 sites sont précisément le pattern (d) de la règle d'or §6 ("cleanup-attempt critique → KEEP+migrate"). À migrer **sans ambiguïté** vers `logger.error`.

### Catch-all outer (~1-2 sites — DROP attendu)

- L173 : `'❌ Erreur dans POST /api/savings/transfer:', error` — catch-all outer (Next.js capture stack côté Vercel).
  → **DROP**.

### Sites éventuels non encore identifiés

L'audit Grep partiel s'est arrêté à 50/45. **Lire le fichier intégralement en Phase 1** pour confirmer le compteur 45 et identifier d'éventuels patterns spéciaux (e.g. `console.warn` silently-swallowed comme dans Lot 4c L64).

## Décisions à arbitrer en Phase 1/3

### Q1 — Profondeur triage

Trois options selon le ratio cleanup-attempts vs flow logs :

- **Strict (Lot 4c precedent)** : DROP les flow logs avec PII même quand ils discriminent un branche métier (e.g. `'🐷 Montant actuel tirelire'`) ; KEEP+migrate uniquement DB errors + cleanup-attempts. Ratio attendu **~30 DROP / ~15 KEEP** (~67/33).
- **Modéré (Lot 4a precedent)** : KEEP+migrate les flow logs sur les ops critiques (rollback, balance changes) si le payload PII reste utile au diagnostic post-mortem. Ratio attendu **~25 DROP / ~20 KEEP** (~56/44).
- **Aggressif (Lot 4b precedent)** : DROP très large des dump-debug et des success paths (les `✅✅✅`). Ratio attendu **~33 DROP / ~12 KEEP** (~73/27).

**Recommandation par défaut** : **Strict**. Cohérent avec Lot 4c (PII = first_name/last_name/salary, ici PII = montants € + IDs). Les cleanup-attempts (3 sites) sont KEEP non-négociables ; les DB errors (12 sites) sont KEEP standard ; tout le reste est dump-debug ou flow log → DROP.

### Q2 — Découpage commits

Single fichier, 45 sites, ~3 helpers internes (transfert budget→budget, tirelire op, autre helper L336+). Options :

- **Option A — 1 commit unique** (recommandé) : `refactor(api/savings/transfer): triage console.* — drop dump-debug + PII flow, migrate DB errors + cleanup-attempts`. Single fichier, scope clair, review aisée même avec 45 sites.
- **Option B — 2 commits par section** : commit 1 = bloc POST transfert principal (sites L58-173), commit 2 = helpers internes piggy bank (L191-385). Plus de grain mais le fichier est trop coupled pour vraiment isoler les diffs.

**Recommandation** : Option A.

### Q3 — Cleanup-attempts critiques : `logger.error` vs `logger.warn` ?

Les 3 sites L140 / L369 / L385 sont des "rollback impossible" — l'erreur n'a pas réussi à se réparer. Sémantiquement c'est une **erreur** (l'invariant est violé), pas un warning. Mais ESLint `'no-console': ['warn', { allow: ['warn', 'error'] }]` allow-list les deux.

**Recommandation** : `logger.error` (sémantique correcte ; gating `LOG_LEVEL=error` les capture toujours en prod par défaut).

### Q4 — ESLint glob extension

Lot 4c a ajouté 3 paths explicites (`profile/**`, `savings/data/**`, `bank-balance/**`). Lot 4d ajoute `savings/transfer/**`. Avec savings/data + savings/transfer maintenant couverts, on peut **swap les deux entrées explicites pour un glob global `app/api/savings/**`\*\* (tous les fichiers du domaine seront protégés, et toute future route savings sera auto-incluse).

État avant ([eslint.config.mjs](../eslint.config.mjs) post-Lot 4c) :

```js
{
  files: [
    'middleware.ts',
    'lib/expense-allocation.ts',
    'lib/logger.ts',
    'app/api/groups/**',
    'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**',
    'app/api/profile/**',
    'app/api/savings/data/**',
    'app/api/bank-balance/**',
  ],
  rules: { 'no-console': 'error' },
},
```

État après — **Option α (cleanup en swap)** :

```js
files: [
  'middleware.ts',
  'lib/expense-allocation.ts',
  'lib/logger.ts',
  'app/api/groups/**',
  'app/api/monthly-recap/{status,refresh,resume,initialize,step1-data,step2-data,accumulate-piggy-bank,transfer,update-step}/**',
  'app/api/profile/**',
  'app/api/savings/**',     // ← swap: data + transfer maintenant tous deux protégés
  'app/api/bank-balance/**',
],
```

État après — **Option β (ajout simple)** :

```js
files: [
  ...existing,
  'app/api/savings/transfer/**',  // ← ajouté à côté de savings/data/**
],
```

**Recommandation** : **Option α**. CLAUDE.md §6 documente déjà la convention : "Quand un domaine partiellement migré atteint 100% de couverture, swap la brace expansion pour un glob global (réduit le bruit de la config)." Ici on est exactement dans ce cas pour `savings/`.

**Sanity test** : injecter `console.log("test")` temporaire dans `savings/transfer/route.ts`, lancer `pnpm lint:check`, attendre exit 1 avec 1 error sur la ligne injectée.

## Découpage en 3 commits

### Commit 1 — `refactor(api/savings/transfer): triage console.* — drop PII flow + dump-debug, migrate DB errors + 3 cleanup-attempts`

Scope : 1 fichier, 45 sites.

**Imports** : ajout `import { logger } from '@/lib/logger'` au top.

**Catch normalization** : 1-2 catch-blocks. Pour ceux dont l'`error` n'est plus utilisé après DROP du catch-all : `} catch (error) {` → `} catch {` (CLAUDE.md §6). Vérifier d'abord que le binding n'est pas utilisé dans le `return NextResponse.json({...}, {status: 500})` (e.g. `error.message` propagé au client → garder le binding).

**Verif intermédiaire** : `pnpm typecheck && pnpm lint:check` exit 0.

### Commit 2 — `chore(eslint): swap savings glob to cover savings/transfer (Lot 4d)`

Extension du bloc per-file dans [eslint.config.mjs](../eslint.config.mjs) — Option α (swap `savings/data/**` + ajout `savings/transfer/**` → glob global `savings/**`). Voir Q4 ci-dessus.

Sanity test injection + revert.

### Commit 3 — `docs(claude): closeout Sprint Cleanup-I8 / Lot 4d`

Mises à jour [CLAUDE.md](../CLAUDE.md) :

- **§1 Score** : ajouter `~98.2 stable après Lot 4d (app/api/savings/transfer, 45 sites → ~XX/~YY triage strict, lint baseline 783 → ~7XX)`.
- **§6 Logs / titre** : `Lot 1 + Lot 3 + Lot 4a + Lot 4b + Lot 4c + Lot 4d`.
- **§6 Logs / Per-file ESLint override** : actualiser la liste — `savings/data/**` swap pour `savings/**` (mention swap comme cas concret de la règle "100% couverture domaine → glob global").
- **§6 Logs / Migration progressive** : recompter via `Grep -c "console\.(log|error|warn|info|debug)"` post-commit. Top 5 fichiers probablement inchangé. Mention ratio Lot 4d.
- **§11 Roadmap** : entry `✅ Sprint Cleanup-I8 / Lot 4d` + update item ⏭️ "Chantier console.log cleanup — Lots 2 / 4d-6" → "Lots 2 / 4e-6".

## Critères de succès

### Greps invariants

```bash
# 0 hit attendu (post commit 1)
Grep -P "console\.(log|error|warn|info|debug)" app/api/savings/transfer/route.ts

# 1 fichier attendu
Grep -l "from '@/lib/logger'" app/api/savings/transfer/route.ts
```

### Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0. **Lint baseline 783** (post-Lot 4c) → estimer **~755-770** (les ~25 `console.log` DROP sont warn-counted, les ~13 `console.error` DROP étaient allow-listés donc 0 delta lint). Mesurer pré/post via `pnpm lint:check 2>&1 | tail -1`.
- `pnpm test:run` 30 passed / 34 skipped inchangé.
- `pnpm format:check` exit 0.
- `pnpm build` 56/56 routes exit 0.
- `pnpm verify` exit 0 (chaîne complète) en clôture.

### Smoke browser (deferred to user)

- `/dashboard` → tester le drawer transfert savings (UI exerce POST `/api/savings/transfer` budget→budget).
- Tester un transfert vers tirelire (UI exerce le helper `transferToPiggyBank`).
- Forcer un cas d'erreur (e.g. budget destination supprimé entre fetch et update) pour vérifier que `logger.error('❌ Erreur rollback budget source')` fire bien si le rollback est exercé. **Note** : ce path est très difficile à reproduire manuellement (race condition) — pas bloquant pour la livraison du sprint.

### Ratio supprimé/migré documenté dans le closeout

Format attendu : "X supprimés, Y migrés sur 45 sites — Z% de bruit éliminé". Estimation triage **Strict** : **~30 DROP / ~15 KEEP+migrate** (~67%/~33%).

## Pivots possibles à anticiper en Phase 1

L'audit pré-sprint des Lots 4a-c a régulièrement surfacé des écarts vs l'estimation initiale :

- **Lot 4b** : 203 sites estimés → 132 distincts (grep -c lignes vs sites distincts pour multi-line).
- **Lot 4b** : 17 KEEP estimés → 19 KEEP livrés (cohérence sur silently-swallowed normalisés à `logger.error`).
- **Lot 4c** : pivot L100 bank-balance arbitré KEEP (validation diagnostic NaN/string/négatif) malgré 400 immédiat suivant.

Pour Lot 4d, les pivots probables :

1. **Compteur 45 vs sites distincts** : confirmer après lecture intégrale (multi-line console.log peuvent gonfler le grep -c).
2. **Helpers internes** : le fichier a ~3 fonctions internes (`transferToPiggyBank` etc.) dont chacune a son propre catch. Le compte de catch-blocks à normaliser dépend de la lecture détaillée.
3. **`console.warn` éventuels** : Grep préliminaire n'a montré que `log`/`error`. Confirmer 0 `warn` (sinon, traiter comme silently-swallowed candidate).
4. **Cleanup-attempts L140 / L369 / L385** : confirmer que ces 3 sites sont bien des `error` dans des branches "rollback fail" (pas de simple "validation fail"). C'est le cas le plus critique pour la prod.

Ces pivots sont normaux — la règle d'or de triage (CLAUDE.md §6 Logs) guide les décisions, mais arbitrage user nécessaire pour les cas frontière.

## Hors scope (rappel)

- **Lot 4e** : routes finance résiduelles (à auditer via `Grep "console\." app/api/finance/`). Top contributors connus : `lib/api/finance/expenses-add-with-logic.ts` 35, `lib/api/finance/incomes.ts` 33, `lib/api/finance/budgets.ts` 33 — mais ce sont des `lib/api/finance/*` (handlers extraits Sprint Refactor-Architecture-v3), donc le scope `app/api/finance/**` ESLint glob ne les couvre pas directement. Plan possible : dual glob `lib/api/finance/**` + `app/api/finance/**`.
- **Lot 5** : composants UI. Top consumer attendu : `components/monthly-recap/MonthlyRecapFlow.tsx` 44 sites (surfacé en pré-sprint Lot 4c).
- **Lot 6** : sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs` + ajout des routes monthly-recap stateful (`complete`, `balance`, `recover`, `auto-balance`, `process-step1`) après que I5 ait extrait leur logique métier.
- Lot 2 (`lib/finance/*`) reste couplé I4.
- Branchement Sentry (chantier N3).
- Alignement `lib/financial-logger.ts` (couplé I4).

## Référence

- **Lot 4a** (Modéré, 22 sites → 11/11) : commits `877504b` / `8de275e` / `84e4e84` / `f6dd1b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-glistening-beaver.md`. Source de la règle d'or de triage.
- **Lot 4b** (Aggressif, 132 sites → 113/19) : commits `40e6099` / `60a8457` / `1b71f53` / `0694534` / `2df49b8`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-atomic-minsky.md`.
- **Lot 4c** (Strict, 52 sites → 43/9) : commits `6087506` / `48556f0` / `edd068f`. Plan : `C:\Users\gille\.claude\plans\sprint-cleanup-i8-temporal-octopus.md`. Première application du triage strict avec drop critique de 3 PII surfaces (first_name/last_name/salary).
- Convention §6 Logs (règle d'or de triage + per-file ESLint override) + §8 À-faire / À-ne-pas-faire dans CLAUDE.md.
- Pattern test logger : [lib/**tests**/logger.test.ts](../lib/__tests__/logger.test.ts) (11 cas pure-unit non-gated).
- Helper auth : [lib/api/with-auth.ts](../lib/api/with-auth.ts) — `app/api/savings/transfer/route.ts` est wrappée en `withAuthAndProfile` depuis Sprint Refactor-Architecture-v4.
- Logger : [lib/logger.ts](../lib/logger.ts) (Sprint Cleanup-I8 / Lot 1) — `logger.error/warn/info/debug`, gated `LOG_LEVEL`.
