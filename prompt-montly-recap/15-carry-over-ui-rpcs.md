# [15] — Carry-over UI : badge + long-press flip + delete-to-piggy + filter financial-data

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — post-recap, les transactions non-validées sont reportées sur le dashboard du mois suivant avec un badge, hors calculs, et peuvent être re-validées (long-press) ou supprimées (DELETE expense → piggy crédité).
- Position dans la séquence : étape 15/17
- Dépend de : 02 (colonnes is_carried_over + carried_from_recap_id), 08 (finalize set is_carried_over)
- Débloque : 16 (read-only rows), 17 (E2E tests dashboard post-recap)

## Objectif
Étendre [components/dashboard/TransactionListItem.tsx](../components/dashboard/TransactionListItem.tsx) pour : (a) afficher badge "Mois précédent" si `is_carried_over=true`, (b) long-press flip `is_carried_over=false` ET `applied_to_balance_at=now()` en 1 RPC atomique, (c) DELETE de carried-over expense → piggy crédité du montant via nouvelle RPC atomique. Adapter `getProfile/GroupFinancialData` pour FILTRER les is_carried_over=true des calculs.

## Fichiers concernés
- `components/dashboard/TransactionListItem.tsx` — à modifier (badge + actions adaptées)
- `lib/finance/financial-data.ts` — à modifier (filter is_carried_over=true des sums)
- `lib/finance/applied-balance.ts` — à étendre (nouvelle action `toggleAndUncarry`)
- `lib/finance/carry-over.ts` — à créer (wrapper RPCs `delete_carried_expense_to_piggy` + helper queries)
- `supabase/migrations/<TS>_create_carry_over_rpcs.sql` — à créer (2 nouvelles RPCs)
- `scripts/check-rpcs.mjs` — étendre `EXPECTED_RPCS` (16 → 18)
- `hooks/useRealExpenses.ts` + `hooks/useRealIncomes.ts` — à modifier (delete et toggle handlers gèrent carry-over)
- CLAUDE.md §5.5 — MAJ EXPECTED_RPCS

## Patterns et conventions à respecter
- **RPCs atomiques** : pas de séquence non-atomique pour les actions impliquant 2 tables. Une RPC composite par action.
- **Long-press flip semantic** : "valider une transaction reportée" = la transaction redevient normal mois en cours. Donc 2 changements : `is_carried_over → false` + `applied_to_balance_at → now()`. Atomic via RPC.
- **DELETE carried expense → piggy** : seul comportement spécifique aux dépenses. Pour les revenus carry-over, DELETE = pur retrait (no piggy impact). Cf. user response sur question 3.
- **Filter dans `getProfile/GroupFinancialData`** : `WHERE is_carried_over = false` dans les SELECT de real_expenses et real_income_entries (pour totalRealExpenses, totalRealIncome, et spent_by_budget).
- **Badge visuel** : pattern shadcn Badge ou simple span avec colored bg. Cf. autres badges dans le repo.

## Migration RPCs

