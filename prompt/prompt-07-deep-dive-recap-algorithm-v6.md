# Prompt v6 — Sprint Atomicity-Expenses : fermer le gap atomicité surfacé par Sprint Refactor-Test-Coverage

> **Statut** : prompt rédigé en clôture du Sprint Refactor-Test-Coverage (2026-05-12) — le sprint a livré 17 cas mocked non-gated dont **un test REGRESSION-GUARD** ([lib/api/finance/\_\_tests\_\_/expenses-add-with-logic.test.ts](../lib/api/finance/__tests__/expenses-add-with-logic.test.ts) Cas 4) qui pin un **gap atomicité réel** : la séquence `updatePiggyBank` → `updateBudgetCumulatedSavings` → INSERT `real_expenses` n'a aucune rollback compensatoire si l'INSERT throws. Piggy + cumulated_savings restent débités mais aucune dépense n'est créée → l'utilisateur perçoit une magic perte d'argent au prochain refresh.
>
> **Pas bloquant pour la prod** au sens "incident actif", mais c'est la même classe de bug que celle fermée au Sprint Refactor-I5-followup-v2 sur l'étape 2.4.2 (`transfer_with_savings_debit` composite RPC). Le pattern est éprouvé, l'effort est borné, et le test cassera quand la fix landera — forçant une mise à jour explicite des assertions + CLAUDE.md §11.

---

## Contexte

Sprint Refactor-Test-Coverage (Sprint v5, 2026-05-12) a installé 17 cas mocked non-gated couvrant 3 orchestrateurs multi-RPC. **Au passage**, Phase 1 a invalidé un item du prompt v5 :

- Le prompt v5 prétendait que `expenses-add-with-logic.ts` avait 2 cleanup-attempts CRITIQUES préservés au Lot 4e (L216 + L229).
- **Ces lignes n'existent pas** dans le code actuel. L'audit a trouvé que **la route n'a aucune rollback** si l'INSERT échoue après les 2 RPC debits.

Le Cas 4 de [expenses-add-with-logic.test.ts](../lib/api/finance/__tests__/expenses-add-with-logic.test.ts) **pin ce comportement actuel** comme regression-guard :

```typescript
it('REGRESSION-GUARD atomicity gap: INSERT real_expenses fails but piggy + savings already debited (no compensating action)', async () => {
  // This test pins the CURRENT BEHAVIOR — not the desired one. The route
  // debits piggy + cumulated_savings via atomic RPCs, then performs a
  // direct INSERT real_expenses. If the INSERT fails, both debits stay
  // committed and the user perceives a magic money loss on next refresh.
  //
  // When a future Sprint Atomicity-Expenses fixes this (e.g. via a
  // composite RPC mirroring transfer_with_savings_debit from Sprint
  // Refactor-I5-followup-v2, or via compensating logger.error +
  // cleanup-attempt calls), this test will break — which is the signal
  // to update both the test and CLAUDE.md §11.
  ...
})
```

**Symétrie avec `savings/transfer/route.ts`** : même sprint a regression-guardé 3 cleanup-attempts CRITIQUES (L122, L321, L337) dans cette route. Le pattern est identique — 2 RPCs séquentielles + rollback compensatoire qui peut elle-même fail. Les 2 routes pourraient bénéficier du même style de fix architectural (composite RPC), bien que la sémantique métier soit différente.

**Pattern de référence à mirror** : [Sprint Refactor-I5-followup-v2](../CLAUDE.md) (commits `93f46c4` + `d09587a` + `10b4fce`) — RPC composite `transfer_with_savings_debit` qui combine INSERT `budget_transfers` + debit `cumulated_savings` en une transaction Postgres atomique. Helper TS `transferWithSavingsDebit` minimal. Step 2.4.2 dans `lib/recap/step1-persist.ts` réécrit de 2 appels fail-soft séquentiels à 1 appel atomique.

