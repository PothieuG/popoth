# Prompt v8 — Sprint Atomicity-Savings v2 : fermer le gap atomicité sur `handlePiggyBankAction`

> ⚠️ **Prompt triagé 2026-05-12 — STALE, closed-by-deletion (Path B)**.
> Phase 1 audit cross-codebase a confirmé que les 3 action types (`set_piggy_bank` / `add_to_piggy_bank` / `remove_from_piggy_bank`) sont du dead code (0 consumer applicatif — seul `budget_to_piggy_bank` est appelé depuis SavingsDistributionDrawer.tsx, déjà atomique post-v7). Sprint Atomicity-Savings v2 livré 2026-05-12 par **deletion** de `handlePiggyBankAction` + TODO + dispatch + JSDoc + import unused (~−108 LOC) plutôt que par composite RPC + atomicity refactor (~5 commits, ~3h cargo cult). Précédents codebase alignés : Lot 5b status-test DELETE, Lot 5c testSupabaseConnection DELETE, Audit-Closeout C2/C3 5 items "design for hypothetical" refusés. Voir CLAUDE.md §11 entrée Sprint Atomicity-Savings v2 pour le détail.

> **Statut** : prompt rédigé en clôture du Sprint Atomicity-Savings (v7, livré 2026-05-12, score ~99.95). Le pattern composite RPC + helper TS + tests gated + réécriture du test mocked est désormais battle-tested **trois fois** (Sprint Refactor-I5-followup-v2 `transfer_with_savings_debit` + Sprint Atomicity-Expenses `add_expense_with_breakdown` + Sprint Atomicity-Savings `transfer_savings_between_budgets` / `transfer_budget_to_piggy_bank`). Le candidat suivant naturel — surfacé en **Phase 1 du Sprint v7** — est `handlePiggyBankAction` dans le même fichier, qui n'a JAMAIS été wiré sur l'existant `transfer_from_piggy_to_budget` ni adapté à la pattern composite.
>
> **Effort estimé** : ~5 commits, ~3h. Mirror exact du pattern v7. Scope marginalement plus large que v7 parce que 3 action types à supporter au lieu d'un seul, mais structurellement identique.

---

## Contexte

Le Sprint Atomicity-Savings (v7) a fermé 3 cleanup-attempts CRITIQUES dans [app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts) (`POST budget→budget` et `handleBudgetToPiggyBank`). En **Phase 1 audit Explore**, il a été constaté que `handlePiggyBankAction` (L150-244, action types `set_piggy_bank` / `add_to_piggy_bank` / `remove_from_piggy_bank`) **n'utilise PAS `transferFromPiggyToBudget`** (RPC C3 existante depuis Sprint 0). Au contraire, il fait un **SELECT-then-UPDATE/INSERT manuel non-atomique** :

```typescript
// L172-176 : SELECT current piggy_bank row
const { data: currentPiggyBank } = await supabaseServer
  .from('piggy_bank')
  .select('id, amount')
  .match(matchFilter)
  .maybeSingle()

const currentAmount = currentPiggyBank?.amount || 0

// L189-201 : switch on action → compute newAmount
let newAmount: number
switch (action) {
  case 'set_piggy_bank':
    newAmount = Math.max(0, amount)
    break
  case 'add_to_piggy_bank':
    newAmount = currentAmount + Math.max(0, amount)
    break
  case 'remove_from_piggy_bank':
    newAmount = Math.max(0, currentAmount - Math.max(0, amount))
    break
  default:
    return NextResponse.json({ error: `Action inconnue: ${action}` }, { status: 400 })
}

// L204-228 : UPDATE if row exists, else INSERT
if (currentPiggyBank) {
  const delta = newAmount - currentAmount
  newAmount = await updatePiggyBank(matchFilter, delta)  // RPC atomique sur le DELTA seulement
} else {
  await supabaseServer.from('piggy_bank').insert({ ...contextFilter, amount: newAmount, last_updated: ... })
}
```

### Race conditions latentes

