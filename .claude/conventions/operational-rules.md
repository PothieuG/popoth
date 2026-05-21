# Règles opérationnelles — précédents, exemples, cleanup-attempts CRITIQUES

> Extraction détaillée de CLAUDE.md §8 (justifications longues, exemples, précédents).

## 1. Pattern Path B closed-by-deletion (8+ cas)

Pour tout candidat de cleanup ou de refactor non-trivial, vérifier d'abord les consumers cross-codebase. Si **0 consumer applicatif** : préférer **Path B DELETE** (CLAUDE.md system prompt "Don't design for hypothetical future requirements") plutôt que Path A refactor.

**Précédents** :

1. **Sprint Lot 5b** (2026-05-10) — `app/api/monthly-recap/status-test/route.ts` deleted (0 consumer, mock data hardcodé).
2. **Sprint Lot 5c** (2026-05-10) — `testSupabaseConnection()` deleted dans `lib/supabase-client.ts` (0 callsite cross-codebase, 17 LOC).
3. **Sprint Atomicity-Savings v2** (2026-05-12) — `handlePiggyBankAction` deleted dans `app/api/savings/transfer/route.ts` (89 LOC, 3 action types `set_piggy_bank`/`add_to_piggy_bank`/`remove_from_piggy_bank` confirmed dead code).
4. **Sprint Dead-Code-Purge** (2026-05-13) — 3 deletions bundled :
   - `lib/auth.ts::resetPassword + updatePassword` (−42 LOC, les pages forgot/reset utilisent `supabase.auth.*` direct).
   - `app/api/debug/{remaining-to-live,financial,group-financial}/route.ts` (−504 LOC, 0 consumer cross-codebase, toutes gated `blockInProduction()` 404 prod).
   - `lib/contribution-calculator.ts::calculateMinimumSalary + calculateMaximumGroupBudget` (−17 LOC, 0 consumer).
5. **Sprint UserGroupsList-Cleanup** (2026-05-14) — `components/groups/UserGroupsList.tsx` deleted (157 LOC, 0 consumer applicatif, app/settings/page.tsx rend déjà inline la même UI sur `currentGroup` singular).
6. **Sprint Audit-Closeout I3** (2026-05-13) — `lib/monthly-recap-calculations.ts` deleted (399 LOC, 8 exports tous orphelins).
7. **Sprint Zod-Rollout v8** (2026-05-14) — `components/groups/GroupMembersModal.tsx` deleted (175 LOC, 0 consumer).
8. **Sprint Refactor-Settings-Drawer** (2026-05-18) — `app/settings/page.tsx` deleted (~457 LOC, 0 consumer applicatif hors `dashboard` + `group-dashboard` qui basculent vers `<SettingsDrawer>` swap-horizontal in-place). Le bug intermittent "1 fois sur 2 retour au dashboard" est éliminé mécaniquement (plus de `window.location.href` ni `window.history.back()` fragile sur PWA + middleware `checkRecapStatus`). `/settings` retiré de `protectedRoutes` middleware.ts. Le contenu de la page est extrait dans `components/settings/GroupManagementPanel.tsx` (verbatim sauf : loading overlay full-screen remplacé par snackbar non-bloquante z-[60] + skeleton léger). Aucun deep-link applicatif (PWA install / push notif) à `/settings`.

**Pattern** : (a) `Grep "<exportName>" --glob '**/*.{ts,tsx}'` cross-codebase ; (b) `Grep` dans `app/`, `components/`, `hooks/`, `contexts/`, `lib/`, `proxy.ts`, `__tests__/` (scope MUST inclure tous pour éviter de manquer un consumer — leçon Sprint Lot 5c qui scope-bound à `app/` only et a manqué `contexts/AuthContext.tsx:14` register callback consommant `signUp`).

## 2. God-files monthly-recap stateful — 4/4 extraits

Pattern d'extraction `route.ts → lib/recap/{types,algorithm,persist}.ts + thin handler + N caract gated + M algorithm tests + K mocked tests` standardisé sur 4 routes :

| Route                    | Sprint                             | Pre LOC         | Post LOC                        | Tests ajoutés                        |
| ------------------------ | ---------------------------------- | --------------- | ------------------------------- | ------------------------------------ |
| `process-step1/route.ts` | Refactor-I5 (2026-05-11)           | 740             | 45                              | 33 algo + 8 mocked + 6 caract gated  |
| `complete/route.ts`      | Refactor-I6 (2026-05-14)           | 703 + 4 globals | 59                              | 32 algo + 18 mocked + 5 caract gated |
| `auto-balance/route.ts`  | Refactor-Auto-Balance (2026-05-16) | 533             | 56                              | 37 algo + 17 mocked + 5 caract gated |
| `recover/route.ts`       | Refactor-Recover (2026-05-16)      | 385             | 168 (POST 80 + GET 76 verbatim) | 21 algo + 16 mocked + 5 caract gated |

Le pattern standardisé en 8 étapes (suivi sur les 4 sprints) :

