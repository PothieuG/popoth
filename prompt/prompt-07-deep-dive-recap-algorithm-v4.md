# Prompt v4 — Suites du Sprint Refactor-I5-followup-v2 (`process-step1`)

> **Statut** : prompt rédigé en clôture du Sprint Refactor-I5-followup-v2 (2026-05-11) pour capitaliser sur 3 axes secondaires observés pendant l'implémentation. Ces axes ne sont **pas dans la liste d'out-of-scope du v3** — ils sont nouveaux, surfacés par l'exploration du code et l'utilisation du nouveau pattern atomique. Aucun n'est bloquant pour la prod, tous méritent une session dédiée.

---

## Contexte

Le Sprint Refactor-I5-followup-v2 (2026-05-11) a :

- Créé la RPC composite `transfer_with_savings_debit` (atomique INSERT `budget_transfers` + debit `cumulated_savings`)
- Câblé le helper `transferWithSavingsDebit` dans `lib/recap/step1-persist.ts` step 2.4.2
- Ajouté 4 tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` + 8 tests mocked non-gated
- Score ~99.6 → ~99.7/100

Pendant l'implémentation, 3 observations nouvelles sont apparues que ce prompt v4 capture pour décision.

---

## Axe 1 — `monthly_recap_id` jamais set sur les `budget_transfers` produits par les paths automatiques

### Symptôme

[supabase/migrations/20260101000000_remote_schema.sql:44](../supabase/migrations/20260101000000_remote_schema.sql) déclare `budget_transfers.monthly_recap_id uuid` **nullable**. Grep cross-codebase montre :

- **Un seul** consumer qui set la colonne : [app/api/monthly-recap/transfer/route.ts:143](../app/api/monthly-recap/transfer/route.ts) (manual transfer via UI, accepte `monthly_recap_id` du body)
- **Tous les autres paths automatiques** (step 2.3.1 + step 2.4.2 dans `lib/recap/step1-persist.ts` + `auto-balance/route.ts` + `complete/route.ts` + `balance/route.ts`) laissent `monthly_recap_id = NULL`

Conséquences :

1. **Audit trail incomplet** : un consumer qui filtre `WHERE monthly_recap_id = '<id>'` rate les transferts produits par les paths automatiques — soit la quasi-totalité du flux récap mensuel.
2. **FK CASCADE ne fire pas** : la FK `budget_transfers_recap_id_fkey ON DELETE CASCADE` (line 222) ne nettoie pas ces rows quand un monthly_recap est supprimé — accumulation à long terme.
3. **Pattern hérité** : le bug n'est pas introduit par I5-followup-v2 ; il existe depuis la création du flux (le commit historique d'origine left NULL). Mais la nouvelle RPC `transfer_with_savings_debit` continue le pattern (par design pour préserver byte-identique pré/post-refactor).

### Solutions à arbitrer

**(A) Plumb `recapId` à travers tout le flux step 1** : étendre `ProcessStep1Input` avec `recapId: string`, le passer au RPC `transfer_with_savings_debit` (ajouter `p_recap_id` parameter), le passer aussi à l'INSERT step 2.3.1. Idem pour `auto-balance` / `complete` / `balance`. **Coût** : migration RPC (re-CREATE OR REPLACE) + types regen + signature changes dans 5+ routes + tests gated mis à jour. **Bénéfice** : audit trail consistent.

**(B) Trigger BEFORE INSERT** sur `budget_transfers` qui résout le `monthly_recap_id` depuis le `created_at` (matcher le recap actif au moment de l'INSERT). **Coût** : nouvelle fonction PL/pgSQL versionnée + test gated. **Bénéfice** : pas de code TS à changer. **Risque** : logique implicite cachée dans un trigger, harder à debug.

**(C) Accepter et documenter** : laisser le pattern hérité tel quel, documenter dans CLAUDE.md §5 que `budget_transfers.monthly_recap_id` est best-effort, NULL pour les paths automatiques. **Coût** : 0 LOC. **Bénéfice** : zéro risque. **Cost**: aucun consumer applicatif ne semble dépendre de la colonne aujourd'hui (vérifier en Phase 1).

**(D) Schema migration** : retirer la colonne `monthly_recap_id` si elle n'a pas de consumer applicatif. Dead schema. **Coût** : 1 migration + regen types + supprimer le 1 site `transfer/route.ts:143`. **Bénéfice** : surface réduite.

### Phase 1 attendue

- Grep cross-codebase pour tout consumer qui FILTRE ou JOIN sur `budget_transfers.monthly_recap_id` (hooks, components, autres routes API, `lib/`). Si 0 consumer → option C ou D. Si ≥1 consumer → option A ou B.
- Vérifier la prod via `apply-sql.mjs` : combien de rows `WHERE monthly_recap_id IS NULL` aujourd'hui ?

### Fichiers concernés (si option A)

- `supabase/migrations/<TS>_add_recap_id_to_transfer_rpc.sql` (CREATE OR REPLACE FUNCTION avec `p_recap_id`)
- `lib/finance/budget-transfers.ts` — ajouter `recapId` au helper args
- `lib/recap/types.ts` — étendre `ProcessStep1Input` avec `recapId`
- `lib/recap/step1-persist.ts` — passer `input.recapId` au helper + à l'INSERT step 2.3.1
- `app/api/monthly-recap/process-step1/route.ts` — résoudre le recap actif et passer dans input
- `app/api/monthly-recap/{complete,balance,auto-balance}/route.ts` — same plumbing (couplé I6)
- `app/api/monthly-recap/process-step1/__tests__/route.integration.test.ts` — assert `monthly_recap_id` matches
- `lib/recap/__tests__/step1-persist.test.ts` — mock assertion sur le param

### Critères de succès

- Option choisie documentée dans CLAUDE.md §5 + §8
- Si option A : tous les `INSERT INTO budget_transfers` versionés dans le code applicatif passent `monthly_recap_id` non-NULL ; gated test caract vérifie via SELECT
- `pnpm verify` exit 0

---

## Axe 2 — `scripts/check-rpcs.mjs` ne pin pas la nouvelle RPC

### Symptôme

[scripts/check-rpcs.mjs](../scripts/check-rpcs.mjs) hardcode une liste de 4 RPCs C3 :

```javascript
const EXPECTED_RPCS = [
  'update_piggy_bank_amount',
  'update_bank_balance',
  'update_budget_cumulated_savings',
  'transfer_from_piggy_to_budget',
]
```

`transfer_with_savings_debit` (créée Sprint I5-followup-v2) est **absente**. Elle est couverte par `pnpm db:audit-functions` (audit générique `pg_proc` ↔ migrations) qui catch toute fonction non-versionnée. Mais elle n'est PAS dans le check pinné.

Conséquence : si quelqu'un (par accident ou pour une raison non-évidente) DROP `transfer_with_savings_debit` en prod, `db:check-rpcs` ne le détectera pas. Seul `db:audit-functions` le fera, et seulement si la migration de capture est aussi supprimée (sinon il dirait "présent en pg_proc" — mais il ne le serait pas).

Actually re-reading `audit-functions.mjs` : il vérifie chaque fonction `pg_proc` a un `CREATE` dans migrations. Si la fonction est dropped en prod, `pg_proc` n'a plus la fonction → `audit-functions` ne la liste pas → no error. Donc en effet, `audit-functions` ne catch PAS un DROP silencieux. Seul `check-rpcs` (qui pin une liste expected) le catcherait.

### Fix

Ajouter `'transfer_with_savings_debit'` à `EXPECTED_RPCS` dans [scripts/check-rpcs.mjs](../scripts/check-rpcs.mjs). 1 ligne.

### Critères de succès

- `pnpm db:check-rpcs` continue de pass exit 0
- Un DROP volontaire (en migration locale + apply-sql) déclenche exit 1

### Effort estimé

5 minutes. Trivial, mais cohérent avec le pattern C3.

---

## Axe 3 — Extension du pattern mocked-test aux autres orchestrateurs multi-RPC

### Observation

Sprint I5-followup-v2 a installé un pattern de test mocked non-gated pour `applyDecision` ([lib/recap/**tests**/step1-persist.test.ts](../lib/recap/__tests__/step1-persist.test.ts)) qui mock `vi.mock('@/lib/finance/*')` et asserte les call patterns. Le pattern est :

- Rapide (~1s pour 8 cas)
- Pas d'env var
- Pas de fixture DB
- Catch les paths d'erreur que les caract tests gated ratent

D'autres orchestrateurs multi-RPC dans le repo n'ont **aucun test** — uniquement des smoke browser tests manuels par le user :

1. **[lib/api/finance/expenses-add-with-logic.ts](../lib/api/finance/expenses-add-with-logic.ts)** — smart-allocation avec 3 chemins (tirelire → savings → budget), chacun avec un cleanup-attempt CRITIQUE préservé (L216, L229, L431). Aucun test mocked aujourd'hui. Cas à pinner : happy path tirelire-only ; cascade tirelire+savings ; cascade tirelire+savings+budget ; rollback failure path (vérifie que les cleanup-attempts firent dans le bon ordre).

2. **[app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts)** — 2 séquences distinctes (`handlePiggyBankAction` + `handleBudgetToPiggyBank`) chacune avec 2 RPCs séquentielles et une rollback compensatoire. Aucun test mocked. Pourrait être migré sur un nouveau RPC composite (`transfer_piggy_with_audit`?) — mais avant ça, lock le comportement actuel avec des tests.

3. **`lib/recap/step1-persist.ts:loadSnapshot`** — couvert indirectement par les caract gated mais pas directement testé. Avec le pattern mocked, on peut tester l'invariant "loadSnapshot lit exactement 3 tables (estimated_budgets, real_expenses, piggy_bank) et propage les erreurs DB en `throw new Error(...)`".

### Approche suggérée

Sprint dédié `Sprint Refactor-Test-Coverage` qui :

- Audit Phase 1 : grep `'@/lib/finance/'` imports dans `lib/` + `app/api/` pour identifier les orchestrateurs multi-RPC sans test mocked
- User arbitre : 2-3 modules cibles, 3-5 cas chacun
- Pattern: `vi.mock` hoisted + `__mocks` registry + dynamic import (mirror snapshots.test.ts + step1-persist.test.ts)

### Critères de succès

- Tests non-gated passent de 96 → ~115 (+15-20)
- Coverage des paths fail-soft / cleanup-attempt améliorée (mesurable via `pnpm test:coverage`)
- Lint baseline stable

### Effort estimé

1-2 sessions selon le scope final.

---

## Workflow recommandé

1. **Phase 1 — Investigation Axe 1** : grep cross-codebase pour les consumers de `budget_transfers.monthly_recap_id`, count des rows NULL en prod via apply-sql.mjs. Arbitrer A/B/C/D avec le user via AskUserQuestion.

2. **Phase 2 — Implémenter Axe 2** : 1 ligne dans `check-rpcs.mjs` + verif. À faire en tout premier (trivial, ferme une dette de consistency immédiatement).

3. **Phase 3 — Implémenter Axe 1** selon l'option choisie.

4. **Phase 4 — Axe 3** : séparer en sprint dédié si la session n'a plus de capacity. Audit + 1-2 modules.

5. Closeout CLAUDE.md §11 avec entrée Sprint Refactor-I5-followup-v3 ou nom approprié.

---

## Critères de succès globaux

- `pnpm verify` exit 0 à la fin
- Si Axe 1 option A : caract test gated `SUPABASE_RECAP_TESTS=1` 6/6 + assertion `monthly_recap_id` set
- Lint baseline ≤ 183 warnings
- Pas de nouveau `as unknown as SupabaseClient` (compteur reste à 0)
- `db:check-rpcs` pin la nouvelle RPC (Axe 2)

---

## Hors scope (à séparer)

- **Chantier I6** — extraction god file `complete/route.ts` ; bundle l'auto-balance atomicity fix avec celui-là plutôt qu'avec ce v4
- **Sprint Supabase-Strict-Types** — `RejectExcessProperties` strict typing dans `monthly-recap/*` (roadmap)
- **`amount_from_budget` default-0 audit** — affecte au-delà de process-step1, sprint dédié
- **Concurrency idempotency** — déjà documenté (D) Accept dans v2-followup ; ne pas réouvrir sans incident prod
- **Console log Lots 2/6** — roadmap I6
- **Dead-code purge `lib/auth.ts`** — orphelins `signUp`/`resetPassword`/`updatePassword` 0 consumer, sprint dédié

Avant de commencer : exécuter manuellement un récap mensuel cas 2 sur compte test (smoke v2) pour vérifier que le pattern actuel ne fail pas en prod. C'est aussi l'occasion de check si `budget_transfers.monthly_recap_id IS NULL` pour les rows produites par step 2.4.2 et 2.3.1.
