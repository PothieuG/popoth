# Fix C3 — Race conditions sur `piggy_bank`, `bank_balance`, `cumulated_savings` (RPC atomiques)

> ⚠️ **Prompt triagé 2026-05-11 — STALE, ne pas exécuter**
>
> C3 a été livré au Sprint 0 (commit `20260506000000_create_finance_rpcs.sql`). Les 4 RPCs atomiques sont en prod, les helpers `lib/finance/*` couvrent tous les call sites (0 SELECT-then-UPDATE résiduel sur `piggy_bank.amount` / `bank_balances.balance` / `estimated_budgets.cumulated_savings`), 5 tests de concurrence gated `SUPABASE_RPC_CONCURRENCY_TESTS=1`, et `pnpm db:check-rpcs` pin la présence en CI weekly + PR-time.
>
> Voir CLAUDE.md §7 "Fait (Sprint 0)" + §8 obligation helpers + §11 entrée Sprint 0 + §11 entrée Sprint Audit-Closeout C3 pour le détail.

## Contexte

L'application Popoth présente un **bug "lost update" classique** sur tous les champs financiers cumulatifs. Le pattern actuel est :

```ts
// lib/expense-allocation.ts:71-87
const { data: piggyData } = await supabaseServer
  .from('piggy_bank')
  .select('amount')
  .match(contextFilter)
  .maybeSingle()
const currentPiggy = piggyData?.amount || 0
const { error } = await supabaseServer
  .from('piggy_bank')
  .update({ amount: currentPiggy + piggyToRestore })
  .match(contextFilter)
```

Avec deux requêtes simultanées :

```
T0  : tirelire = 1000 €
T1  : Req A lit  → 1000
T2  : Req B lit  → 1000
T3  : Req A écrit → 1100
T4  : Req B écrit → 1200
État réel : 1200, attendu : 1300 → 100 € perdus silencieusement.
```

C'est **inacceptable** pour une application financière. Probabilité d'occurrence en 100 % en groupe (deux membres ajoutent une dépense en même temps, contextFilter identique) ou en PWA (retry après reconnexion).

L'objectif est de remplacer **tous** les patterns SELECT-then-UPDATE sur les champs cumulatifs par des **RPC PostgreSQL atomiques** (`UPDATE … SET amount = amount + delta` qui est garanti atomique par PostgreSQL).

## Fichiers à analyser en priorité

- [lib/expense-allocation.ts](lib/expense-allocation.ts) — lignes 71-87 (reverse), 124-159 (apply), 91-111 (cumulated_savings)
- [app/api/monthly-recap/process-step1/route.ts](app/api/monthly-recap/process-step1/route.ts) — ~232-242
- [app/api/monthly-recap/auto-balance/route.ts](app/api/monthly-recap/auto-balance/route.ts) — à grep
- [app/api/monthly-recap/accumulate-piggy-bank/route.ts](app/api/monthly-recap/accumulate-piggy-bank/route.ts) — à grep
- [app/api/savings/transfer/route.ts](app/api/savings/transfer/route.ts) — à grep
- [app/api/bank-balance/route.ts](app/api/bank-balance/route.ts) — vérifier delta vs SET
- [docs/audit/07-deep-dive-piggy-bank-race.md](docs/audit/07-deep-dive-piggy-bank-race.md) — playbook complet avec SQL prêt à coller
- `supabase/migrations/` — destination des migrations (créer le dossier si absent)

## Objectifs précis

1. **Audit exhaustif** :
   - Exécuter `grep -rn "piggy_bank\|bank_balance\|cumulated_savings" app/api/ lib/ --include="*.ts"`.
   - Lister tous les sites SELECT-then-UPDATE dans un fichier `docs/audit/race-condition-sites.md`.
2. **Migration SQL** :
   - Créer `supabase/migrations/<timestamp>_create_finance_rpcs.sql` contenant les 4 RPC :
     - `update_piggy_bank_amount(p_user_id, p_group_id, p_delta)` retournant `numeric` (le nouveau montant).
     - `update_budget_cumulated_savings(p_budget_id, p_delta)` retournant `numeric`.
     - `update_bank_balance(p_user_id, p_group_id, p_delta)` retournant `numeric`.
     - `transfer_from_piggy_to_budget(p_user_id, p_group_id, p_budget_id, p_amount)` retournant `json`.
   - Code SQL exact dans [docs/audit/07-deep-dive-piggy-bank-race.md](docs/audit/07-deep-dive-piggy-bank-race.md) (sections RPC 1-4).
   - **Sécurité** :
     - `LANGUAGE plpgsql SECURITY DEFINER`.
     - `REVOKE ALL ON FUNCTION ... FROM PUBLIC`.
     - `GRANT EXECUTE TO service_role`.
   - **Validations** : `RAISE EXCEPTION` si row introuvable ou si le résultat deviendrait négatif.
3. **Application de la migration** :
   - Si Supabase CLI installée : `pnpm dlx supabase migration up`.
   - Sinon, exécuter manuellement sur l'instance via dashboard SQL Editor.
   - Vérifier la création via `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace`.
4. **Helpers TypeScript** :
   - Créer `lib/finance/piggy-bank.ts` exportant `updatePiggyBank(context: ContextFilter, delta: number): Promise<number>`.
   - Créer `lib/finance/bank-balance.ts` exportant `updateBankBalance(context, delta)`.
   - Créer `lib/finance/budget-savings.ts` exportant `updateBudgetCumulatedSavings(budgetId, delta)`.
   - Créer `lib/finance/transfers.ts` exportant `transferFromPiggyToBudget(context, budgetId, amount)`.
   - Chaque helper appelle `supabaseServer.rpc(...)` et lève l'erreur en cas d'échec.