Le pattern SELECT-then-WRITE laisse une fenêtre de race entre L176 (read currentAmount) et L207/L216 (write). Deux invocations concurrentes peuvent toutes les deux lire `currentAmount=100`, calculer `newAmount` indépendamment, puis se overwrite mutuellement :

| Scénario                 | Action                  | currentAmount read | amount param | newAmount computed | Effect                                                             |
| ------------------------ | ----------------------- | ------------------ | ------------ | ------------------ | ------------------------------------------------------------------ |
| **Concurrent set + set** | `set_piggy_bank` × 2    | 100, 100           | 200, 300     | 200, 300           | "Lost update" — un des 2 settings est écrasé silently              |
| **Concurrent add + add** | `add_to_piggy_bank` × 2 | 100, 100           | +50, +30     | 150, 130           | Final = 130 ou 150 (race), **+50 ou +30 est perdu** au lieu de +80 |
| **Concurrent set + add** | `set` 200 puis `add` 50 | 100, 100           | 200, 50      | 200, 150           | Race : final pourrait être 150 si add écrit après set              |

Pour `add_to_piggy_bank` et `remove_from_piggy_bank`, le bug est particulièrement subtil parce que la RPC `updatePiggyBank(matchFilter, delta)` est elle-même atomique sur le DELTA — mais le `delta = newAmount - currentAmount` est calculé depuis le `currentAmount` lu en L172 (non-locked). Sous concurrence, le delta ne reflète pas l'état actuel à l'instant de l'UPDATE.

Pour `set_piggy_bank`, le bug est encore pire : le `delta` n'a pas de sens sémantique (on veut une valeur absolue), donc en pratique le code écrit le `delta` qui peut surcompenser ou sous-compenser.

### INSERT path : pas de UPSERT atomique

Quand `currentPiggyBank` est `null` (piggy n'existe pas encore), le code fait un INSERT direct (L216-220). Si **2 invocations concurrentes** arrivent simultanément pour un user qui n'a pas encore de piggy, les 2 INSERTs peuvent fail le partial unique index (`idx_piggy_bank_profile_id_unique`) — l'un des 2 retourne 500, l'autre crée la row. **Pas de gap d'argent**, mais l'UX est cassée (un utilisateur reçoit un 500 spurious).

### Pas de cleanup-attempts à regression-guarder

Contrairement à v7 où les 3 cleanup-attempts L122/L321/L337 étaient regression-guardés par Sprint Refactor-Test-Coverage, **il n'existe AUCUN test sur `handlePiggyBankAction`** (audit confirmé Phase 1 v7). Donc pas de REGRESSION-GUARD à reformuler en PIN — c'est greenfield au niveau test mocked.

### Pattern de référence éprouvé (3 sprints précédents)

- Sprint Refactor-I5-followup-v2 — `transfer_with_savings_debit` (INSERT + debit)
- Sprint Atomicity-Expenses — `add_expense_with_breakdown` (2 debits + INSERT)
- **Sprint Atomicity-Savings (v7)** — `transfer_savings_between_budgets` (2 debits) + `transfer_budget_to_piggy_bank` (debit + UPSERT)

Tous suivent : SECURITY DEFINER + SET search_path + REVOKE/GRANT + NOTIFY pgrst, validation XOR, PERFORM des RPC existantes pour les UPDATE de colonnes contraintes, INSERT direct dans la même tx.

---

## Outcome attendu

- **1 nouvelle RPC composite** `set_piggy_bank_amount(p_action, p_amount, p_profile_id?, p_group_id?)` (ou 2-3 RPCs séparées selon Q1 ci-dessous) qui consolide les 3 action types en un seul appel atomique avec UPSERT sur la partial unique index.
- **1 helper TS** dans [lib/finance/savings.ts](../lib/finance/savings.ts) (extension du module créé en v7) ou nouveau fichier `lib/finance/piggy-actions.ts`.
- **Refactor de [app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts)** : `handlePiggyBankAction` (L150-244, ~95 LOC) remplacé par un appel atomique à `setPiggyBankAmount(filter, {action, amount})`. Le TODO comment au L141-148 est supprimé. **Net : −~60 LOC**.
- **6-8 nouveaux tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1`** dans `lib/finance/__tests__/piggy-actions.test.ts` (ou extension de `transfer-savings.test.ts`) : happy paths × 3 action types × 2 paths (UPDATE/INSERT) + atomicity invariant (`set_piggy_bank` clamps à 0 sur négatif), + **100× concurrent `add_to_piggy_bank` invariant** (CRITIQUE — c'est la preuve principale que le gap est fermé : 100 ajouts de +1 sur piggy=0 doivent converger à exactement 100, pas une valeur < 100 par lost updates).
- **3-6 nouveaux tests mocked** dans [app/api/savings/transfer/\_\_tests\_\_/route.test.ts](../app/api/savings/transfer/__tests__/route.test.ts) : 1 par action type happy + au moins 1 PIN ATOMIC CONTRACT (single-call-site invariant + no manual SELECT-then-UPDATE/INSERT in handler).
- **Wiring CI** : `EXPECTED_RPCS` 8 → 9 (ou 10/11 si Q1 répond "multiple RPCs").
- **CLAUDE.md mise à jour** : §1 score ~99.95 → ~99.98, §8 nouveau bullet + retrait de l'exception "out of scope" dans le bullet Sprint Atomicity-Savings, §11 nouvelle entrée.
- **Suppression du TODO comment** au top de `handlePiggyBankAction` (L141-148).

---

## Phase 1 — Investigation (Explore agent, 1 passe)

```
Tâches :
1. Confirmer file:line du handlePiggyBankAction post-Sprint Atomicity-Savings.
   La Phase 1 v7 a mesuré L150-244 (95 LOC). Vérifier que ces lignes n'ont
   pas drifté par lint-staged Prettier ou par les commits post-v7.

2. Lire intégralement L150-244 + analyser :
   - Les 3 action types et leurs sémantiques (set / add / remove).
   - L'usage de `updatePiggyBank` (RPC existante, delta-based, ne crée
     pas de row).
   - La gestion `if (currentPiggyBank) UPDATE else INSERT`.
   - La logique `Math.max(0, ...)` qui plafonne à 0 sur négatif (à
     préserver dans la nouvelle RPC).

