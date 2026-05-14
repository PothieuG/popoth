# 06 — Sprint Cleanup-I8 / Lot 6 : sweep final + activation globale `no-console: 'error'`

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée `⏭️ Chantier console.log cleanup — Lots 2 / 6` |
| **Type** | dette technique |
| **Priorité** | Moyenne |
| **Effort estimé** | M (demi-journée) post-I6 |
| **Statut** | **Bloqué par chantier 01** (I6 doit extraire complete/route.ts d'abord) |
| **Dépendances** | 01 (I6), 13 (auto-balance reversed RPC fix peut-être bundlé) |
| **Bloque** | Activation globale `no-console: 'error'` finale dans bloc principal `eslint.config.mjs` |

## Contexte

CLAUDE.md §11 :

> ⏭️ **Chantier console.log cleanup — Lots 2 / 6** : Lot 1 (filet logger + strip prod) + Lot 3 (middleware + expense-allocation, 7 sites) + Lot 4a-e (massive coverage) + Lot 5 (couche client) + Lot 5b/5c/5d (orphelins server + libs + debug) livrés ; reste **~176 `console.*`** à migrer vers `lib/logger.ts` (cf. §6 Logs + règle d'or de triage). Migration progressive par opportunité — pas de gros commit "remove all". Lot 2 (`lib/finance/*` ~4 fichiers helpers RPC atomiques) **couplé I4** (déjà fait Sprint Refactor-I4 follow-up) ; **Lot 6 = sweep final + activation globale `no-console: 'error'` dans le bloc principal d'`eslint.config.mjs`** + ajout des routes monthly-recap stateful (`complete`, `balance`, `auto-balance`, `process-step1` ~334 sites) après que I5 ait extrait leur logique métier.

**Sprint Refactor-I5 a fermé `process-step1` (120 sites)** — il reste 3 fichiers monthly-recap stateful à fermer :

État actuel (audit Phase 1 confirmé) :
- **`app/api/monthly-recap/complete/route.ts`** : 65 sites — bloqué par chantier 01 (I6)
- **`app/api/monthly-recap/balance/route.ts`** : 62 sites — bloqué par chantier 01 ou 13
- **`app/api/monthly-recap/auto-balance/route.ts`** : 53 sites — bloqué par chantier 01 ou 13

Total ~180 sites à traiter dans Lot 6 (le reste = quelques sites résiduels dans des fichiers déjà partiellement migrés).

**Pattern de triage à reprendre** (CLAUDE.md §6 Logs règle d'or) :
- Rule (a) catch-all `console.error('Error in METHOD /api/...:', error)` → DROP (Vercel capture stack)
- Rule (b) DB error inline qui discrimine branche métier non-évidente → KEEP+migrate `logger.error`
- Rule (c) erreur silencieusement avalée (catch retourne 200/fallback) → KEEP+migrate `logger.error/warn`
- Rule (d) cleanup-attempt critique (rollback path) → KEEP+migrate `logger.error`

**Activation globale finale** : remplacer dans `eslint.config.mjs` le bloc principal `'no-console': ['warn', { allow: ['warn', 'error'] }]` par `'no-console': ['error', { allow: ['warn', 'error'] }]`. Cohérent avec les 50+ globs per-file `no-console: 'error'` déjà installés Lot 3-5d. Tout nouveau `console.log` futur → PR rouge automatique.

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Fermer le chantier console.log cleanup en migrant les ~180 `console.*` restants des 3 routes monthly-recap stateful (`complete`, `balance`, `auto-balance`) vers `logger.{warn,error,info,debug}`, puis activer globalement `'no-console': ['error', { allow: ['warn', 'error'] }]` dans le bloc principal d'`eslint.config.mjs`. Lint baseline finale ≤ 50 warnings.

### 2. Contexte technique

**Pré-requis BLOQUANT** : chantier 01 (I6) doit avoir extrait `complete/route.ts` en `lib/recap/complete-{algorithm,persist}.ts`. Sinon ce chantier 06 est impossible (les 65 sites de `complete` deviennent 0 sites dans le route + ~10-15 sites dans `complete-persist.ts` qui sont les KEEPs migrés). Sans I6, la migration brute du route serait re-faite post-I6, gaspillage.

**Optionnel (couplé)** : chantier 13 (auto-balance reversed RPC fix) peut être bundlé. Si fait avant, balance/auto-balance routes seront partiellement refactorisées et la migration plus rapide.

**Fichiers concernés** :
- `app/api/monthly-recap/balance/route.ts` (~62 sites)
- `app/api/monthly-recap/auto-balance/route.ts` (~53 sites)
- `app/api/monthly-recap/complete/route.ts` ou `lib/recap/complete-persist.ts` (selon avancement chantier 01)
- `eslint.config.mjs` (escalation glob + activation globale)

**État actuel** :
- Lint baseline ~183 warnings (~133 `console.log` de ces 3 fichiers + ~50 résiduels divers)
- 50+ globs per-file `no-console: 'error'` déjà installés (Lots 3-5d)
- Bloc principal toujours en `warn`
- Strip prod SWC (Lot 1 / Sprint Cleanup-I8) garantit 0 `console.log` runtime prod, indépendamment de la migration

**Tests existants pertinents** :
- Cas gated `SUPABASE_API_TESTS=1` couvrent partiellement balance + auto-balance (api-regressions.test.ts)
- Pas de mocked direct sur les 3 routes (à éviter — refactor I6 va les transformer)

**Précédents codebase** (à reprendre intégralement) :
- **Lot 4b** (CLAUDE.md §11) — 132 sites monthly-recap simples → 113 DROP / 19 KEEP (ratio 86/14, triage agressif)
- **Lot 4d** (CLAUDE.md §11) — 38 sites savings/transfer → 32 DROP / 6 KEEP (3 cleanup-attempts CRITIQUES préservés)
- **Lot 4e** (CLAUDE.md §11) — 152 sites lib/api/finance/ → 119/33 (3 cleanup-attempts + 1 fallback 200-on-error)
- **Lot 5d** (CLAUDE.md §11) — 64 sites debug routes → 45/12+7 multi-line (0 cleanup-attempt, all atomiques)

### 3. Spécifications fonctionnelles attendues

**Cas nominal** : aucun changement de comportement observable. Les 3 routes continuent de répondre identique (response shape + DB side effects byte-identique).

**Cas erreur** : si une cleanup-attempt CRITIQUE est silencieusement supprimée par erreur (rule a confondue avec rule c/d), bug latent activé. **Mitigation** : audit Phase 1 obligatoire pour identifier les cleanup-attempts AVANT triage.

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 Logs strictement
- **Règle d'or de triage** : pour CHAQUE site, se poser la question "est-ce que quelqu'un (toi, dans 6 mois, devant une prod en panne) lira ce log ?". Si non → DROP. Si oui mais sans cas concret → DROP. Cf. §6 Logs détaillé.
- **Préserver les cleanup-attempts CRITIQUES** : grep avant triage les patterns `try { rollback... }` ou `// CLEANUP-ATTEMPT` (commentaire convention Lot 4d/4e/5)
- **Catch normalisation** : si `error` binding n'est plus utilisé après DROP, passer à `} catch {` (TS 4.4+, CLAUDE.md §6)
- **Imports logger** : ajouter `import { logger } from '@/lib/logger'` au top des fichiers ayant ≥ 1 KEEP+migrate
- **ESLint glob** : étendre `eslint.config.mjs` per-file `no-console: 'error'` :
  - **Option α** (recommandée) : ajouter les 3 paths (`balance`, `auto-balance`, `complete`) à la brace expansion existante `app/api/monthly-recap/{...,balance,auto-balance,complete}/**`
  - Si chantier 01 (I6) déjà fait, le glob `complete/**` couvre aussi `lib/recap/complete-*.ts` (vérifier — sinon ajouter `lib/recap/complete-*.ts`)
- **Activation globale** : changer `'no-console': ['warn', { allow: ['warn', 'error'] }]` → `'no-console': ['error', { allow: ['warn', 'error'] }]` dans le bloc principal d'`eslint.config.mjs`
- **Baseline lint cible** : ≤ 50 warnings post-Lot 6 (vs 183 actuel = -133 minimum). Si baseline > 50, identifier les sources résiduelles et décider DROP/migrate.
- **Counter `as unknown as SupabaseClient`** : reste à 0

### 5. Critères d'acceptation vérifiables

- [ ] **0 console.log dans les 3 routes** : `Grep "console\.log" app/api/monthly-recap/{balance,auto-balance,complete}/` retourne 0 hit
- [ ] **0 console.log dans lib/recap/complete-** : `Grep "console\." lib/recap/complete-` retourne 0 hit (si I6 fait)
- [ ] **Activation globale** : `Grep "no-console.*error" eslint.config.mjs` retourne ≥ 2 hits (1 par-file glob précédent + 1 nouveau bloc principal)
- [ ] **Sanity test** : injection temporaire `console.log('SANITY-LOT6')` dans n'importe quel fichier applicatif (e.g. `app/page.tsx`) → `pnpm lint:check` exit 1 (preuve que l'activation globale fire)
- [ ] **lint** : `pnpm lint:check` exit 0, baseline ≤ 50 warnings (chiffre exact à confirmer post-migration)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests** : `pnpm test:run` 113 passants stable (pas de test cassé)
- [ ] **tests gated** : `SUPABASE_API_TESTS=1 pnpm test:run` cas balance/auto-balance toujours verts byte-identique
- [ ] **build** : `pnpm build` exit 0
- [ ] **smoke browser** : flow `/monthly-recap` complet (balance + auto-balance + complete) — toutes les routes retournent 200 + DB rows correctes

### 6. Tests à écrire ou à mettre à jour

- **Pas de nouveau test** requis (les caract gated existants couvrent la régression observable)
- **Tests à exécuter** :
  ```powershell
  SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts
  SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/process-step1/__tests__/
  # Si chantier 01 (I6) fait : SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/complete/__tests__/
  ```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : ~99.999 stable (consolidation cleanup, pas de saut métier)
  - **§6 Logs** : section "Migration progressive" — passer "~176 `console.*` restants" → "0 `console.*` restant ; chantier console.log cleanup officiellement clos"
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint Cleanup-I8 / Lot 6** (...) : sweep final + activation globale `no-console: 'error'`. ...`. Retirer l'entrée `⏭️ Chantier console.log cleanup — Lots 2 / 6` du backlog.

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
pnpm verify
git status -s
# Confirmer chantier 01 (I6) déjà mergé sur cleanup
git log --oneline -5  # devrait montrer les commits de chantier 01

# 2. Phase 1 audit triage
# Pour chaque fichier (balance, auto-balance, complete-persist.ts) :
# Grep "console\." <file> -n  # liste tous les sites avec line numbers
# Read file (lignes pertinentes) pour identifier cleanup-attempts CRITIQUES + DB error discriminants + flow logs
# Documenter le triage dans un draft markdown (ou directement le commit message)

# 3. Migration commit-par-fichier (3-4 commits)
# Commit 1 : balance/route.ts (62 sites → ~50 DROP / ~12 KEEP triage strict)
# Edit app/api/monthly-recap/balance/route.ts
pnpm typecheck && pnpm lint:check && pnpm format:check
git add app/api/monthly-recap/balance/route.ts && git commit -m "refactor(monthly-recap): triage console.* sur balance (Lot 6)"

# Commit 2 : auto-balance/route.ts (53 sites → ~43 DROP / ~10 KEEP triage strict)
# Si chantier 13 (auto-balance reversed RPC fix) fait, ce fichier a probablement déjà été touché — coordonner
# Edit + verify + commit

# Commit 3 : complete-persist.ts (post-I6 migration ~10-15 sites résiduels)
# Edit + verify + commit

# 4. Commit ESLint glob extension
# Edit eslint.config.mjs : ajouter complete + balance + auto-balance à la brace expansion
# Sanity test injection
echo "console.log('SANITY-LOT6')" >> app/api/monthly-recap/balance/route.ts
pnpm lint:check  # doit exit 1
git checkout app/api/monthly-recap/balance/route.ts
pnpm lint:check  # doit exit 0
git add eslint.config.mjs && git commit -m "chore(eslint): escalate no-console:error on balance + auto-balance + complete (Lot 6)"

# 5. Commit activation globale
# Edit eslint.config.mjs : changer 'no-console': ['warn', ...] → ['error', ...] dans le bloc principal
# Sanity test injection sur un fichier hors scope per-file (e.g. middleware.ts est déjà error, choisir un fichier sans glob — typically app/layout.tsx ou un nouveau fichier de test)
pnpm lint:check  # confirmer baseline ≤ 50
git add eslint.config.mjs && git commit -m "chore(eslint): activate global no-console:error (Lot 6 sweep final)"

# 6. Validation totale
pnpm verify
SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts

# 7. Closeout
# Edit CLAUDE.md §1 + §6 + §11
git add CLAUDE.md && git commit -m "docs: closeout CLAUDE.md for Sprint Cleanup-I8 / Lot 6"

# 8. Smoke browser
pnpm dev
# Flow /monthly-recap balance/auto-balance/complete sur compte test
```

## Pièges connus / points d'attention

- **Bloqueur chantier 01 (I6)** : si I6 pas fait, les 65 sites de `complete/route.ts` brut → migration totale (rule strict 80/20 → ~52 DROP / ~13 KEEP) qui sera **refait/jeté** après I6 extraction. Gaspillage. **Faire I6 d'abord OBLIGATOIREMENT.**
- **Couplage chantier 13** : si chantier 13 fait avant, auto-balance/route.ts a déjà été touché et certains sites peuvent avoir disparu. Coordonner — soit faire 13 d'abord puis 06 sur le restant, soit bundle 13 + 06 dans le même sprint (pattern Lot 4b/4d où 1 sprint touche plusieurs fichiers).
- **Identification cleanup-attempts CRITIQUES** : balance + auto-balance ont probablement des inner-try de rollback similaires à savings/transfer (Lot 4d). Audit Phase 1 cruciale — grep `rollback` et `compensating` pour identifier.
- **`logger.warn` vs `logger.error` pour les fail-soft** : règle Lot 4-5 — si la branche RETURNS 200 ou 5xx selon le contexte :
  - 5xx propagé → `logger.error` (la trace + le message complet sont utiles devant un incident)
  - 200/fallback silencieux → `logger.warn` (l'erreur n'a pas planté la requête mais elle mérite trace si récurrente)
- **PII dans les logs** : si `complete/route.ts` log `profile.first_name` ou `salary` ou `monthly_budget_estimate`, **DROP** (PII surface). Pattern miroir Lot 4c (profile route).
- **Activation globale `no-console: 'error'`** : peut surfacer 2-5 sites résiduels qui ont passé sous le radar (e.g. dans des fichiers `lib/*.ts` jamais touchés par les Lots précédents). Migrer ces stragglers dans le même sprint ou dans un Lot 6 follow-up.
- **Tests fichiers** : `vitest.setup.ts` + `*.test.tsx` peuvent contenir `console.log` debug — vérifier que l'allow-list ESLint exclut `**/*.test.{ts,tsx}` et `vitest.setup.ts`. Sinon ajouter une exception per-file.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure des commits Lot 6.

## Découpage en sous-tâches (M → 4-5 commits)

1. **Sub-1 (Effort : XS)** — Confirmer chantier 01 (I6) mergé. Audit Phase 1 sur balance + auto-balance + complete-persist.ts. Documenter triage dans draft.
2. **Sub-2 (Effort : S)** — Migration `balance/route.ts`. Commit `refactor(monthly-recap): triage console.* sur balance (Lot 6)`.
3. **Sub-3 (Effort : S)** — Migration `auto-balance/route.ts`. Commit `refactor(monthly-recap): triage console.* sur auto-balance (Lot 6)`.
4. **Sub-4 (Effort : XS)** — Migration `complete-persist.ts` résiduel (post-I6). Commit `refactor(recap): triage console.* sur complete-persist (Lot 6)`.
5. **Sub-5 (Effort : XS)** — ESLint glob extension + activation globale. Commit `chore(eslint): activate global no-console:error (Lot 6 sweep final)`.
6. **Sub-6 (Effort : XS)** — Closeout doc CLAUDE.md.

## Recovery path

- `git revert <sha>` chacun des commits — pas de migration DB, pas d'effet persistant
- Recovery trivial — les console.log strippés en prod par SWC, donc même un revert partiel n'introduit pas de bug runtime

## Précédents codebase (références)

- **Lots 1-5d** (CLAUDE.md §11 entrées Sprint Cleanup-I8 / Lot 1-5d) — pattern complet, à reprendre intégralement
- **Sprint Refactor-I5** (CLAUDE.md §11) — fermeture de `process-step1` (120 sites) post-extraction god route, pattern miroir pour les 3 routes restantes

---

**Estimation totale** : demi-journée (4-6h post-I6). Ferme le chantier console.log cleanup officiellement (Lot 1-6 tous livrés). Score métier inchangé (~99.999 stable). Bénéfice : (a) baseline lint nettoyée à ≤50 (vs 183), (b) `no-console: 'error'` global = filet permanent, (c) closure d'un chantier multi-sprint qui durait depuis Sprint Cleanup-I8 / Lot 1.