1. **Caract tests gated** d'abord (byte-identique pré-refactor)
2. **Types pure module** (`*-types.ts` 0 runtime)
3. **Algorithm pur** 0 I/O / 0 console / 0 Date.now / immutable + sort déterministe
4. **Unit tests algorithm** (pure-unit non-gated)
5. **Persist I/O** avec fail-soft semantics + custom errors
6. **Mocked tests persist** (vi.mock hoisted + dynamic import in test)
7. **Rewire route thin handler** + barrel + ESLint glob no-console:'error'
8. **Closeout doc**

**`balance/route.ts`** reste hors scope d'extraction post-Sprint Balance-Atomicity-Eval (2026-05-16) qui a confirmé la route déjà atomique by design (0 reversed pattern). L'extraction serait pure consolidation refactor mirror I5/I6 sans gain.

## 3. Cleanup-attempts CRITIQUES préservés

Patterns à NE PAS supprimer même si fail-soft cosmétique :

- **`savings/transfer/route.ts` pré-Sprint Atomicity-Savings** (L122/L321/L337) — rollback FROM impossible / rollback piggy UPDATE impossible / rollback piggy INSERT impossible. Regression-guardés Sprint Refactor-Test-Coverage 2026-05-12 puis **fermés à la racine** Sprint Atomicity-Savings 2026-05-12 via composite RPCs `transfer_savings_between_budgets` + `transfer_budget_to_piggy_bank` (les 3 cleanup-attempts n'existent plus dans le code post-fix ; les tests PIN ATOMIC CONTRACT pinnent le single-call-site invariant).

- **`recover-persist.ts:applyRecoveryDecision`** (route L286-288 pre-refactor Sprint Refactor-Recover 2026-05-16) — unexpected exceptions → `logger.error('[recover] rollback partiel impossible (snapshot may stay active)')` + throw `RecoveryAppliedPartiallyError` carrying partialResults. Le HTTP handler catch ce type d'erreur dédié et retourne 500 + recovery_results in body (shape byte-identique pre-refactor). Regression-guardé par le test "unexpected exception in apply loop" dans recover-persist.test.ts.

- **`auth/session/route.ts:56`** (Sprint Lot 5b) — Supabase auth réussi mais JWT session fail → état inconsistant grep-able. `logger.error` préservé.

- **`app/auth/confirm/route.ts:46`** (Sprint Lot 5c) — OTP verification réussie mais `data.user` manquant (edge case non-évident). ⚠️ **OBSOLETE (Sprint Fix-Password-Reset-OTP 2026-05-19)** — fichier supprimé, remplacé par client page `app/auth/confirm/page.tsx` (Path B closed-by-deletion + nouveau pattern click-to-confirm scanner-resistant cf. §7). Le cleanup-attempt n'a plus de site applicable : `verifyOtp` côté client ne peut pas retourner success+no-user (la session est créée localStorage par le SDK).

- **`database-snapshot.ts:169-173`** (Sprint Lot 5c) — 5 statements `logger.info` (snapshot ID + mois + total records + per-table counts — foundational pour audit recovery si rollback nécessaire post-process-step1).

- **`useMonthlyRecap.ts:84/115/157`** (Sprint Lot 5) — /monthly-recap/transfer + /auto-balance + /complete fail → état inconsistant si client cascade fail après server commit.

- **`useGroups.ts:145+168`** (Sprint Lot 5) — join/leave cross-mutation cascade fail (financial state stale risk).

- **`SavingsDistributionDrawer.tsx:171`** (Sprint Lot 5) — POST /savings/transfer fail peut laisser DB partiellement débitée, no toast UX.

- **`ServiceWorkerRegistration.tsx:18`** (Sprint Lot 5) — silent par design, log nécessaire pour tickets support 'offline ne marche pas'.

## 4. Composite RPCs atomiques (battle-tested)

Pour toute paire ou triplet d'opérations DB sur les colonnes sensibles (`piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings`), utiliser un helper `lib/finance/*` qui invoque une composite RPC :

| Helper                             | RPC                                     | Sprint                      | Use case                                                                               |
| ---------------------------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `updatePiggyBank`                  | `update_piggy_bank_amount`              | Sprint 0 / C3               | Single piggy debit/credit                                                              |
| `updateBankBalance`                | `update_bank_balance`                   | Sprint 0 / C3               | Single bank update                                                                     |
| `updateBudgetCumulatedSavings`     | `update_budget_cumulated_savings`       | Sprint 0 / C3               | Single savings update                                                                  |
| `transferFromPiggyToBudget`        | `transfer_from_piggy_to_budget`         | Sprint 0 / C3               | Piggy debit + budget savings credit                                                    |
| `transferWithSavingsDebit`         | `transfer_with_savings_debit`           | Refactor-I5-followup-v2     | INSERT budget_transfers + debit cumulated_savings                                      |
| `addExpenseWithBreakdown`          | `add_expense_with_breakdown`            | Atomicity-Expenses          | Smart-allocation expense (piggy + savings + INSERT real_expenses)                      |
| `transferSavingsBetweenBudgets`    | `transfer_savings_between_budgets`      | Atomicity-Savings           | Debit FROM + credit TO en 1 tx                                                         |
| `transferBudgetToPiggyBank`        | `transfer_budget_to_piggy_bank`         | Atomicity-Savings           | Debit budget + UPSERT piggy_bank                                                       |
| `transferPiggyToBudgetWithInsert`  | `transfer_piggy_to_budget_with_insert`  | Auto-Balance-Atomic-Phase-B | Debit piggy + INSERT budget_transfers (from_budget_id=NULL)                            |
| `addExpenseWithCrossBudgetCascade` | `add_expense_with_cross_budget_cascade` | P4-P5-P6                    | Cross-budget cascade expense (piggy + local_savings + budget + N cross-budget sources) |
| `deleteBudgetWithSavingsTransfer`  | `delete_budget_with_savings_transfer`   | Delete-Budget-Savings       | DELETE budget + UPSERT piggy (skip si savings=0)                                       |

`EXPECTED_RPCS = 11` pinnés dans [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs).

## 5. Patterns ❌ "Ne pas réintroduire X"

### Séquences non-atomiques (smart-allocation / savings transfer / auto-balance)

- ❌ **NE PAS** appeler `updatePiggyBank` puis `updateBudgetCumulatedSavings` puis `supabaseServer.from('real_expenses').insert(...)` séparément pour smart-allocation → utiliser `addExpenseWithBreakdown` (Sprint Atomicity-Expenses).
- ❌ **NE PAS** appeler `updateBudgetCumulatedSavings` deux fois séparées avec un manual rollback compensatoire → utiliser `transferSavingsBetweenBudgets` (Sprint Atomicity-Savings).
- ❌ **NE PAS** réintroduire le pattern reversed `for(savingsUpdates) updateBudgetCumulatedSavings → INSERT batched` dans `auto-balance/route.ts` → utiliser `transferWithSavingsDebit` per-pair (Sprint Auto-Balance-Atomic).
- ❌ **NE PAS** réintroduire le pattern reversed `updatePiggyBank(aggregate) + INSERT batched budget_transfers (from_budget_id=NULL)` → utiliser `transferPiggyToBudgetWithInsert` per-pair (Sprint Auto-Balance-Atomic-Phase-B).
- ❌ **NE PAS** appeler `supabase.from('estimated_budgets').delete()` directement dans la route DELETE — utiliser `deleteBudgetWithSavingsTransfer` qui DELETE + UPSERT piggy en 1 tx si `cumulated_savings > 0` (Sprint Delete-Budget-Savings). Le raw DELETE perd les économies silencieusement.

### Créateur des transactions réelles (Sprint Group-Transaction-Creator-Avatar)

- ❌ **NE PAS** INSERT dans `real_expenses` ou `real_income_entries` sans passer `created_by_profile_id: userId` (le `userId` du `withAuth`/`withAuthAndProfile` wrapper). Sites contraints : [lib/api/finance/expenses-real.ts](../../lib/api/finance/expenses-real.ts) POST, [lib/api/finance/income-real.ts](../../lib/api/finance/income-real.ts) POST, [lib/api/finance/expenses-add-with-logic.ts](../../lib/api/finance/expenses-add-with-logic.ts) (branche exceptionnelle + 2 helpers RPC), [lib/recap/complete-algorithm.ts](../../lib/recap/complete-algorithm.ts) (payload `exceptionalExpense` attribué à `input.userId`). Le DEFAULT NULL côté SQL existe uniquement pour la rétrocompat des call sites externes éventuels — les routes app DOIVENT toujours expliciter. Sans ça, l'UI groupe tombe sur le placeholder `??` au lieu de l'avatar du créateur (cas legacy seulement).
- ❌ **NE PAS** appeler `addExpenseWithBreakdown` ou `addExpenseWithCrossBudgetCascade` ([lib/finance/expenses.ts](../../lib/finance/expenses.ts)) sans `createdByProfileId` dans `args` — required (pas optional) pour forcer tous les call sites prod à expliciter. La RPC PG sous-jacente écrit la colonne `real_expenses.created_by_profile_id`.
- ❌ **NE PAS** retourner une ligne `real_expenses` / `real_income_entries` au client (GET ou POST/PUT après INSERT/UPDATE) sans étendre le `.select()` avec `created_by:profiles!<table>_created_by_profile_id_fkey(id, first_name, last_name, avatar_url)`. Le hint FK-name est obligatoire (2 FK vers `profiles` → ambiguïté PostgREST). 8 sites couverts : 3 selects dans expenses-real.ts (GET/POST/PUT) + 3 dans income-real.ts + 2 dans expenses-add-with-logic.ts (branche exceptionnelle + re-fetch post-RPC). Sans ce JOIN, la prop `transaction.created_by` est undefined côté UI → fallback placeholder `??` même quand la colonne est peuplée.
- ❌ **NE PAS** UPDATE `created_by_profile_id` dans les PUT handlers ou ailleurs — set-once at INSERT, l'édition d'une transaction ne change pas son créateur. Le helper `toCreatorProfile()` dans [TransactionListItem.tsx](../../components/dashboard/TransactionListItem.tsx) fait le mapping inverse `created_by → ProfileData` partiel pour `<UserAvatar>`.
- ❌ **NE PAS** ré-introduire la prop `userProfile` sur `<TransactionListItem>` ou `<TransactionTabsComponent>` (droppée au sprint). Le créateur vient de `transaction.created_by` (joint depuis l'API), plus de l'auth user. Les 2 pages dashboard (`app/(dashboards)/{dashboard,group-dashboard}/page.tsx`) ne passent plus `userProfile={profile}` au section component.

### God-files monthly-recap

- ❌ **NE PAS** réintroduire de logique métier dans `process-step1/route.ts`, `complete/route.ts`, `auto-balance/route.ts`, `recover/route.ts` (4/4 extraits). Tout ajout passe par `lib/recap/<route>-{algorithm,persist,types}.ts`.
- ❌ **NE PAS** réintroduire `declare global` dans aucune route (0 occurrence post-Refactor-I6).
- ❌ **NE PAS** réintroduire le pattern SELECT-then-UPDATE sur `cumulated_savings` dans `complete/route.ts` (L484 pre-Refactor-I6 fix).

### Idempotency / retries

- ❌ **NE PAS retry automatiquement** un POST `/api/monthly-recap/process-step1` qui retourne une 5xx — la route n'est pas idempotente. Le frontend doit disable le bouton pendant la submission (pattern `isSubmitting` dans [MonthlyRecapStep1.tsx](../../components/monthly-recap/MonthlyRecapStep1.tsx)). Si un futur incident montre des states cassés, prioritiser idempotency key serveur-side (header `Idempotency-Key` + cache table) ou `pg_try_advisory_xact_lock(hashtext(user_id))` plutôt que retry client.

### RAV formula

- ❌ **NE PAS** réintroduire `cumulated_savings` comme terme additif dans la formule RAV (`calculateRemainingToLiveProfile`/`Group`). La formule canonique est `totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits`. Le `totalSavings` est exposé séparément sur `FinancialData.totalSavings`.
- ❌ **NE PAS** dépendre de la colonne `estimated_budgets.monthly_surplus_deficit` comme source du terme `budgetDeficits` — le déficit est calculé **on-the-fly** via `calculateBudgetDeficit(estimatedAmount, spentThisMonth)`.
- ❌ **NE PAS** réintroduire le pattern read-persisted-then-override sur `/api/finance/summary` (ou toute autre route qui retourne `FinancialData`) : `persistedRav = await getRavFromDatabase(...)` puis `await getProfileFinancialData(...)` puis `financialData.remainingToLive = persistedRav`. Cette séquence créait un **off-by-one cache** : `getProfileFinancialData` recompute + persiste le RAV via `saveRavToDatabase` side-effect, mais l'API retournait la valeur lue AVANT (= la valeur de la requête précédente). Symptôme user : "j'ajoute une dépense overflow, le RAV ne bouge pas sans manual refresh". Fix Sprint Fix-Summary-RAV-Stale-Cache 2026-05-21 : drop le `getRavFromDatabase` import + drop l'override + drop la branche `if (shouldRecalculate)` qui dupliquait l'appel. Toute API route qui retourne `FinancialData` doit retourner le résultat de `getProfileFinancialData`/`getGroupFinancialData` directement (la persistence est interne via `saveRavToDatabase`). Les seules surfaces qui ont légitimement besoin de la valeur persistée (sans recompute) sont `/api/finance/rav` (endpoint dédié) et les routes monthly-recap qui lisent `bank_balances.current_remaining_to_live` dans leur algorithme — toute autre lecture est suspecte.

### budget_transfers.monthly_recap_id

- ❌ **NE PAS** ajouter un consumer qui FILTER/JOIN sur `budget_transfers.monthly_recap_id` sans d'abord plumber `recapId` à travers les 5 paths automatiques (step1-persist 2.3.1+2.4.2 via RPC `transfer_with_savings_debit` qui devrait accepter `p_recap_id`, auto-balance, balance, complete). Aujourd'hui la colonne est best-effort/NULL pour les paths automatiques. Un JOIN naïf raterait la quasi-totalité des transferts récap.

### recover route — strict boolean invariant

- ❌ **NE PAS** réintroduire `bank_balance: boolean | number` mismatch dans `RecoveryResults` (Sprint Lint-Followups Item 1 2026-05-08). Les paths V1 (update_bank_balance_v1) ET V2 (restoreTable resultKey 'bank_balance'/'piggy_bank') doivent assigner `true` strict (NEVER numeric `data.length`, NEVER `Boolean(x)`). Regression-guardé par 3 cas A/B/C dans `lib/__tests__/api-regressions.test.ts` gated `SUPABASE_API_TESTS=1`.

### recover — 5 tables v2 NON-restaurées

- ❌ **NE PAS** ajouter `profiles`, `groups`, `group_contributions`, `monthly_recaps`, `remaining_to_live_snapshots` dans `RestorableTable` literal union de `lib/recap/recover-types.ts`. Ces 5 tables contiennent de l'identity/membership/output/audit-trail data qui serait écrasée par snapshot restore. Sprint dédié `Recover-V2-Complete-Restoration` avec FK cascade tests requis avant.

### Tests gated monthly-recap

- ❌ **NE PAS supposer** dans un test gated que `bank_balances.current_remaining_to_live` reste à la valeur seedée pendant `loadCompleteSnapshot`. Step 2 appelle `getProfileFinancialData` qui recompute le RAV from scratch et **écrase la colonne via `saveRavToDatabase`** avant que step 6 ne re-lise. Cas vu Sprint Complete-CAS3-TestFix (2026-05-15). Tracer la séquence end-to-end avant d'asserter sur `bank_balances` ou `real_expenses` post-cleanup.

### Tables owner-row hybrides (`.single()` trap)

- ❌ **NE PAS** utiliser `.single()` sur les tables hybrides à 1-row-par-owner (`piggy_bank`, `bank_balances`) quand la ligne peut ne pas exister — `.single()` RAISE `PGRST116 "Cannot coerce the result to a single JSON object"` et un `if (error) throw` propage le crash jusqu'à l'UI. Utiliser `.maybeSingle()` + défaut `data?.amount ?? 0`. Cas vu Sprint Fix-Empty-Recap-Tirelire (2026-05-19) — `step1-persist.ts:148` crashait pour tout nouveau compte sans piggy. Les fixtures gated `SUPABASE_FINANCE_TESTS=1` créent toujours une ligne piggy, donc le bug n'a pas surfacé en CI — toute nouvelle route lisant `piggy_bank`/`bank_balances` doit être manuellement testée sur un compte fresh.
- ❌ **NE PAS** appeler directement les RPCs `update_piggy_bank_amount` / `update_bank_balance` quand la ligne peut ne pas exister — les RPCs font un `UPDATE ... WHERE owner = X` qui RAISE explicitement `'piggy_bank row not found for the given context'` si 0 rows. Précéder l'appel d'un `ensurePiggyBankRow(filter)` ([lib/finance/piggy-bank.ts](../../lib/finance/piggy-bank.ts) — INSERT idempotent `amount=0` qui swallow le PG `23505` unique_violation via les partial unique indexes par owner). Pattern miroir disponible pour `bank_balances` si besoin (à ajouter quand un site applicatif similaire surface — pas écrit préemptivement). Sites couverts post-Fix-Empty-Recap-Tirelire : `lib/recap/step1-persist.ts:applyDecision` CAS 1 op 1.1 + CAS 2 op 2.4.1.

### Colonnes mirror auto-syncées par trigger

- ❌ **NE PAS** réintroduire la saisie manuelle de `groups.monthly_budget_estimate` dans `CreateGroupForm`, `createGroupBodySchema`/`updateGroupBodySchema`, `POST /api/groups`, ou `PUT /api/groups/[id]`. Le champ est désormais un mirror auto-syncé par le trigger `estimated_budgets_sync_group_budget` ([supabase/migrations/20260520000000_auto_sync_group_budget.sql](../../supabase/migrations/20260520000000_auto_sync_group_budget.sql)) qui calcule `SUM(estimated_amount)` du groupe à chaque INSERT/UPDATE/DELETE sur `estimated_budgets`. Cascade : trigger UPDATE `groups.monthly_budget_estimate` → `groups_budget_contribution_recalc` PERFORM `calculate_group_contributions` → UPSERT `group_contributions`. Cas vu Sprint Group-Budget-Auto-Sync (2026-05-19) — avant le sprint, la contribution salariale d'un membre ne bougeait jamais quand un item de budget de groupe était créé/modifié/supprimé. Pattern à généraliser pour toute future colonne mirror : trigger PG `IS DISTINCT FROM` guard pour éviter no-op + cascade naturelle plutôt que cross-mutation TanStack invalidation manuelle.
- ❌ **NE PAS** réintroduire l'hybride hook `useState + AbortController` pour `useGroupContributions` — TanStack Query gère cancel-on-unmount natif via `AbortSignal` passé à `queryFn` + invalidation cache via `qc.invalidateQueries({ queryKey: ['group-contributions'] })`. La queryKey `['group-contributions']` est désormais incluse dans `invalidateFinancialRefreshes` ([lib/query-client.ts](../../lib/query-client.ts)) — toute mutation `useBudgets` (create/update/delete d'`estimated_budget`) ou `useGroups` (create/join/leave) déclenche déjà l'invalidation, pas besoin de cascade manuelle dans les consumers.

### Modals & UI

> Extraite 2026-05-20 (Sprint Drawer-Slide-Fix-And-Header-Harmonize) vers [operational-rules-ui-modals.md](operational-rules-ui-modals.md). **17 règles ❌** (initialement 11, +6 ajoutées Sprints Modal-Uniformize + Modal-Polish + Modal-Dropdown-Portal 2026-05-21) : Dialog/ModalCloseX, drawer swap horizontal, loading patterns, sections iOS, footer destructive, false-affordance, lazy-mount, `tw-animate-css` `!` postfix, **MODAL_CONTENT_CLASSES `bottom-auto!`**, **flex-auto vs flex-1**, **padding `px-6 py-4`**, **back button iOS chevron**, **step animation `stepAnimDir`+`key`**, **dropdown portal + max-h vh−bottom−10vh**.

### Edit-mode allocation semantics

- ❌ **NE PAS** réintroduire l'allocation P4-strict fresh en mode EDIT (Sprint Expense-Preview-Posé-Layout 2026-05-21, raffinée Delta-Cascade-Edit 2026-05-21). Le mode EDIT — détecté par la présence du paramètre `existingExpense` non-null sur [lib/expense-allocation.ts::applyAllocation](../../lib/expense-allocation.ts) ET dans la route [lib/api/finance/expenses-preview-breakdown.ts](../../lib/api/finance/expenses-preview-breakdown.ts) — DOIT utiliser l'algorithme « **delta-based cascade** » :

  ```
  delta = round(amount - existing.amount, 2)    // cents-precise

  if delta == 0:
    return { fromPiggy: eP, fromSavings: eS, fromBudget: eB }   // preserve

  if delta > 0:
    extra_savings_room = max(0, savingsBefore - eS)   // pool libre, hors claim existant
    addSavings = min(delta, extra_savings_room)
    addBudget  = delta - addSavings
    return {
      fromPiggy:   eP,                            // jamais auto-débitée
      fromSavings: eS + addSavings,
      fromBudget:  eB + addBudget,
    }

  if delta < 0:
    refundFromBudget  = min(|delta|, eB)          // budget vidé en priorité
    refundFromSavings = min(|delta| - refundFromBudget, eS)
    refundFromPiggy   = |delta| - refundFromBudget - refundFromSavings
    return {
      fromPiggy:   eP - refundFromPiggy,
      fromSavings: eS - refundFromSavings,
      fromBudget:  eB - refundFromBudget,
    }
  ```

  Trois cas distincts selon le sens du delta. Sans `existingExpense` (mode ADD), P4-strict standard reste valide (budget first, savings cascade overflow).

  Cas vérifiés :
  - **A=123 (eS=25, eB=98), pool savings=0** : 123→5 ⇒ nS=5, nB=0 ; 123→130 ⇒ nS=25, nB=105 ; 123→30 ⇒ nS=25, nB=5 ; 123→123 ⇒ preserve {nS=25, nB=98}.
  - **A=250 (eS=250, eB=0), pool savings=50** : 250→275 ⇒ nS=275, nB=0 (cascade les 25€ de delta dans le pool libre) ; 250→350 ⇒ nS=300, nB=50 (savings saturée, reste sur budget) ; 250→100 ⇒ nS=100, nB=0 (refund 150 from eB=0 then from eS=250).

  Bug pré-raffinement (algorithme « preserve existing caps » initial qui cappait nS à `eS` strict) : 250→275 affichait nS=250, nB=25 au lieu de nS=275, nB=0 — les économies libres dans le pool n'étaient pas utilisées. User rule "si il existe encore des économies disponibles, il faut les utiliser" : le delta>0 cascade savings AVANT budget si pool libre, miroir P5 toggle mais piloté par la disponibilité du pool plutôt qu'un toggle UI.

  Le mirroir entre `applyAllocation` (server PUT) et la duplication inline dans `expenses-preview-breakdown.ts` (route route, import server-only pas trivial à factoriser) est intentionnel — **toute modif de l'algo doit toucher LES DEUX endroits**. La précision cents (`Math.round(delta * 100) / 100`) absorbe le drift float introduit par DecimalFormInput (e.g., 250.0000001 typé devient 250.0000001 parsé).

- ❌ **NE PAS** soustraire `existingExpense.amount_from_budget` de `budgetSpentBefore` AVANT de calculer le breakdown (Sprint Expense-Preview-Posé-Layout 2026-05-21). Le `budgetSpentBefore` lu via SELECT inclut la valeur old (real_expenses pas encore UPDATE par le PUT). Garder cette valeur **un-reverted** pour l'input du calcul. Le subtract du existing.amount_from_budget se fait UNIQUEMENT au calcul du `budget_spent_after` retourné par l'API : `budget_spent_after = budgetSpentBefore - (existingExpense?.amount_from_budget ?? 0) + fromBudget`. Bug pré-fix : la route preview-breakdown soustrayait à l'input → budgetRemaining trop grand → P4-strict mettait tout sur le budget (allocation divergente du PUT serveur).

- ❌ **NE PAS** réintroduire `sum + expense.amount` dans `EditTransactionModal.calculateRealSpentAmount` — doit sommer `expense.amount_from_budget` avec fallback sur `amount` pour legacy nulls, miroir `AddTransactionModal`. Sprint 2026-05-21 : le bug donnait `398€/200€` dans le dropdown pour 2 dépenses (123+275) dont 300€ d'économies absorbaient la majorité — l'affichage cumulé incluait la portion savings+piggy ce qui n'a pas de sens pour un "spent on budget pool". Le seul invariant valide : `dropdown.spentAmount === sum(expense.amount_from_budget)`.

### Forbidden absolus

- ❌ **NE PAS** modifier [supabase/migrations/20260506000000_create_finance_rpcs.sql](../../supabase/migrations/20260506000000_create_finance_rpcs.sql). Pour corriger une RPC : `CREATE OR REPLACE` dans une nouvelle migration.
- ❌ **NE PAS** réactiver `typescript.ignoreBuildErrors`.
- ❌ **NE PAS** upgrader `eslint-config-next` 15→16 maintenant (Sprint 1 séparé).
- ❌ **NE PAS** mocker la DB dans les tests d'intégration — utiliser Supabase local ou staging.
- ❌ **NE PAS** écrire de docs `.md` sans demande explicite (sauf CLAUDE.md, RLS-FINDINGS, prompts/, et les fichiers `.claude/` mis en place pour la refactorisation du CLAUDE.md).
- ❌ **NE PAS** réintroduire les exports supprimés au Sprint Dead-Code-Purge (cf. §1 ci-dessus).
- ❌ **NE PAS** réintroduire un fichier `lib/financial-calculations.ts` — le god file (1069 LOC) a été splitté en 8 modules sous [lib/finance/](../../lib/finance/) au Sprint Refactor-I4.
- ❌ **NE PAS** réintroduire un fichier `middleware.ts` — la file convention Next.js est renommée `proxy.ts` au Next 16 (Sprint Hygiene-Next-16-Migration 2026-05-20). Le runtime de `proxy.ts` est **nodejs** (non-configurable), `middleware.ts` tournait sur edge par défaut. Si tu dois absolument repasser en edge runtime, garder `middleware.ts` (cf. doc Next 16 upgrading guide : "If you want to continue using the edge runtime, keep using middleware. We will follow up on a minor release with further edge runtime instructions"). Pour Popoth : on reste sur `proxy.ts` (aucun edge-only API critique consommé). Étapes de migration : `git mv middleware.ts proxy.ts` (préserve historique git) + rename function `middleware` → `proxy` + maj log prefixes `[Middleware]` → `[Proxy]` + maj `eslint.config.mjs` files override + maj 3 cross-refs (`app/monthly-recap/page.tsx`, `app/api/monthly-recap/status/route.ts`, `.claude/reference/structure-repo.md`).
- ❌ **NE PAS** lancer `pnpm self-update` sans target version explicite — la commande lit la dernière version pnpm publiée et **bumpe silencieusement le pin `packageManager`** dans `package.json` (incident Sprint Hygiene-Next-16-Migration 2026-05-20 : pin `pnpm@9.15.5` → `pnpm@11.1.3` bump silencieux + install incomplet dans `~/AppData/Local/pnpm/.tools/@pnpm+win-x64/11.1.3/` — `pnpm.exe` posé (98MB) mais shims `bin/pnpm` + `pnpm.CMD` + `pnpm.ps1` **non créés** → ENOENT sur toute commande pnpm subséquente). Le pin actuel est **`pnpm@9.15.5`** (CLAUDE.md §2 stack). Patterns corrects : (a) éditer manuellement `package.json` `packageManager` field puis `pnpm install` (validation) ; (b) `pnpm self-update <version>` avec target explicite (e.g. `pnpm self-update 9.15.6` pour patch bump intentionnel). Le binaire pnpm.exe au top-level de `~/AppData/Local/pnpm/` est un shim qui lit `packageManager` et délègue à `.tools/@pnpm+win-x64/<version>/bin/pnpm` — si le bin est absent (install partielle), ENOENT immédiat.

## 6. Précédents Sprint chronologie résumée

> Extraite 2026-05-22 vers [.claude/history/sprint-chronology.md](../history/sprint-chronology.md) (la table avait fait franchir le plafond size-policy au fichier principal, cap alors à 38k — bumped à 39.5k le même jour). Append-only : ajouter 1 ligne par sprint installant un pattern réutilisable. Pour la chronologie complète des 112 sprints, voir CLAUDE.md §11.
## 7. Supabase Auth click-to-confirm gate — scanner-résistance

Sprint Fix-Password-Reset-OTP (2026-05-19) — corrige une régression prod du flow "mot de passe oublié" où le lien de récupération reçu par mail répondait immédiatement `otp_expired` parce que les scanners d'email (Outlook Safe Links, Gmail previewers, antivirus locaux, link-preview bots) GET-prefetchaient `https://...supabase.co/auth/v1/verify?token=...` et consommaient l'OTP single-use **avant** que l'utilisateur ne clique.

### Architecture installée

1. **Browser → `forgot-password`** : appelle `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${getSiteUrl()}/auth/confirm\` })`. Le `redirectTo` est validé par Supabase contre l'allowlist Redirect URLs.
2. **Supabase → email** : template "Reset Password" (Dashboard → Authentication → Email Templates) doit utiliser `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">…</a>`. Ce format évite `{{ .ConfirmationURL }}` qui embed l'endpoint legacy `/auth/v1/verify` consommé au premier GET du scanner.
3. **Utilisateur → `/auth/confirm` (client page)** : `app/auth/confirm/page.tsx` rend du HTML inerte (Suspense + bouton "Confirmer"). `verifyOtp({ token_hash, type })` n'est appelé qu'**au clic explicite**. Les scanners ne ré-exécutent pas le JS → l'OTP survit jusqu'au clic humain.
4. **`verifyOtp` succès → `next` sanitisé** : `sanitizeNext(raw, type)` n'accepte que les URLs same-origin ou les paths relatifs (rejette `//evil.example`, `https://evil.example`). Fallback type-aware (`recovery` → `/reset-password`, autres → `/dashboard`).
5. **`verifyOtp` erreur → `/auth/auth-code-error?error={expired|invalid|server}`** : surface UX existante avec "Demander un nouveau lien" + "Retour à la connexion".

### Helpers + fichiers livrés

- [lib/site-url.ts](../../lib/site-url.ts) — `getSiteUrl()` : browser → `window.location.origin`, SSR → `NEXT_PUBLIC_SITE_URL`, fallback `localhost:3000`. À utiliser pour TOUTE URL absolue côté app (Supabase `redirectTo`, OAuth, futurs deep-links).
- [app/auth/confirm/page.tsx](../../app/auth/confirm/page.tsx) — gate client (148 LOC). 11 cas test dans [app/auth/confirm/\_\_tests\_\_/page.test.tsx](../../app/auth/confirm/__tests__/page.test.tsx) couvrant happy + missing/invalid params + open-redirect rejection + 3 erreurs verifyOtp.
- Supprimés : `app/auth/confirm/route.ts` (server route, scanner-vulnerable), back-link cassé `/mot-de-passe-oublie` → `/forgot-password` dans `reset-password/page.tsx:145`.

### Configuration manuelle Supabase Dashboard (requise post-déploiement)

Projet `jzmppreybwabaeycvasz` :

- **Authentication → URL Configuration → Site URL** : l'URL prod (ex. `https://popoth.app`).
- **Authentication → URL Configuration → Redirect URLs** : `https://popoth.app/**` + `http://localhost:3000/**` (les deux, sinon `resetPasswordForEmail` rejette le `redirectTo`).
- **Authentication → Email Templates → Reset Password** (et idéalement les 4 autres types `signup` / `magiclink` / `invite` / `email_change` qui sont aussi gérés par `/auth/confirm`) : remplacer le `<a>` par `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Réinitialiser mon mot de passe</a>` (adapter `type` et `next` par template). Variables `{{ .Token }}` (6 chiffres) et `{{ .ConfirmationURL }}` interdites.
- **Authentication → Providers → Email → OTP Expiration** : 3600s (1h) par défaut OK. Ne pas baisser sans raison forte (race scanner-prefetch ↔ user-click plus probable).

### ❌ À ne pas réintroduire

- **Server route `app/auth/confirm/route.ts`** — un `route.ts` GET handler consomme l'OTP serveur-side au premier prefetch. Reste un client page (Suspense + bouton).
- **`useEffect` auto-call `verifyOtp()` on-mount** dans `app/auth/confirm/page.tsx` — supprime la protection scanner (certains preloads / link-preview bots exécutent JS minimal). Le clic explicite est obligatoire.
- **`{{ .ConfirmationURL }}`** dans n'importe quel template email Supabase — embed `/auth/v1/verify?token=...` qui est l'endpoint legacy auto-consommateur. Toujours `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=<type>` + path `next` hardcodé.
- **`redirectTo` hardcodé `${window.location.origin}/...`** dans le code — utiliser `getSiteUrl()` pour SSR-safety + un futur usage server-side.
- **`next` query non-sanitisé** dans `/auth/confirm` — l'open-redirect (`?next=https://evil.example`) est un vecteur de phishing. Rester sur `sanitizeNext()` (same-origin + path-relatif uniquement). Regression-guardée par 2 cas test ("rejects external `next` URLs" + "rejects protocol-relative `next` (//evil.example.com)").
- **Migrer vers PKCE flow** sans plan dédié — PKCE stocke le `code_verifier` en localStorage du device qui a fait `resetPasswordForEmail` ; casse le cas cross-device (request laptop, ouvre email phone). Le pattern token_hash + click-to-confirm est scanner-resistant ET cross-device safe.

### Flow cross-référence

Le pattern miroir s'applique aux 4 autres types `EmailOtpType` (signup, magiclink, invite, email_change) — `/auth/confirm` gère déjà les 5 valeurs via `ALLOWED_TYPES` (literal union strict). Si un nouveau type est ajouté côté Supabase, étendre la const + ajouter un cas test "renders gate for type=<new>" dans [page.test.tsx](../../app/auth/confirm/__tests__/page.test.tsx).