3. Lire intégralement la migration v7 [20260518000000_create_savings_transfer_rpcs.sql]
   pour copier le pattern SQL (notamment le UPSERT avec partial unique
   index inference).

4. Lire lib/finance/savings.ts (helpers v7) pour copier la signature TS.

5. Lire lib/finance/__tests__/transfer-savings.test.ts (gated v7) pour
   copier le pattern de FK-safe cleanup cascade + chunked concurrency
   + ensurePiggyExists/ensurePiggyMissing helpers.

6. Confirmer EXPECTED_RPCS = 8 dans scripts/check-rpcs.mjs (post-v7).

7. Vérifier si `transferFromPiggyToBudget` (Sprint 0 / C3 existante)
   peut servir comme building block. Hypothèse : NON parce qu'elle
   transfère piggy → un budget, pas piggy → user-set-value. Mais
   confirmer en lisant la signature.

8. Audit consumers cross-codebase de POST /api/savings/transfer avec
   action: 'set_piggy_bank' | 'add_to_piggy_bank' | 'remove_from_piggy_bank' :
   grep dans components/, hooks/, app/ pour identifier les frontends
   qui appellent ces 3 actions. Confirme l'impact UX réel + le
   smoke browser path pour la verif end-to-end.

Rapport <= 400 mots.
```

---

## Phase 2 — Arbitrage user (AskUserQuestion)

**Q1 — Découpage RPC** :

- **(A) 1 RPC paramétrée `set_piggy_bank_amount(p_action, p_amount, ...)` (Recommended)** — un seul appel, switch interne sur `p_action`. EXPECTED_RPCS 8 → 9. Cohérent avec l'API actuelle (1 endpoint, 3 actions). Surface de test simple (1 helper TS, 1 RPC à pinner).
- (B) 3 RPCs séparées `set_piggy_bank_to_amount` / `increment_piggy_bank` / `decrement_piggy_bank` — atomique également, mais EXPECTED_RPCS 8 → 11, plus de surface de test fine-grain au prix d'un helper TS plus volumineux.
- (C) Reuse `update_piggy_bank_amount` (existante C3) pour `add_to_piggy_bank` et `remove_from_piggy_bank` (delta-based), nouvelle RPC `set_piggy_bank_amount` (absolute value) seulement pour `set_piggy_bank`. **Caveat critique** : `update_piggy_bank_amount` raise si la row n'existe pas — donc on perd l'UX "première fois je crée ma piggy en faisant `add_to_piggy_bank`". Il faut un fallback INSERT, ce qui re-introduit le pattern non-atomique. Probablement à éviter.

**Q2 — UPSERT piggy_bank** :

- **(A) `INSERT ... ON CONFLICT DO UPDATE` dans la nouvelle RPC (Recommended)** — identique au pattern v7 `transfer_budget_to_piggy_bank` : branche `IF p_profile_id IS NOT NULL THEN ... ELSE ...` avec les 2 partial unique index predicates. Atomique single-statement.
- (B) PERFORM existing `update_piggy_bank_amount` puis fallback INSERT pour le cas no-row — mais plus complexe et la sémantique de `set_piggy_bank` (valeur absolue) ne mappe pas bien sur `update_piggy_bank_amount` (delta-based).

**Q3 — `Math.max(0, ...)` côté SQL vs côté TS** :

- **(A) Déplacer la clamping côté SQL (RPC) (Recommended)** — la nouvelle RPC interprète `p_action` et applique la clamping. Sémantique cohérente : SQL garantit que `amount >= 0` post-op (la CHECK constraint `piggy_bank.amount >= 0` raise sur overdraft pour `remove_from_piggy_bank` excessif). Le helper TS et le frontend n'ont pas à se soucier de la clamping.
- (B) Garder la clamping côté TS (helper wrapper compute → passe absolute value à une RPC plus dumb). Plus de roundtrips ; à éviter.

**Q4 — Frontend impact** :

- Confirmer que le frontend appelle POST `/api/savings/transfer` avec body `{ action, amount }` et reçoit `{ success, action, previous_amount, new_amount, difference, context }`. La response shape **doit être préservée verbatim** dans le refactor (pas de breaking change consumer-side).
- Confirmer le `Math.max(0, ...)` post-op : si l'utilisateur envoie `remove_from_piggy_bank` avec `amount=200` sur une piggy à 50, le code actuel return `new_amount=0, difference=-50` (succès silencieux avec partial). La nouvelle RPC doit-elle ?
  - **(A) Préserver le comportement actuel (succès partial, clamp à 0) (Recommended)** — backward compat strict.
  - (B) Raise sur overdraft (CHECK constraint level), retourner 400 au lieu de succès partial. Plus rigoureux mais peut casser des consumers UI qui attendent un succès.

**Q5 — Découpage commits** : mirror v7 (5 commits — migration / helper / handler refactor + test mocked / gated tests / closeout).

---

## Phase 3 — Implémentation (5 commits)

### Commit 1 — Migration SQL

Nouveau fichier `supabase/migrations/<YYYYMMDDHHMMSS>_create_set_piggy_bank_amount_rpc.sql`. Pattern strict miroir de [20260518000000_create_savings_transfer_rpcs.sql](../supabase/migrations/20260518000000_create_savings_transfer_rpcs.sql).

**RPC — `set_piggy_bank_amount(p_action, p_amount, p_profile_id?, p_group_id?)`**

```sql
CREATE OR REPLACE FUNCTION set_piggy_bank_amount(
  p_action text,
  p_amount numeric,
  p_profile_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_amount numeric;
  v_new_amount numeric;
BEGIN
  -- Validations
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be non-negative (got %)', p_amount;
  END IF;
  IF (p_profile_id IS NULL AND p_group_id IS NULL)
     OR (p_profile_id IS NOT NULL AND p_group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_profile_id or p_group_id must be provided';
  END IF;
  IF p_action NOT IN ('set_piggy_bank', 'add_to_piggy_bank', 'remove_from_piggy_bank') THEN
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  -- UPSERT with partial unique index inference (branch on ownership).
  -- The INSERT path uses p_amount directly for 'set' and 'add', or 0 for
  -- 'remove' (no-op since no row exists yet, but preserve UX semantics).
  IF p_profile_id IS NOT NULL THEN
    INSERT INTO piggy_bank (profile_id, amount, last_updated)
    VALUES (
      p_profile_id,
      CASE
        WHEN p_action = 'set_piggy_bank' THEN p_amount
        WHEN p_action = 'add_to_piggy_bank' THEN p_amount
        WHEN p_action = 'remove_from_piggy_bank' THEN 0   -- new row, can't remove from nothing
      END,
      NOW()
    )
    ON CONFLICT (profile_id) WHERE (profile_id IS NOT NULL AND group_id IS NULL) DO UPDATE
      SET amount = CASE
        WHEN p_action = 'set_piggy_bank' THEN GREATEST(0, p_amount)
        WHEN p_action = 'add_to_piggy_bank' THEN piggy_bank.amount + p_amount
        WHEN p_action = 'remove_from_piggy_bank' THEN GREATEST(0, piggy_bank.amount - p_amount)
      END,
          last_updated = NOW()
    RETURNING amount INTO v_new_amount;
  ELSE
    -- Same INSERT/UPDATE branch for group-owned piggy
    INSERT INTO piggy_bank (group_id, amount, last_updated)
    VALUES (p_group_id, CASE ... END, NOW())
    ON CONFLICT (group_id) WHERE (group_id IS NOT NULL AND profile_id IS NULL) DO UPDATE
      SET amount = CASE ... END,
          last_updated = NOW()
    RETURNING amount INTO v_new_amount;
  END IF;

  RETURN json_build_object(
    'previous_amount', v_current_amount,
    'new_amount', v_new_amount,
    'action', p_action
  );
END;
$$;

REVOKE ALL ON FUNCTION set_piggy_bank_amount(text, numeric, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_piggy_bank_amount(text, numeric, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
```

**Note clé** : la version atomique change subtilement la sémantique du `previous_amount` retourné. Pour le frontend qui affiche un toast "Tirelire mise à jour : 100€ → 150€", il faudra **soit** :

- (a) Lire le `previous_amount` avant l'UPSERT via une `SELECT` séparée à l'intérieur de la RPC (lock-friendly via `FOR UPDATE`), retourner les deux dans le `json_build_object`.
- (b) Recalculer `previous_amount = new_amount - difference` côté handler à partir de `new_amount` retourné et `amount` request param (NON applicable à `set_piggy_bank` où `difference != amount`).

Option (a) recommandée. Pattern :

```sql
SELECT amount INTO v_current_amount
  FROM piggy_bank
 WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id AND group_id IS NULL)
    OR (p_group_id IS NOT NULL AND group_id = p_group_id AND profile_id IS NULL)
   FOR UPDATE;
v_current_amount := COALESCE(v_current_amount, 0);
```

Puis le UPSERT comme ci-dessus. Le `FOR UPDATE` lock-fence le SELECT au sein de la tx, donc concurrent invocations sérialisent.

**Apply workflow** identique v7 : `apply-sql.mjs` + `migration repair` + baseline re-export + `pnpm db:audit-functions` 14/14 versionnées.

### Commit 2 — Helper TS + types regen

Soit étendre `lib/finance/savings.ts` (renommer le module en `lib/finance/savings-and-piggy.ts` ? — out of scope, garder `savings.ts`) avec :

```typescript
export type PiggyBankAction = 'set_piggy_bank' | 'add_to_piggy_bank' | 'remove_from_piggy_bank'

export async function setPiggyBankAmount(
  filter: ContextFilter,
  args: { action: PiggyBankAction; amount: number },
): Promise<{ previous_amount: number; new_amount: number; action: PiggyBankAction }> {
  const { profile_id, group_id } = resolveContextIds(filter)
  const { data, error } = await supabaseServer.rpc('set_piggy_bank_amount', {
    p_action: args.action,
    p_amount: args.amount,
    p_profile_id: profile_id,
    p_group_id: group_id,
  })
  if (error) throw error
  return data as { previous_amount: number; new_amount: number; action: PiggyBankAction }
}
```

Regen `pnpm db:types`, vérifier la nouvelle RPC dans `lib/database.types.ts`. `pnpm db:check-types-fresh` exit 0.

### Commit 3 — Refactor route handler + extend mocked test

[app/api/savings/transfer/route.ts](../app/api/savings/transfer/route.ts) :

- **`handlePiggyBankAction` L150-244** : drop L160-228 (95 LOC) — drop le SELECT + switch + UPDATE/INSERT branches. Remplace par un seul `setPiggyBankAmount(filter, {action, amount})` dans try/catch. Drop le TODO comment L141-148.
- **Response shape préservée verbatim** : `{ success, action, previous_amount, new_amount, difference, context }`. `difference = new_amount - previous_amount` calculé côté handler depuis la response RPC.
- **Net : −~70 LOC** (95 LOC enlevées + 25 LOC d'helper call).
- Le `updatePiggyBank` import dans le top du file devient unused — drop.

Test rewrite [app/api/savings/transfer/\_\_tests\_\_/route.test.ts](../app/api/savings/transfer/__tests__/route.test.ts) — ajout d'un nouveau `describe` block `POST /api/savings/transfer — handlePiggyBankAction` avec ~4 cas :

- Happy `set_piggy_bank` (piggy exists, value clamps to 0 on negative)
- Happy `add_to_piggy_bank` (piggy missing → INSERT path)
- Happy `remove_from_piggy_bank` (clamp à 0 sur overdraft)
- PIN ATOMIC CONTRACT : RPC throws → 500, **`supabase.update().eq()` NOT called + `supabase.insert` NOT called** (single mutation entry point, no SELECT-then-WRITE)

Mock : ajouter `setPiggyBankAmount` au mock `@/lib/finance/savings`.

### Commit 4 — Gated atomicity tests

Soit étendre `lib/finance/__tests__/transfer-savings.test.ts` (3e `describe` block) **ou** créer un nouveau fichier `lib/finance/__tests__/piggy-actions.test.ts`. Recommandation : extension du fichier v7 pour réutiliser le seed et amortir le test startup (~6s actuels).

**6-8 cas** :

1. Happy `set_piggy_bank` UPDATE path (piggy exists, set to 50 → amount=50)
2. Happy `set_piggy_bank` INSERT path (piggy missing, set to 30 → INSERT row amount=30)
3. Happy `add_to_piggy_bank` UPDATE path (piggy=10, add 30 → amount=40)
4. Happy `add_to_piggy_bank` INSERT path (piggy missing, add 30 → INSERT amount=30)
5. Happy `remove_from_piggy_bank` clamp à 0 (piggy=10, remove 50 → amount=0, no error)
6. **CRITIQUE — 100× concurrent `add_to_piggy_bank` avec piggy=0 amount=1** chunked 10×10 → **piggy converge à exactement 100 (preuve atomicity, pre-fix pourrait perdre des increments par lost-update SELECT-then-WRITE race)**
7. (Optionnel) XOR violation
8. (Optionnel) Unknown action → RPC raises

**Cas 6 est le test de référence** — sans atomicity, on observerait piggy < 100 (typiquement ~50-80 selon le scheduling) parce que les SELECTs concurrents lisent la même valeur stale.

### Commit 5 — Closeout

- `scripts/check-rpcs.mjs` : `EXPECTED_RPCS` 8 → **9** (ajouter `set_piggy_bank_amount`).
- CLAUDE.md :
  - §1 score `~99.95 → ~99.98`.
  - §4 inventory : ajouter la nouvelle migration `20260519000000_create_set_piggy_bank_amount_rpc.sql`.
  - §8 ✅ "À faire" : ajouter un bullet — "Pour toute manipulation absolue de `piggy_bank.amount` (`set` / `add` / `remove`) : utiliser `setPiggyBankAmount` depuis `lib/finance/savings.ts` (Sprint Atomicity-Savings v2)..."
  - §8 ❌ "Ne pas réintroduire" : retirer l'exception "out of scope `handlePiggyBankAction` reste sur SELECT-then-UPDATE/INSERT manuel" — c'est maintenant fixé.
  - §9 Tests : ajouter l'entrée pour les nouveaux cas gated.
  - §11 Roadmap : nouvelle entrée Sprint Atomicity-Savings v2 entre v7 Atomicity-Savings et "Chantier I6".

---

## Critères de succès

- 1 nouvelle RPC composite déployée prod, présente dans `pg_proc`, pinnée dans `EXPECTED_RPCS=9`.
- `handlePiggyBankAction` post-refactor ≤ 35 LOC (vs 95 actuel). Le `updatePiggyBank` import top-of-file disparaît.
- 6-8 nouveaux cas gated prouvent l'atomicité, notamment le **100× concurrent `add_to_piggy_bank`** qui converge à exactement 100 (pre-fix race lost-update aurait converge à <100).
- `pnpm verify` exit 0 (typecheck + tests + 6 db checks + 9/9 RPCs pinned).
- 0 typecheck/lint regression, lint baseline 183 stable.
- Test mocked `route.test.ts` étendu (3e `describe` block ~4 cas) avec PIN ATOMIC CONTRACT.
- Le TODO comment au top de `handlePiggyBankAction` est supprimé.

---

## Hors scope (à séparer)

- **`auto-balance/route.ts` reversed RPC→INSERT pattern** — couplé chantier I6 (extraction god file `complete/route.ts` + 4 globals carryover).
- **`monthly-recap/transfer/route.ts`** — pattern UI manual transfer body-driven.
- **Lot 6 console.log cleanup** + activation globale `no-console: 'error'` — roadmap I4/I5/I6.
- **Migration vers `withCompensatingRollback()` abstraction** — toujours prématuré tant que <5 sites repo-wide (après ce sprint il en restera 1 = `auto-balance`, sous le seuil).
- **Renommage `lib/finance/savings.ts` → `lib/finance/savings-and-piggy.ts`** — abstraction prématurée, garder le module v7 tel quel.

---

## Notes opérationnelles

- **Pattern strict mirror** du Sprint Atomicity-Savings v7 (commits `b1efbe5` → `8743f0c`). Tout ce sprint v8 mirror exact ce template.
- **Apply via `apply-sql.mjs`**, pas `db push` — migration `CREATE OR REPLACE FUNCTION` idempotente. Suivre `pnpm supabase migration repair --status applied <ts>` pour éviter drift C3.
- **UPSERT branch pattern** (deja éprouvé v7) : `IF p_profile_id IS NOT NULL THEN ... ON CONFLICT (profile_id) WHERE (...) ... ELSE ... ON CONFLICT (group_id) WHERE (...) ... END IF`. Postgres exige que le `WHERE` du `ON CONFLICT` matche exactement le predicate du partial unique index (sinon inference fail).
- **`FOR UPDATE` lock dans la RPC** : crucial pour le test concurrent. Sans `FOR UPDATE`, le SELECT pre-read n'est pas verrouillé et 2 RPCs concurrents lisent la même valeur → lost update sur la branch ON CONFLICT DO UPDATE. Le UPSERT lui-même sérialise (Postgres row-lock), mais la valeur `v_current_amount` retournée pour `previous_amount` ne serait pas garantie cohérente avec le `v_new_amount` post-UPSERT sans le `FOR UPDATE`. Si tu mesures ce gap subtil au moment d'écrire le cas concurrent, c'est exactement la raison.
- **Réponse shape contract** : le frontend (cf. `components/dashboard/SavingsDistributionDrawer.tsx`) attend `{ success, action, previous_amount, new_amount, difference, context }`. Le `difference = new_amount - previous_amount` est calculé côté handler post-RPC, **pas** par la RPC (pour découpler clearly request shape vs SQL ABI).
- **Smoke browser** : tester chacune des 3 actions depuis `/dashboard` → SavingsDistributionDrawer. Le 100× concurrent invariant n'est pas reproductible manuellement.