5. **Migration des sites d'appel** :
   - Pour chaque site identifié à l'étape 1, remplacer le pattern SELECT-then-UPDATE par l'appel au helper correspondant.
   - Exemple :
     ```ts
     // Avant
     const { data } = await supabaseServer
       .from('piggy_bank')
       .select('amount')
       .match(filter)
       .maybeSingle()
     await supabaseServer
       .from('piggy_bank')
       .update({ amount: (data?.amount || 0) + delta })
       .match(filter)
     // Après
     const newAmount = await updatePiggyBank(filter, delta)
     ```
   - Préserver le `try/catch` existant ; l'helper rethrow l'erreur.
6. **Tests unitaires des helpers** :
   - `lib/finance/__tests__/piggy-bank.test.ts` : mock `supabaseServer.rpc`, vérifier les paramètres passés et la gestion des erreurs.
   - Idem pour les 3 autres helpers.
7. **Tests d'intégration concurrence** :
   - Sur Supabase local (ou instance de test), créer `lib/finance/__tests__/piggy-bank.integration.test.ts` :
     - Initialiser `piggy_bank.amount = 1000`.
     - Lancer 100 incréments simultanés via `Promise.all`.
     - Vérifier que la valeur finale est exactement `1100`.
     - Tester un mix incréments/décréments.
     - Tester le rejet si le solde deviendrait négatif.
8. **Reconciliation** :
   - Optionnel mais recommandé : créer la vue SQL `v_piggy_bank_expected` (cf. section "Backfill et reconciliation" du deep dive).
   - Documenter dans `docs/audit/RECONCILIATION.md` la procédure pour détecter et corriger les drifts historiques.
9. **Documentation** :
   - Mettre à jour `CLAUDE.md` section "Sécurité financière" : ajouter "jamais de SELECT+UPDATE sur piggy_bank/bank_balance/cumulated_savings — utiliser les helpers `lib/finance/*`".
   - Créer un ADR `docs/adr/0002-atomic-finance-rpcs.md` documentant la décision.

## Contraintes techniques

- PostgreSQL 15+ (Supabase managed). Vérifier la disponibilité de `RAISE EXCEPTION` et `RETURNING`.
- **`SECURITY DEFINER`** obligatoire pour bypass RLS — donc auditer chaque RPC pour s'assurer que les paramètres sont correctement validés (impossibilité de cross-tenant).
- Format réponse RPC : `numeric` pour les updates simples, `json` pour les transferts (multi-valeurs).
- **Compat helper** : si un site d'appel attend un `boolean` ou `void`, le helper TypeScript doit s'adapter.
- Les helpers doivent être **server-only** (utilisent `supabaseServer` avec service role). Ne pas les importer depuis un Client Component.
- Migration **idempotente** : utiliser `CREATE OR REPLACE FUNCTION`.
- Rollback possible : prévoir un fichier `down.sql` (`DROP FUNCTION IF EXISTS ...`).

## Critères de validation

- `pnpm typecheck && pnpm lint:check && pnpm build` passent.
- `grep -rn "from('piggy_bank').*update" lib/ app/` ne renvoie plus rien.
- `grep -rn "from('bank_balance').*update" lib/ app/` ne renvoie plus rien (sauf si SET pur, à valider).
- `grep -rn "from('estimated_budgets').*cumulated_savings" lib/ app/` ne pointe plus vers du SELECT-then-UPDATE.
- `pnpm test lib/finance/__tests__/piggy-bank` passe.
- Test concurrence : 100 incréments simultanés convergent vers la valeur attendue.
- Test régression : RPC rejette une décrémentation qui rendrait le solde négatif.
- Smoke test en staging : ajout dépense → vérifier que `piggy_bank.amount` est correctement mis à jour.
- Vue `v_piggy_bank_expected` ne révèle pas de drift > 0.01 € sur les utilisateurs de test.

## Instructions pour Claude Code

- **Lire** [docs/audit/07-deep-dive-piggy-bank-race.md](docs/audit/07-deep-dive-piggy-bank-race.md) intégralement.
- **Confirmer avec l'utilisateur** avant d'appliquer la migration en prod (cette étape est destructive si mal exécutée).
- Découper en **6 commits** :
  1. `docs(audit): list race condition sites`
  2. `feat(supabase): add atomic finance RPCs migration`
  3. `feat(finance): add typescript helpers for atomic updates`
  4. `fix(finance): migrate piggy_bank/bank_balance/cumulated_savings to RPCs`
  5. `test(finance): cover atomic helpers + concurrency integration`
  6. `docs: ADR + CLAUDE.md update on atomic finance writes`
- **Tester** la migration en local avant de la pousser. Utiliser `supabase db reset` + `supabase migration up` pour valider.
- **Ne pas appliquer** en prod sans :
  - Tests passants en staging.
  - Snapshot DB préalable (`pg_dump` ou export Supabase).
  - Confirmation utilisateur explicite.
- **Conserver** le `try/catch` autour de chaque appel à un helper. L'erreur métier (solde négatif) doit être traduite en erreur 400 ou 422 selon le cas.
- **Ne pas mettre** la `service_role_key` dans une variable d'env loggée. Vérifier qu'aucun log `logger.debug(...)` ne contient la key.