```sql
-- supabase/migrations/<TS>_create_carry_over_rpcs.sql

-- RPC 1 : toggle is_carried_over + applied_to_balance_at en 1 atomic + adjust bank_balance
CREATE OR REPLACE FUNCTION toggle_carry_over_and_apply(
  p_expense_id uuid,
  p_uncarry boolean  -- true = re-valider (is_carried_over=false + apply); false = re-flag carried_over
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_profile_id uuid;
  v_group_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock row
  SELECT amount, profile_id, group_id INTO v_amount, v_profile_id, v_group_id
    FROM real_expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_found' USING ERRCODE = 'P0002'; END IF;

  IF p_uncarry THEN
    -- Re-valider : flip flags + apply bank delta
    UPDATE real_expenses
      SET is_carried_over = false,
          carried_from_recap_id = NULL,
          applied_to_balance_at = v_now
      WHERE id = p_expense_id;
    -- Adjust bank_balance (debit expense amount)
    PERFORM update_bank_balance(-v_amount, v_profile_id, v_group_id);
  ELSE
    -- Re-flag carried (rare action, sym ?) — pas dans le scope V1, on raise
    RAISE EXCEPTION 'reverse_carry_not_supported' USING ERRCODE = 'P0001';
  END IF;

  RETURN json_build_object('id', p_expense_id, 'is_carried_over', NOT p_uncarry, 'applied_to_balance_at', v_now);
END;
$$;

-- Miroir pour real_income_entries
CREATE OR REPLACE FUNCTION toggle_carry_over_and_apply_income(
  p_income_id uuid,
  p_uncarry boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_amount numeric; v_profile_id uuid; v_group_id uuid; v_now timestamptz := now();
BEGIN
  SELECT amount, profile_id, group_id INTO v_amount, v_profile_id, v_group_id
    FROM real_income_entries WHERE id = p_income_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'income_not_found' USING ERRCODE = 'P0002'; END IF;

  IF p_uncarry THEN
    UPDATE real_income_entries SET is_carried_over = false, carried_from_recap_id = NULL, applied_to_balance_at = v_now WHERE id = p_income_id;
    PERFORM update_bank_balance(v_amount, v_profile_id, v_group_id);  -- credit
  ELSE
    RAISE EXCEPTION 'reverse_carry_not_supported' USING ERRCODE = 'P0001';
  END IF;

  RETURN json_build_object('id', p_income_id, 'is_carried_over', NOT p_uncarry, 'applied_to_balance_at', v_now);
END;
$$;

-- RPC 2 : DELETE carried expense → +amount en piggy
CREATE OR REPLACE FUNCTION delete_carried_expense_to_piggy(p_expense_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric; v_profile_id uuid; v_group_id uuid;
BEGIN
  SELECT amount, profile_id, group_id INTO v_amount, v_profile_id, v_group_id
    FROM real_expenses WHERE id = p_expense_id AND is_carried_over = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_not_carried' USING ERRCODE = 'P0002'; END IF;

  -- DELETE expense
  DELETE FROM real_expenses WHERE id = p_expense_id;
  -- Credit piggy via existing helper (assume piggy row exists; ensure first if needed)
  PERFORM update_piggy_bank_amount(v_amount, v_profile_id, v_group_id);  -- delta positif

  RETURN json_build_object('expense_id', p_expense_id, 'piggy_credited', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION toggle_carry_over_and_apply FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_carry_over_and_apply TO service_role;
REVOKE ALL ON FUNCTION toggle_carry_over_and_apply_income FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_carry_over_and_apply_income TO service_role;
REVOKE ALL ON FUNCTION delete_carried_expense_to_piggy FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_carried_expense_to_piggy TO service_role;

NOTIFY pgrst, 'reload schema';
```

EXPECTED_RPCS passe à **18** (toggle_carry_over_and_apply, toggle_carry_over_and_apply_income, delete_carried_expense_to_piggy ajoutées).

## Wrappers JS

```ts
// lib/finance/carry-over.ts
import { supabaseServer } from '@/lib/supabase-server'

export async function toggleCarryOverAndApply(expenseId: string, uncarry: boolean) {
  const { data, error } = await supabaseServer.rpc('toggle_carry_over_and_apply', { p_expense_id: expenseId, p_uncarry: uncarry })
  if (error) throw error
  return data as { id: string, is_carried_over: boolean, applied_to_balance_at: string }
}

export async function toggleCarryOverAndApplyIncome(incomeId: string, uncarry: boolean) {
  // miroir
}

export async function deleteCarriedExpenseToPiggy(expenseId: string) {
  const { data, error } = await supabaseServer.rpc('delete_carried_expense_to_piggy', { p_expense_id: expenseId })
  if (error) throw error
  return data as { expense_id: string, piggy_credited: number }
}
```

## Adaptation `financial-data.ts`

Dans `getProfileFinancialData` et `getGroupFinancialData`, ajouter `.eq('is_carried_over', false)` dans les SELECT de `real_expenses` et `real_income_entries`. Crucial pour que `totalRealExpenses`, `totalRealIncome`, et le calcul de `spent_per_budget` excluent les carry-over.

## Adaptation `TransactionListItem.tsx`

