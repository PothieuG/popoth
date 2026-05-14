# 01 — Chantier I6 : Extract logique métier de `monthly-recap/complete`

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | [CLAUDE.md §11](../CLAUDE.md) entrée `⏭️ Chantier I6` + `app/api/monthly-recap/complete/route.ts:1-100` (godfile confirmé Phase 1) |
| **Type** | refactor |
| **Priorité** | Haute |
| **Effort estimé** | XL (1-2 jours) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune (pré-requis : chantier 16 hygiène git pour propreté commits) |
| **Bloque** | 06 (Lot 6 console-cleanup), 13 (auto-balance reversed RPC fix), 19 (withCompensatingRollback abstraction) |

## Contexte

Le god file `app/api/monthly-recap/complete/route.ts` (~730 LOC + 4 globals carryover déclarés via `declare global`) est le dernier god route de la couche `app/api/monthly-recap/` après Sprint Refactor-I5 (process-step1 réduit à 45 LOC thin handler).

CLAUDE.md §11 :

> ⏭️ **Chantier I6** : extraction logique métier de `app/api/monthly-recap/complete/route.ts` (~730 LOC + 4 globals carryover)

État des lieux factuel (audit Phase 1) :
- **730 LOC** dans 1 seul fichier
- **65 console.log** restants (top 1 du repo post-Lot 4-5, devant balance 62 et auto-balance 53)
- **4 globals partagés** déclarés `declare global` au top : `carryoverUpdates`, `preTransferBudgetDeficit`, `postTransferBudgetDeficit`, `exceptionalExpenseToInsert`
- **Wrapper** : déjà `withAuthAndProfile` (Sprint Refactor-Architecture-v4)
- **Validation** : déjà `parseBody(request, completeBodySchema)` avec `discriminatedUnion` nested (Sprint Zod-Rollout-Money-First commit 9)
- **Sub-fonctions identifiées** : 3 sub-RPCs Postgres (snapshot deactivation, monthly_recap insert, reset estimated incomes) + plusieurs branches métier (carry_forward vs deduct_from_budget) + cleanup-attempts inner-try (deficitError, ravDifferenceError, savingsError, transactionError) tous préservés verbatim Sprint Zod-Rollout-Money-First
- **Tests** : 0 caractérisation gated, 0 mocked direct sur ce route (à créer en pré-extraction obligatoire — pattern Sprint I5)
- **Précédents codebase** : Sprint Refactor-I4 (split `lib/financial-calculations.ts` 1069 LOC en 8 modules) + Sprint Refactor-I5 (split `process-step1/route.ts` 740 LOC en `lib/recap/{types,step1-algorithm,step1-persist,index}.ts` + thin handler 45 LOC)

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller ce prompt dans une nouvelle session Claude Code à la racine du repo `C:\DataGillesPothieu\Personal\Popoth_App_Claude`.

### 1. Objectif

Splitter `app/api/monthly-recap/complete/route.ts` (730 LOC + 4 globals) en `lib/recap/complete-{algorithm,persist}.ts` (pure + I/O) + thin handler ≤60 LOC, **sans changement de comportement observable** (response shape byte-identique + side effects DB byte-identique), avec couverture caractérisation gated + tests mocked non-gated avant le refactor.

### 2. Contexte technique

**Fichiers concernés** (refactor):
- `app/api/monthly-recap/complete/route.ts:1-730` (à réduire à ≤60 LOC thin handler)
- **Nouveaux fichiers à créer** :
  - `lib/recap/complete-algorithm.ts` (pure : take snapshot + decisions → return Decision)
  - `lib/recap/complete-persist.ts` (I/O : `processComplete(input) = loadCompleteSnapshot → decideCompleteAllocation → applyCompleteDecision`)
  - `lib/recap/complete-types.ts` (interfaces ProcessCompleteInput, Snapshot, Decision, Output, AllocationOperation discriminated union)
  - `lib/recap/__tests__/complete-algorithm.test.ts` (cas pure-unit non-gated)
  - `lib/recap/__tests__/complete-persist.test.ts` (cas mocked non-gated)
  - `app/api/monthly-recap/complete/__tests__/route.integration.test.ts` (cas caractérisation gated `SUPABASE_RECAP_TESTS=1`)