---

## Outcome attendu

- 1 nouvelle RPC composite SQL pour `expenses-add-with-logic` (potentiellement 2 si on bundle `savings/transfer`)
- 1 helper TS minimal `lib/finance/expenses.ts` (mirror `budget-transfers.ts`)
- Réécriture de `lib/api/finance/expenses-add-with-logic.ts` pour appeler le helper atomique au lieu des 3 ops séquentielles
- Mise à jour du **Cas 4 du test regression-guard** : le test cassera (assertion `piggy.updatePiggyBank called exactly 1x` devient fausse car la nouvelle RPC ne passe plus par le helper TS) — soit on supprime ce cas, soit on le réécrit pour pin la nouvelle sémantique atomique (`expect(...RPC...).toHaveBeenCalledTimes(1)` + assertion sur tx atomicity au niveau DB via gated test concurrent).
- 4-6 tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` couvrant happy path / insufficient piggy / insufficient savings / INSERT fail (atomicity proof : 0 rows partial state) / 100× concurrent invariant. Mirror [lib/finance/**tests**/transfer-with-savings.test.ts](../lib/finance/__tests__/transfer-with-savings.test.ts).
- `pnpm db:check-rpcs` étendu (`EXPECTED_RPCS` pin la nouvelle fonction)
- `lib/database.types.ts` regen
- Pas de migration vers une primitive `withCompensatingRollback()` — abstraction prématurée tant que <5 sites cross-repo.

**Hypothèse de scope** : 1 sprint = `expenses-add-with-logic` seul. Bundler `savings/transfer` est tentant (même pattern) mais double le scope et fait apparaître 2 nouvelles RPCs au lieu d'une.

---

## Candidats audités

### Candidat principal — `expenses-add-with-logic.ts` (atomicity gap pinné)

**Fichier** : [lib/api/finance/expenses-add-with-logic.ts](../lib/api/finance/expenses-add-with-logic.ts) (261 LOC post-Lot 4e).

**Séquence non-atomique actuelle** (régulière, pas exceptionnelle) :

1. L184 : `updatePiggyBank(filter, -fromPiggyBank)` — RPC atomique sur `piggy_bank.amount`
2. L197 : `updateBudgetCumulatedSavings(estimated_budget_id, -fromBudgetSavings)` — RPC atomique sur `estimated_budgets.cumulated_savings`
3. L221 : `INSERT real_expenses` (direct Supabase, PAS de RPC)

**Si l'INSERT (étape 3) échoue** : piggy + savings sont déjà débités, aucune restore. Pas de logger.error CRITIQUE non plus (le L233 log la failure mais ne tente pas de rollback).

**Surface à fixer** : nouvelle RPC `add_expense_with_breakdown(p_amount, p_description, ..., p_amount_from_piggy_bank, p_amount_from_budget_savings, p_amount_from_budget)` qui :

- Debit `piggy_bank.amount` si `p_amount_from_piggy_bank > 0`
- Debit `estimated_budgets.cumulated_savings` si `p_amount_from_budget_savings > 0`
- INSERT `real_expenses` avec le breakdown
- Tout en une transaction atomique avec rollback Postgres si une étape échoue (RAISE EXCEPTION pour overdraft, contrainte NOT NULL violation, etc.)

**Signature SQL probable** (à valider Phase 1) :

```sql
CREATE OR REPLACE FUNCTION public.add_expense_with_breakdown(
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_estimated_budget_id uuid,
  p_amount numeric,
  p_description text,
  p_expense_date date,
  p_amount_from_piggy_bank numeric,
  p_amount_from_budget_savings numeric,
  p_amount_from_budget numeric
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ ... $$;
```

**Edge cases** :

- Exceptional expense (no `estimated_budget_id`) : pas besoin d'atomicité car aucun debit — laisser l'INSERT direct dans le handler (L94-110), pas couvert par la nouvelle RPC.
- Cas où `fromPiggyBank=0 AND fromBudgetSavings=0` (full budget) : la RPC peut soit gérer ce cas (UPDATE no-op + INSERT) soit la délégation reste au handler pour le path "full budget" (économise un round-trip RPC pour le cas commun).

### Candidat secondaire — `savings/transfer/route.ts` (3 cleanup-attempts CRITIQUES)

**Fichier** : [app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts) (355 LOC post-Lot 4d).

**3 routes orchestrées** :

1. POST budget→budget (L25-151) : 2 RPCs séquentielles + rollback (L121-130) — **cleanup-attempt L122 CRITIQUE** si rollback throws
2. `handleBudgetToPiggyBank` (L250-354) : RPC + UPDATE/INSERT piggy_bank + rollback — **cleanup-attempt L321 CRITIQUE** si rollback throws après piggy UPDATE fail
3. Idem `handleBudgetToPiggyBank` INSERT path — **cleanup-attempt L337 CRITIQUE** si rollback throws après piggy INSERT fail

**Surface à fixer** : 2 nouvelles RPCs composites :

- `transfer_savings_between_budgets(p_from_budget_id, p_to_budget_id, p_amount)` — debit FROM + credit TO en une tx
- `transfer_budget_to_piggy_bank(p_from_budget_id, p_filter, p_amount)` — debit budget + UPDATE/INSERT piggy en une tx

**Question d'arbitrage** : bundler avec le candidat principal ou splitter en Sprint Atomicity-Savings v2 ? Trade-off : +sprint courts vs −rework dans le même fichier de tests.

### Candidat tertiaire (out of scope par défaut) — `auto-balance/route.ts`

Le `auto-balance/route.ts` a un **pattern reversed RPC→INSERT** (per CLAUDE.md §11 mention) qui pourrait aussi bénéficier d'une RPC composite. Mais c'est couplé au **chantier I6** (extraction logique métier du god file `complete/route.ts` + 4 globals carryover). Skip pour ce sprint, défer à I6.

---

## Workflow recommandé

### Phase 1 — Investigation (Explore agent)

Une seule passe Explore suffit (1 agent, ~5 min) :

1. **Confirmer file:lines** des deux candidats — `expenses-add-with-logic.ts` peut avoir shifté depuis ce sprint, `savings/transfer/route.ts` est stable.
2. **Lire la migration `20260516000000_create_transfer_with_savings_debit_rpc.sql`** intégralement pour copier la structure de la nouvelle migration : SECURITY DEFINER + SET search_path + REVOKE/GRANT + NOTIFY pgrst, composite operation pattern, RETURNING json shape.
3. **Lire [lib/finance/budget-transfers.ts](../lib/finance/budget-transfers.ts)** pour copier le helper TS pattern : ContextFilter resolve + supabase.rpc + throw on error + RETURNING typed shape.
4. **Lire le test gated [lib/finance/\_\_tests\_\_/transfer-with-savings.test.ts](../lib/finance/__tests__/transfer-with-savings.test.ts)** pour copier le pattern de 4 cas concurrence (happy / insufficient / 100× / XOR validation).
5. **Vérifier `pnpm db:check-rpcs`** (5/5 RPCs aujourd'hui) — confirmer comment ajouter la nouvelle à `EXPECTED_RPCS`.
6. **Smoke test** : `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/transfer-with-savings.test.ts` reste vert.

Rapport ≤ 400 mots.

### Phase 2 — Arbitrage user (AskUserQuestion)

3-4 questions critiques :

**Q1 — Scope** :

- (A) `expenses-add-with-logic` seul (1 RPC, 1 helper, ~12 cas total : 4-6 gated + Cas 4 réécrit + 4-5 autres unit cases inchangés). Sprint borné, ~4-5 commits. **Recommended**.
- (B) Bundle `expenses` + `savings/transfer` (3 RPCs, 3 helpers, ~24 cas total). Double le scope. Skip → Sprint v7.
- (C) `expenses` + I6 bundle (atomicity + god file extraction). Très large. Pas recommandé sans plan I6 séparé.

**Q2 — Sémantique du rollback NULL piggy** :

- (A) La RPC throw `RAISE EXCEPTION` si `piggy_bank.amount < p_amount_from_piggy_bank` (overdraft) — mirror du pattern Sprint Hardening / H3 (`update_bank_balance` aligné). Handler catch + 500 + message. Pas de UPDATE partiel. **Recommended**.
- (B) La RPC retourne `{ success: false, reason: 'insufficient_piggy' }` au lieu d'exception. Handler check le shape et retourne 400 avec message. Plus flexible mais inconsistent avec les autres RPCs du repo.

**Q3 — Cas 4 du test regression-guard** :

- (A) **Réécrire** le Cas 4 pour pin la nouvelle sémantique atomique : `expect(addExpenseWithBreakdown).toHaveBeenCalledTimes(1)` + ajouter un cas gated qui prouve l'atomicité au niveau DB (insufficient piggy → 0 rows changed, piggy intact, savings intact, real_expenses count unchanged). **Recommended**.
- (B) **Supprimer** le Cas 4 — il était utile comme regression-guard pre-fix, mais devient redundant avec les cas gated post-fix.
- (C) **Garder** le Cas 4 tel quel et ajouter un commentaire "obsolète post-Sprint v6". Skip — laisse de la dette.

**Q4 — Découpage commits** (si scope A) :

- (A) 1 migration / 1 helper TS / 1 refactor handler + test update / 1 gated tests / 1 closeout = **5 commits**. **Recommended**.
- (B) Bundle migration + helper (DB-side) en 1 commit, refactor + test en 1 commit, gated tests en 1 commit, closeout. **3 commits**.

### Phase 3 — Implémentation

**Commit 1** — Migration SQL `supabase/migrations/<YYYYMMDDHHMMSS>_create_add_expense_with_breakdown_rpc.sql`. Apply via `node scripts/apply-sql.mjs <migration>` + `pnpm supabase migration repair --status applied <ts>`. Re-export baseline.

**Commit 2** — Helper TS `lib/finance/expenses.ts` exportant `addExpenseWithBreakdown(filter: ContextFilter, params: ...)`. Pattern miroir `lib/finance/budget-transfers.ts`. JSDoc explicite. **Pas exposé dans le barrel `lib/finance/index.ts`** (cf. convention C3 — direct submodule import).

**Commit 3** — Refactor `lib/api/finance/expenses-add-with-logic.ts` : la séquence 3-ops L184/L197/L221 devient un seul appel `await addExpenseWithBreakdown(filter, { ... })`. La logique exceptionnelle (L84-125) reste inchangée. Réécriture du Cas 4 du test + mise à jour de Cas 2/3 (les RPCs ne s'appellent plus directement, l'assertion `piggy.updatePiggyBank.toHaveBeenCalledTimes(1)` devient `addExpenseWithBreakdown.toHaveBeenCalledTimes(1)`).

**Commit 4** — Tests gated `lib/finance/__tests__/add-expense-with-breakdown.test.ts` (4-6 cas) miroir `transfer-with-savings.test.ts`. Couvre happy / insufficient piggy / insufficient savings / INSERT fail (atomicity proof) / 100× concurrent. Pin l'invariant que 0 rows partial state ne fuit.

**Commit 5** — Closeout : `pnpm db:types` regen + `scripts/check-rpcs.mjs` extend `EXPECTED_RPCS` + CLAUDE.md §11 entry + (optionnel) §5 mention de la nouvelle RPC + §8 ✅ "À faire" mention de `addExpenseWithBreakdown` comme pattern d'écriture atomique pour smart-allocation.

### Phase 4 — Verif end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` 0 errors / 183 warnings stable
- `pnpm test:run` exit 0 (full non-gated bucket inchangé ou +1 cas selon réécriture Cas 4)
- `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run lib/finance/__tests__/add-expense-with-breakdown.test.ts` exit 0 (4-6 cas verts contre prod, ~30-60s)
- `pnpm verify` exit 0 (8 stages, 11/11 fonctions versionnées avec la nouvelle)
- `pnpm db:check-rpcs` 6/6 RPCs présentes
- Negative grep : `Grep "REGRESSION-GUARD atomicity gap" lib/api/finance/__tests__/` 0 hit (Cas 4 réécrit ou supprimé)
- Smoke browser : `/dashboard` → AddTransactionModal → ajouter une dépense avec piggy + savings → vérifier que le breakdown est cohérent et que la dépense apparaît bien dans la liste.

### Phase 5 — Closeout

CLAUDE.md §11 entrée "Sprint Atomicity-Expenses". Score estimé ~99.8 → ~99.9/100 (consolidation du contrat atomicity).

---

## Critères de succès

- 1 nouvelle RPC composite `add_expense_with_breakdown` déployée prod, présente dans `pg_proc`, versionnée dans `supabase/migrations/`, pinnée dans `EXPECTED_RPCS` de `check-rpcs.mjs`
- Le handler `expenses-add-with-logic.ts` n'a plus de séquence 3-ops non-atomique pour le smart-allocation path (exceptional path inchangé)
- Cas 4 du test regression-guard mis à jour (réécrit ou supprimé selon arbitrage Q3)
- 4-6 nouveaux cas gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` prouvent l'atomicité au niveau DB
- `pnpm verify` exit 0
- 0 typecheck/lint regression, lint baseline 183 stable

---

## Hors scope (à séparer)

- **`savings/transfer/route.ts` atomicity** — couvert par Sprint Atomicity-Savings v2 (suite naturelle). Les 3 cleanup-attempts CRITIQUES regression-guardés par Sprint v5 deviendront moot une fois la composite RPC en place.
- **`auto-balance/route.ts` reversed RPC→INSERT** — couplé I6 (god file extraction de `complete/route.ts`). Bundle avec I6 prioritaire.
- **`handlePiggyBankAction` (piggy→budget direction)** dans `savings/transfer/route.ts` — sym de `handleBudgetToPiggyBank`, diminishing returns sans couverture explicite.
- **Migration vers `withCompensatingRollback()` abstraction** — abstraction prématurée tant que <5 sites cross-repo.
- **Lot 6 console.log cleanup** + activation globale `no-console: 'error'` — roadmap I4/I5.

---

## Notes pour l'agent

- **Pattern de référence stricte** : `transfer_with_savings_debit` migration + helper + tests + handler update du Sprint Refactor-I5-followup-v2. Tout ce sprint v6 mirror ce template.
- **Apply via `apply-sql.mjs`, pas `db push`** — la migration est `CREATE OR REPLACE FUNCTION` idempotente, applicable directement via API Management sans Docker. Suivre `pnpm supabase migration repair --status applied <ts>` après pour éviter le drift C3.
- **Préserver le smoke browser deferred** : les tests gated couvrent l'atomicité DB-side mais pas le flow UI (AddTransactionModal → breakdown computed → expense visible). Mention dans le closeout.
- **Si Phase 1 trouve un edge case non documenté** (e.g. la combinaison `is_for_group=true` + smart-allocation a un comportement spécial sur le `profile.group_id` resolve), flag explicitement à l'arbitrage. La RPC doit gérer le XOR profile/group via les paramètres `p_profile_id` / `p_group_id` (mirror du pattern existant).
- **TypeScript types** : après `pnpm db:types` regen, la nouvelle RPC apparaîtra dans `lib/database.types.ts` Functions. Le helper TS doit consumer ces types pour le param shape + return shape.