```tsx
// Pseudo-diff
import { Badge } from '@/components/ui/badge'  // ou custom span

interface TransactionListItemProps {
  // existing...
  transaction: {
    id: string
    amount: number
    is_carried_over: boolean  // NEW
    applied_to_balance_at: string | null
    // ...
  }
  onDelete: () => void  // existing
  onToggleApplied: (id: string, apply: boolean) => void  // existing
}

// In render :
{transaction.is_carried_over && (
  <Badge variant="secondary" className="bg-amber-100 text-amber-800">Mois précédent</Badge>
)}

// In long-press handler :
const handleLongPress = () => {
  if (transaction.is_carried_over) {
    // Special : uncarry + apply atomically (handled by special RPC, route à créer ou inline)
    onUncarryAndApply(transaction.id)
  } else {
    onToggleApplied(transaction.id, !isApplied)  // existing flow
  }
}

// In dropdown menu actions :
{transaction.is_carried_over ? (
  <>
    <DropdownMenuItem onClick={() => onUncarryAndApply(transaction.id)}>Valider et appliquer au solde</DropdownMenuItem>
    {transaction.kind === 'expense' && (
      <DropdownMenuItem onClick={() => onDeleteCarriedToPiggy(transaction.id)} className="text-red-600">Supprimer (renvoyer en tirelire)</DropdownMenuItem>
    )}
    {transaction.kind === 'income' && (
      <DropdownMenuItem onClick={() => onDelete()} className="text-red-600">Supprimer</DropdownMenuItem>
    )}
  </>
) : (
  <>
    <DropdownMenuItem onClick={() => onToggleApplied(...)}>{isApplied ? 'Retirer du solde' : 'Appliquer au solde'}</DropdownMenuItem>
    <DropdownMenuItem disabled={isApplied} onClick={() => onDelete()} className="text-red-600">Supprimer</DropdownMenuItem>
  </>
)}
```

## Étapes d'implémentation suggérées
1. **Créer migration RPCs** (3 RPCs) + apply + repair + `pnpm db:audit-functions`.
2. **EXPECTED_RPCS 16→18** : maj `scripts/check-rpcs.mjs` + CLAUDE.md §5.5.
3. **Créer `lib/finance/carry-over.ts`** : 3 wrappers JS.
4. **Modifier `lib/finance/financial-data.ts`** : ajouter `.eq('is_carried_over', false)` dans les SELECT de transactions. Vérifier les sites qui consomment ces queries pour ne pas casser d'autres calculs.
5. **Créer/ajouter routes API** : `POST /api/transactions/expenses/[id]/uncarry-and-apply`, `POST /api/transactions/incomes/[id]/uncarry-and-apply`, `DELETE /api/transactions/expenses/[id]?to_piggy=true` (réutiliser la DELETE existante avec query param). Patterns withAuthAndProfile.
6. **Adapter `TransactionListItem.tsx`** : ajouter prop `is_carried_over` + render badge + adapter long-press + adapter dropdown menu.
7. **Adapter `hooks/useRealExpenses.ts`** et `useRealIncomes.ts` : exposer `uncarryAndApply` mutation + `deleteToPiggy` (pour expenses carried).
8. **Adapter les dashboards** : `app/(dashboards)/dashboard/page.tsx` + `group-dashboard/page.tsx` passent maintenant `is_carried_over` aux transactions.
9. **Tests** : RPC tests gated + RTL TransactionListItem (badge + actions carried) + integration test sur financial-data (sum exclude carry-over).
10. **Smoke** : seed `transactions-mixed-validated` → flow recap complet → post-complete dashboard → vérifier badge "Mois précédent" sur expenses non-applied + long-press flip + delete piggy crédit.
11. **Commit** : `feat(recap): carry-over UI + RPCs + financial-data filter`.

## Critères d'acceptation
- [ ] 3 RPCs créées + auditées : toggle_carry_over_and_apply, toggle_carry_over_and_apply_income, delete_carried_expense_to_piggy
- [ ] EXPECTED_RPCS = 18, `pnpm db:check-rpcs` exit 0
- [ ] CLAUDE.md §5.5 mis à jour
- [ ] `lib/finance/carry-over.ts` exporte 3 wrappers
- [ ] `getProfile/GroupFinancialData` filtrent is_carried_over=true des SELECT
- [ ] `TransactionListItem.tsx` affiche badge "Mois précédent" si is_carried_over
- [ ] Long-press carried → uncarry+apply via RPC atomique
- [ ] Dropdown menu : "Valider et appliquer au solde" + "Supprimer (renvoyer en tirelire)" pour carried expense
- [ ] Dropdown menu : "Supprimer" simple pour carried income (no piggy impact)
- [ ] Routes API correspondantes créées (uncarry-and-apply expense/income, delete-to-piggy expense)
- [ ] Tests RPCs gated ≥6 cas passants
- [ ] Tests RTL TransactionListItem ≥6 cas additionnels (badge + carried actions)
- [ ] Tests intégration financial-data filter ≥3 cas
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### RPC `toggle_carry_over_and_apply` (gated SUPABASE_RECAP_TESTS=1)
- Expense carried_over=true → call uncarry=true → is_carried_over=false, applied_to_balance_at=now, bank_balance -= amount
- Expense applied=null is_carried_over=false → call uncarry=true → raise expense_not_carried OR no-op (decide)
- Expense inexistante → raise expense_not_found
- Concurrent calls → P0002 sur 1er, l'autre passe (FOR UPDATE lock)