- **Fichiers à mettre à jour (barrel)** :
  - `lib/recap/index.ts` ajouter `export { processComplete } from './complete-persist'` + types

**État actuel** :
- 730 LOC, 65 console.log, 4 globals (`carryoverUpdates`, `preTransferBudgetDeficit`, `postTransferBudgetDeficit`, `exceptionalExpenseToInsert`)
- Body validé via `completeBodySchema` (discriminatedUnion sur `remaining_to_live_choice.action`)
- Wrapper `withAuthAndProfile` en place
- 3 sub-flows DB séquentiels : snapshot deactivation → reset estimated incomes → monthly_recap insert (avec carryover, exceptional expense, savings transfer si applicable)
- 4 inner-try cleanup-attempts CRITIQUES préservés verbatim Sprint Zod-Rollout-Money-First — **garder intacts** (pattern miroir Lot 4d L122/L321/L337)

**Tests existants pertinents** :
- `lib/recap/__tests__/step1-algorithm.test.ts` (28 cas pure-unit, **pattern miroir à reprendre intégralement**)
- `lib/recap/__tests__/step1-persist.test.ts` (8 cas mocked, **pattern miroir** : vi.mock `supabaseServer` + `lib/finance/{financial-data,budget-transfers,budget-savings,piggy-bank}` + dispatch via dynamic import)
- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` (6 cas gated `SUPABASE_RECAP_TESTS=1`, **pattern miroir** pour caract pré-extraction)

**Migrations DB pertinentes** :
- `supabase/migrations/20260506000000_create_finance_rpcs.sql` (4 RPC C3 + `update_budget_cumulated_savings` utilisé par carryover persistence)
- `supabase/migrations/20260516000000_create_transfer_with_savings_debit_rpc.sql` (RPC composite à utiliser si carryover step déclenche INSERT budget_transfers + debit, mirror étape 2.4.2 du process-step1)
- `supabase/migrations/20260517000000_create_add_expense_with_breakdown_rpc.sql` (RPC `add_expense_with_breakdown` à utiliser si `exceptionalExpenseToInsert` global déclenche un INSERT smart-allocation)
- `supabase/migrations/20260518000000_create_savings_transfer_rpcs.sql` (2 RPC composites — `transfer_savings_between_budgets` et `transfer_budget_to_piggy_bank` — à utiliser si carryover step déclenche transfer)

**Précédents codebase à reprendre** :
- **Sprint Refactor-I5** (CLAUDE.md §11 entrée Sprint Refactor-I5) — pattern le plus proche, 9 commits sur `cleanup` (`ae9ac4c → 5f64cbd` + closeout)
- **Sprint Refactor-I5-followup** (CLAUDE.md §11) — drop dead code + caract test path RPC + JSDoc concurrent-invocation
- **Sprint Refactor-I5-followup-v2** (CLAUDE.md §11) — Axe 1 atomicité (composite RPC `transfer_with_savings_debit`) + Axe 2 tests mocked applyDecision
- **Sprint Refactor-I4** (CLAUDE.md §11 entrée Sprint Refactor-I4) — split god file `lib/financial-calculations.ts` 1069 LOC en 8 modules (10 commits)

### 3. Spécifications fonctionnelles attendues

**Cas nominal — `action: 'carry_forward'`** :
- L'utilisateur clôture le récap mensuel avec un RAV final positif → ce RAV est reporté en `bank_balances.current_remaining_to_live` (snapshot save)
- Réinitialisation des `estimated_incomes` à 0 + des `monthly_surplus_deficit` des budgets
- Insertion d'une row `monthly_recaps` avec `final_remaining_to_live = body.remaining_to_live_choice.final_amount`
- Désactivation du snapshot recovery actif
- Si `carryoverUpdates` non-vide (renseigné par étape précédente process-step1 ou auto-balance) : appliquer chaque carryover via `transferSavingsBetweenBudgets` ou `transferBudgetToPiggyBank` (composite RPC, pas SELECT-then-UPDATE)
- Réponse 200 `{ data: { recap_id, final_remaining_to_live, carryover_applied: number, ... } }`

**Cas nominal — `action: 'deduct_from_budget'`** :
- Idem carry_forward MAIS le RAV final est déduit d'un budget choisi (`budget_id` requis dans le body via discriminatedUnion)
- INSERT ou UPDATE `real_expenses` avec `amount = (initial RAV - final_amount)` et `estimated_budget_id = body.remaining_to_live_choice.budget_id` via RPC `add_expense_with_breakdown` (atomique)
- Si le budget choisi a des économies cumulées suffisantes pour absorber : utiliser composite RPC qui debit savings + INSERT real_expenses en 1 tx
- Sinon : INSERT direct sur `real_expenses` avec `amount_from_budget = montant`

**Cas edge** :
- `context === 'group' && !profile.group_id` → 400 (déjà géré L57)
- `final_amount > initialRemainingToLive` → erreur métier (à valider dans le schema ou handler — vérifier code actuel)
- `carryoverUpdates` undefined → no-op (pas d'INSERT budget_transfers)
- `exceptionalExpenseToInsert` undefined → no-op
- 2 invocations concurrentes (race) → idempotency non garantie (cf. JSDoc step1-persist.ts pour le pattern documented-only — ne pas implémenter dans I6, déféré chantier 17 DORMANT)

**Cas erreur** :
- DB error sur snapshot deactivation → fail-soft + `logger.warn` + continue (la complétion du récap est plus critique que le snapshot cleanup)
- DB error sur monthly_recap INSERT → 500 + propagation `error.message`
- DB error sur reset estimated incomes → fail-soft + `logger.warn` + continue (recoverable au prochain récap)

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 et §8 strictement
  - Aucun `console.log` dans `lib/recap/complete-*.ts` ou dans le thin handler — utiliser `logger.{warn,error,info,debug}`
  - Imports `import type { ... }` obligatoires (`verbatimModuleSyntax`)
  - Aucun `: any` ; pour les payloads Supabase utiliser `Database['public']['Tables']['monthly_recaps']['Insert']` etc.
  - **Counter `as unknown as SupabaseClient` doit rester à 0** (vérifier post-refactor)
- **Atomicité** : si une séquence debit + INSERT existe (cas `exceptionalExpenseToInsert` ou carryover), utiliser obligatoirement la composite RPC correspondante (`add_expense_with_breakdown` / `transfer_savings_between_budgets` / `transfer_budget_to_piggy_bank`). **Pas de SELECT-then-UPDATE direct sur `piggy_bank.amount` / `bank_balances.balance` / `estimated_budgets.cumulated_savings`** (CLAUDE.md §8 ❌).
- **Préservation des 4 cleanup-attempts CRITIQUES inner-try** : deficitError, ravDifferenceError, savingsError, transactionError ne doivent PAS être supprimés. Ils sont préservés verbatim Sprint Zod-Rollout-Money-First — pinner par tests.
- **Globals partagés** : décider :
  - **Option A** (recommandée) — éliminer les 4 globals en les passant explicitement comme `ProcessCompleteInput.carryoverContext: { carryoverUpdates?: [...], preTransferBudgetDeficit?: number, ... }`. Ces globals sont set par d'autres routes (process-step1, auto-balance, balance) — vérifier les call sites avant de migrer.
  - **Option B** — préserver les globals pour minimiser le risque, juste extraire le corps métier
  - À arbitrer en Phase 1 du chantier après audit cross-codebase des call sites des 4 globals
- **Wrapper auth** : préserver `withAuthAndProfile` (CLAUDE.md §6)
- **Validation body** : préserver `parseBody(request, completeBodySchema)` + `handleBadRequest(error)` au top du catch
- **Convention nommage** : DB snake_case ↔ TS camelCase (CLAUDE.md §6)
- **Commit pattern** : un commit par étape (cf. découpage sous-tâches ci-dessous), conventional commits, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

### 5. Critères d'acceptation vérifiables

- [ ] **Volume** : `Bash 'wc -l app/api/monthly-recap/complete/route.ts'` retourne ≤ 60 LOC
- [ ] **Console clean** : `Grep "console\." app/api/monthly-recap/complete/route.ts` retourne 0 hit (lint baseline diminue de ~50-65 warnings)
- [ ] **Console clean lib** : `Grep "console\." lib/recap/complete-` retourne 0 hit
- [ ] **ESLint glob** : `eslint.config.mjs` bloc per-file `no-console: 'error'` étendu à `app/api/monthly-recap/complete/**` + `lib/recap/complete-*.ts`
- [ ] **Counter `as unknown as SupabaseClient`** : reste à 0 (`Grep "as unknown as SupabaseClient"` 0 hit)
- [ ] **Counter `: any`** : pas de nouveau site applicatif (10 sites pre-existing tous justifiés)
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline warnings inférieure à 130 (vs 183 actuel = -50 minimum)
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests non-gated** : `pnpm test:run` 113 → ~150+ passed (ajout : ~25 cas pure-unit + ~10 cas mocked)
- [ ] **tests gated caractérisation** : `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/complete/__tests__/` 5+ cas passants byte-identique pré/post refactor
- [ ] **build** : `pnpm build` exit 0, 55/55 routes
- [ ] **verify** : `pnpm verify` exit 0 (8 stages incluant 6 db:* checks)
- [ ] **Smoke browser** : flow complet `/monthly-recap` CAS 1 (carry_forward) + CAS 2 (deduct_from_budget) sur compte test, response shape byte-identique pré/post refactor (vérifié via DevTools network)

### 6. Tests à écrire ou à mettre à jour

#### Pure-unit non-gated — `lib/recap/__tests__/complete-algorithm.test.ts` (~25 cas, mirror step1-algorithm.test.ts)

```typescript
// Pattern miroir step1-algorithm.test.ts
describe('decideCompleteAllocation', () => {
  describe('action: carry_forward', () => {
    it('CAS 1.1: positive RAV → operations include carryover save', () => {...})
    it('CAS 1.2: zero RAV → operations include reset only', () => {...})
    it('CAS 1.3: negative RAV → throws (validation invariant)', () => {...})
  })
  describe('action: deduct_from_budget', () => {
    it('CAS 2.1: budget has savings ≥ deduction → use composite RPC path', () => {...})
    it('CAS 2.2: budget has savings < deduction → use direct INSERT path', () => {...})
    it('CAS 2.3: budget_id missing → throws (discriminatedUnion invariant)', () => {...})
  })
  describe('carryover context', () => {
    it('CAS 3.1: carryoverUpdates undefined → no transfer ops', () => {...})
    it('CAS 3.2: carryoverUpdates with 3 entries → 3 transfer ops in order', () => {...})
    it('CAS 3.3: exceptionalExpenseToInsert defined → ops include exceptional INSERT', () => {...})
  })
  describe('determinism', () => {
    it('same input twice → identical Decision (sort by id stability)', () => {...})
    it('reordered carryoverUpdates → ops follow input order (preserves caller intent)', () => {...})
  })
  describe('edge cases', () => {
    it('empty estimated_incomes → reset op no-op', () => {...})
    it('zero budget transfers → operations_performed empty', () => {...})
  })
})
```

#### Mocked non-gated — `lib/recap/__tests__/complete-persist.test.ts` (~10 cas, mirror step1-persist.test.ts)

```typescript
// Pattern miroir step1-persist.test.ts (Sprint Refactor-I5-followup-v2 commit bc1d67b)
describe('applyCompleteDecision', () => {
  it('CAS 1 carry_forward happy path: snapshot deactivate + reset incomes + monthly_recap INSERT', () => {...})
  it('CAS 2 deduct_from_budget happy path: + addExpenseWithBreakdown called 1x', () => {...})
  it('CAS 3 carryover ops: transferSavingsBetweenBudgets called Nx in order', () => {...})
  it('CAS 4 fail-soft snapshot deactivate: logger.warn fired + flow continues', () => {...})
  it('CAS 5 fail-soft reset incomes: logger.warn fired + monthly_recap INSERT still happens', () => {...})
  it('CAS 6 throw on monthly_recap INSERT: propagates as 500', () => {...})
  it('CAS 7 cleanup-attempt deficitError fires when deficit calc inconsistent', () => {...})
  it('CAS 8 cleanup-attempt savingsError fires when savings transfer fails mid-flight', () => {...})
})
```

#### Caractérisation gated — `app/api/monthly-recap/complete/__tests__/route.integration.test.ts` (~5 cas, mirror process-step1/__tests__/route.integration.test.ts)

```typescript
// Pattern miroir process-step1 caract (Sprint Refactor-I5 commit a2156c9)
// Pré-requis : SUPABASE_RECAP_TESTS=1
// Run AVANT le refactor pour pinner le comportement actuel byte-identique
describe('POST /api/monthly-recap/complete (caracterization)', () => {
  it('CAS 1 carry_forward profile: response shape + monthly_recaps row + reset incomes', () => {...})
  it('CAS 2 deduct_from_budget profile: response shape + real_expenses row + budget débité', () => {...})
  it('CAS 3 group context: response shape + propage sur tous les members', () => {...})
  it('400 invalid body (deduct sans budget_id)', () => {...})
  it('401 no session cookie', () => {...})
})
```

#### Tests à mettre à jour (post-refactor)
- Si la regen `lib/database.types.ts` change quelque chose : `pnpm db:check-types-fresh` exit 0
- Aucun test pre-existing ne devrait casser (le refactor est byte-identique côté response/DB)

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : passer de ~99.999/100 → ~99.999/100 stable + ajouter entrée détaillée du Sprint Refactor-I6 dans le paragraphe (conserver le pattern installé, le score ne bouge pas car pure consolidation interne)
  - **§4 Structure du repo** : ajouter sous `lib/recap/` les nouveaux fichiers (`complete-types.ts`, `complete-algorithm.ts`, `complete-persist.ts`)
  - **§5 Architecture critique** : entrée "Workflow recap mensuel" mise à jour — la route `complete` devient un thin handler, la logique vit dans `lib/recap/`
  - **§6 Conventions** : pas de changement (les patterns sont déjà documentés)
  - **§8 ❌** : ajouter "Ne pas réintroduire de logique métier dans `app/api/monthly-recap/complete/route.ts`. Depuis Sprint Refactor-I6, l'algorithme est dans `lib/recap/complete-algorithm.ts` (pure) et la persistance dans `lib/recap/complete-persist.ts` (RPC atomiques)."
  - **§9 Tests** : ajouter les 3 nouveaux fichiers de test à la liste
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint Refactor-I6** ([prompt source si capturé], plan dans ...) : ...` suivant le pattern Sprint Refactor-I5 (commit-by-commit narrative + verif end-to-end + smoke deferred + lessons learned)

- **next-steps.md** : pas concerné (chantier dette technique, pas backlog produit)

- **Aucun ADR à créer** (CLAUDE.md system prompt "no .md docs without explicit ask" + précédent C4 closeout)

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight (avant de commencer)
pnpm verify  # baseline confirmée
git status -s  # noter les pre-existing dirty (chantier 16 si pas encore traité)

# 2. Caractérisation pré-refactor (CRUCIAL — pinner le comportement actuel)
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/complete/__tests__/route.integration.test.ts
# Attendu : 5+ cas passent byte-identique sur la version actuelle

# 3. Pendant chaque commit du refactor (boucle)
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run

# 4. Post-refactor (validation totale)
pnpm verify  # 8 stages
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/complete/__tests__/  # 5+ caract toujours verts
SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/  # gated atomicité non touchés
pnpm build  # 55/55 routes

# 5. Negative greps
# Grep "console\." app/api/monthly-recap/complete/route.ts  # 0 hit
# Grep "console\." lib/recap/complete-  # 0 hit
# Grep "as unknown as SupabaseClient"  # 0 hit (counter clean)
# Grep "declare global" app/api/monthly-recap/complete/route.ts  # 0 hit (Option A) ou inchangé (Option B)

# 6. Smoke browser (CRUCIAL — pas de mocked-only ici)
pnpm dev
# Flow CAS 1 carry_forward : créer un récap test avec RAV positif → cliquer "Reporter" → vérifier
# DB row monthly_recaps + bank_balances.current_remaining_to_live updaté + estimated_incomes reset à 0
# Flow CAS 2 deduct_from_budget : idem mais cliquer "Déduire d'un budget" + choisir budget → vérifier
# real_expenses row + budget cumulated_savings débité (si applicable)
```

## Pièges connus / points d'attention

- **Globals partagés** : les 4 globals (`carryoverUpdates`, `preTransferBudgetDeficit`, `postTransferBudgetDeficit`, `exceptionalExpenseToInsert`) sont set par d'autres routes (process-step1, auto-balance, balance). **Avant de les éliminer**, faire un grep cross-codebase :
  ```powershell
  # Grep "global\.carryoverUpdates" app/api/  # call sites du SET
  # Grep "global\.exceptionalExpenseToInsert" app/api/
  ```
  Si Option A choisie (élimination), il faut aussi modifier les routes qui SET ces globals pour les passer en paramètre du fetch vers `complete`.
- **4 cleanup-attempts inner-try** : deficitError / ravDifferenceError / savingsError / transactionError sont **CRITIQUES**. Le test mocked CAS 7+8 doit pinner explicitement leur fire (`expect(logger.error).toHaveBeenCalled()` + assertion sur le message verbatim).
- **Concurrent invocation** : la route n'est pas idempotente (cf. CLAUDE.md §8 ❌ et JSDoc step1-persist.ts). Ne **PAS** introduire un retry automatique côté handler post-refactor. Si l'utilisateur double-click le bouton "Valider", `isSubmitting` côté frontend gate. Implémentation idempotency key déférée chantier 17 DORMANT.
- **`save_remaining_to_live_snapshot` fail-soft** : la route appelle `saveRavToDatabase` (rav-persistence.ts) ou similaire — vérifier que le contrat `Promise<boolean>` (R1, Sprint Refactor-I4) est préservé.
- **`monthly_recaps.session_id` format** : 5-part `{ctx}_{id}_{month}_{year}_{ts}` validé par `completeBodySchema`. Préserver dans le INSERT.
- **Pre-existing dirty working tree** : si chantier 16 (hygiène git) pas encore traité, `git status` montrera 25 fichiers M+D+28 untracked. **Ne pas inclure dans les commits du chantier I6** — utiliser `git add` ciblé par fichier.
- **Couplage 13 (auto-balance)** : si vous trouvez un pattern reversed RPC→INSERT dans `complete/route.ts` (différent de la version `process-step1` qui est INSERT→RPC corrigée v2), c'est un bug latent — le fixer dans le même chantier ou tagger pour chantier 13. Cohérent avec le scope I6.

## Découpage en sous-tâches (XL → 8 commits)

1. **Sub-1 (Effort : S)** — Caractérisation pré-refactor : créer `route.integration.test.ts` avec 5 cas gated `SUPABASE_RECAP_TESTS=1`. Run-Verify byte-identique sur le code actuel. Commit `test(recap): characterization tests on monthly-recap/complete`.
2. **Sub-2 (Effort : S)** — Audit globals : grep cross-codebase des 4 globals, décider Option A ou B. Documenter dans le commit message.
3. **Sub-3 (Effort : S)** — Define types : créer `lib/recap/complete-types.ts` (ProcessCompleteInput, Snapshot, Decision, Output, AllocationOperation discriminated union). Aucun runtime, juste types. Commit `feat(recap): define complete types`.
4. **Sub-4 (Effort : M)** — Extract pure algorithm : créer `lib/recap/complete-algorithm.ts` avec `decideCompleteAllocation(snapshot)`. Pure (0 I/O, 0 console, immutable). Commit `refactor(recap): extract pure complete algorithm`.
5. **Sub-5 (Effort : S)** — Pure-unit tests : créer `complete-algorithm.test.ts` 25 cas non-gated. Commit `test(recap): comprehensive unit tests for decideCompleteAllocation`.
6. **Sub-6 (Effort : L)** — Extract persistence : créer `lib/recap/complete-persist.ts` avec `processComplete(input) = loadCompleteSnapshot → decideCompleteAllocation → applyCompleteDecision`. Préserver les 4 cleanup-attempts. Drop ~50 console.log + migrate ~15 vers logger. Commit `refactor(recap): extract complete persistence + drop flow logs (I6 + Lot 6 partial)`.
7. **Sub-7 (Effort : S)** — Mocked tests applyCompleteDecision : créer `complete-persist.test.ts` 10 cas non-gated. Commit `test(recap): mocked unit tests for applyCompleteDecision`.
8. **Sub-8 (Effort : S)** — Rewire route : réécrire `app/api/monthly-recap/complete/route.ts` en thin handler ≤60 LOC qui delegate à `processComplete()`. Re-run caract tests byte-identique. Update `lib/recap/index.ts` barrel. ESLint glob escalation. Commit `refactor(recap): rewire complete route to thin handler (730 → ≤60 LOC)`.

**Bonus closeout** : 1 commit additionnel `docs: closeout CLAUDE.md §1/§4/§5/§8/§11 for Sprint Refactor-I6` (pattern Sprint Refactor-I5 closeout).

## Recovery path (si refactor risqué)

- **Annuler 1 commit** : `git revert <sha>` puis re-appliquer manuellement les morceaux qui marchent
- **Annuler tout le sprint** : `git reset --hard <sha-pre-sprint>` (DESTRUCTIF — confirmer avec user d'abord ; alternative : créer une branche `sprint-i6-rollback`)
- **Restaurer le route monolithique** : `git checkout <sha-pre-sprint> -- app/api/monthly-recap/complete/route.ts`
- **Aucune migration DB** dans ce chantier → pas de SQL recovery requis
- **Caractérisation gated** sert de safety net : si elle reste verte byte-identique post-refactor, le risque de régression observable est minimal

## Précédents codebase (références)

- **Sprint Refactor-I5** (CLAUDE.md §11) — pattern le plus proche, étudier les 9 commits sur `cleanup` (`ae9ac4c → 5f64cbd`) et `prompt/prompt-07-deep-dive-recap-algorithm.md` (prompt source). 740 LOC → 45 LOC + 4 modules sous `lib/recap/` + 33 cas pure-unit.
- **Sprint Refactor-I5-followup** (CLAUDE.md §11) — drop dead code + caract test path RPC + JSDoc concurrent-invocation. Cf. `prompt/prompt-07-deep-dive-recap-algorithm-v2.md`.
- **Sprint Refactor-I5-followup-v2** (CLAUDE.md §11) — composite RPC `transfer_with_savings_debit` + 8 cas mocked applyDecision. Cf. `prompt/prompt-07-deep-dive-recap-algorithm-v3.md` + commits `93f46c4 → bc1d67b`.
- **Sprint Refactor-I4** (CLAUDE.md §11) — split `lib/financial-calculations.ts` 1069 LOC en 8 modules `lib/finance/`. 10 commits sur `cleanup`. Pattern testabilité (Object.freeze EMPTY_FINANCIAL_DATA, fail-soft contracts R1+R2 préservés verbatim).
- **Sprint Atomicity-Expenses** (CLAUDE.md §11) — pattern composite RPC `add_expense_with_breakdown` à reprendre si exceptional expense path détecté dans complete.
- **Sprint Atomicity-Savings** (CLAUDE.md §11) — pattern composite RPC `transfer_savings_between_budgets` + `transfer_budget_to_piggy_bank` à reprendre si carryover path détecté.

---

**Estimation totale Sprint I6** : 1-2 jours de travail concentré (1 dev + caract gated). Le score métier ne bouge pas (~99.999/100 stable) car pure consolidation interne — le bénéfice est : (a) débloquer chantier 06 (Lot 6 console-cleanup), (b) débloquer chantier 13 (auto-balance reversed RPC fix), (c) préparer chantier 19 (withCompensatingRollback abstraction si ≥5 sites compensating-rollback post-I6), (d) cohérence architecture avec Sprints I4 et I5 (god files éliminés).