### RPC `delete_carried_expense_to_piggy` (gated)
- Expense carried → DELETE + piggy_credited=amount, retourne json
- Expense not carried → raise expense_not_carried
- Expense déjà supprimée → raise expense_not_found

### `TransactionListItem.test.tsx` (RTL)
- Render is_carried_over=true → badge "Mois précédent" visible
- Click long-press carried → onUncarryAndApply called (pas onToggleApplied)
- Dropdown menu carried expense → "Valider et appliquer" + "Supprimer (renvoyer en tirelire)"
- Dropdown menu carried income → "Valider et appliquer" + "Supprimer" (no piggy)
- Carried + not applied yet → couleur visuelle distincte (e.g. opacity 0.7)

### `financial-data.test.ts` (gated, ~3 cas)
- 5 real_expenses (3 normal, 2 carried) → totalRealExpenses = sum(3 normal seulement)
- 4 real_income_entries (2 normal carried, 2 normal applied) → totalRealIncome = sum(2 normal applied)
- spent_per_budget filter is_carried_over=false correctement

## Pièges et points d'attention
- **`is_carried_over` vs `applied_to_balance_at`** : 2 dimensions orthogonales. La transaction post-recap a typiquement (is_carried_over=true, applied_to_balance_at=null). Mais on peut aussi avoir (is_carried_over=true, applied_to_balance_at=now()) si user a re-validé. Et (is_carried_over=false, applied_to_balance_at=now()) = transaction normale appliquée.
- **`uncarry-and-apply` doit ajuster bank_balance** : la spec dit "le solde se met à jour". L'addition de l'expense applique le débit → call `update_bank_balance(-amount)`. Pour income : `update_bank_balance(+amount)`.
- **`update_piggy_bank_amount` RPC existant** : vérifier signature dans [lib/finance/piggy-bank.ts](../lib/finance/piggy-bank.ts). Probablement `(delta, profile_id, group_id)`. Le `+amount` ici credite la piggy.
- **`ensurePiggyBankRow` avant credit** : si la piggy row n'existe pas (edge case), la RPC `update_piggy_bank_amount` peut raiser. Wrap with `ensurePiggyBankRow` first ou modifier la RPC pour UPSERT. La RPC existante fait probablement déjà UPSERT, vérifier.
- **DELETE carried income** : NO piggy impact (cf. décision Q3 user). La route DELETE existing reste comportementalement identique pour income carried.
- **Filter is_carried_over=true cross-codebase** : la spec dit "Ils NE DOIVENT PAS être pris en compte dans le calcul du reste à vivre, solde, etc.". Le filter dans `getProfile/GroupFinancialData` est crucial. Vérifier aussi : `/api/finance/expenses/real` (GET) doit RETOURNER les carried (UI doit les afficher) mais les calculs en aval les excluent. Pas de filter dans les routes GET, juste dans les sums.
- **`carried_from_recap_id` cleanup** : quand on uncarry, set à NULL. Garde la trace est inutile post-validation.
- **Cas la transaction carried est dans 2 mois successifs sans validation** : à la finalize du mois N+1, si la transaction est toujours `is_carried_over=true` AND `applied_to_balance_at=null`, le `process_recap_transactions` filtre `is_carried_over=false` dans le WHERE → elle est ignorée (ne re-flag pas). Acceptable : l'utilisateur peut accumuler des carry-over indéfiniment, c'est un signal qu'il doit faire le ménage.

## Commandes utiles
```bash
# Migration
node scripts/apply-sql.mjs supabase/migrations/<TS>_create_carry_over_rpcs.sql
pnpm supabase migration repair --status applied <TS>
pnpm db:audit-functions
pnpm db:check-rpcs  # 18

# Tests
SUPABASE_RECAP_TESTS=1 pnpm test:run lib/finance/__tests__/carry-over.test.ts lib/finance/__tests__/financial-data.test.ts
pnpm test:run components/dashboard/__tests__/TransactionListItem.test.tsx
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 3 RPCs, EXPECTED_RPCS = 18
- TransactionListItem affiche badge + actions adaptées
- Filter is_carried_over=false dans financial-data
- ≥15 tests passants au total
- Smoke : flow recap complet seed transactions-mixed-validated → post → vérifier badge + flip + delete piggy
- Commit `feat(recap): carry-over UI + RPCs + financial-data filter`
- `pnpm verify` exit 0
