# [16] — Read-only rows virtuelles : salaire + contribution dans estimated incomes

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3 — section 6 spec : après chaque recap, le salaire (perso) et la contribution (groupe) sont affichés en read-only dans la liste des revenus estimés. Virtual UI-only (decision lockée user Q1), 0 migration DB.
- Position dans la séquence : étape 16/17
- Dépend de : 14 (salary update endpoint pour s'assurer salaire est à jour post-recap)
- Débloque : 17 (E2E tests vérifient l'affichage post-complete)

## Objectif
Étendre `FinancialData` avec `meta.readOnlyIncomes: [{ kind: 'salary'|'contribution', label, amount }]`. Injection côté serveur dans `getProfile/GroupFinancialData`. Adapter `EstimatedIncomesList` (ou composant équivalent) pour merger virtual rows + masquer edit/delete + icône cadenas. Zero double-comptage : les rows sont déjà incluses dans `totalEstimatedIncome` actuel (via `profile.salary` + `group_contributions`).

## Fichiers concernés
- `lib/finance/types.ts` — étendre `FinancialData` avec `meta?: { readOnlyIncomes: ReadOnlyIncome[] }`
- `lib/finance/financial-data.ts` — modifier `getProfileFinancialData` et `getGroupFinancialData` pour populer `meta.readOnlyIncomes`
- `components/dashboard/EstimatedIncomesList.tsx` (ou nom équivalent — trouver via grep) — modifier pour merger virtual rows
- `app/api/finance/incomes/estimated/route.ts` — vérifier si retourne FinancialData ou liste raw. Possible adaptation.
- `app/api/finance/summary/route.ts` — déjà retourne FinancialData. Vérifier que meta est exposé.
- `hooks/useIncomes.ts` — à LIRE pour comprendre le flow data
- Pas de migration DB ni nouvelle RPC dans cette sous-tâche.

## Patterns et conventions à respecter
- **Code couleur UI Popoth** (à suivre autant que possible — vérifié sprint 13 follow-up 2026-05-24) :
  - **Tirelire** = violet, **Économies des budgets** = violet (même famille), **Budgets** = orange, **Deficit** = red, **Surplus / succès** = green, **Neutral / locked / done / read-only** = gray.
  - Pour les rows read-only (salaire + contribution), gray + icône cadenas est cohérent avec le pattern "done/locked" du flow recap.
  - Vérifier `BilanPositiveStep`, `BilanNegativeStep`, `RefloatPiggyLine`, `RefloatSavingsLine`, `RefloatBudgetSnapshotLine`, `SurplusSelectionDrawer` avant de choisir une couleur.
- **Virtual rows non-persistées** : `meta.readOnlyIncomes` est dérivé à la volée depuis `profile.salary` + `group_contributions.contribution_amount`. Aucune INSERT/UPDATE.
- **Lock icon UI** : utiliser une icône lucide-react `Lock` ou `ShieldCheck` à côté du label. Pattern shadcn.
- **Disable edit/delete** : sur les rows virtuelles, ne PAS rendre les boutons d'action OU les disable. Préférer ne pas les rendre (UX plus claire).
- **DRY** : extraire `<EstimatedIncomeRow>` component avec prop `isReadOnly` qui conditionne le render des actions.
- **No double-counting** : le `totalEstimatedIncome` est déjà calculé en incluant `profile.salary` + `group_contributions.contribution_amount`. La virtual row N'EST PAS ré-ajoutée au total — c'est juste un affichage.

## Détail des modifications

### `lib/finance/types.ts`

```ts
export interface ReadOnlyIncome {
  kind: 'salary' | 'contribution'
  label: string
  amount: number
}

export interface FinancialData {
  // existing fields…
  availableBalance: number
  remainingToLive: number
  totalSavings: number
  totalEstimatedIncome: number
  totalEstimatedBudgets: number
  totalRealIncome: number
  totalRealExpenses: number
  bankBalance?: number
  piggyBank?: number

  // NEW
  meta?: {
    readOnlyIncomes: ReadOnlyIncome[]
  }
}
```

### `lib/finance/financial-data.ts`

```ts
// Dans getProfileFinancialData, après tous les fetches existants :
const readOnlyIncomes: ReadOnlyIncome[] = []
if (profile.salary > 0) {
  readOnlyIncomes.push({ kind: 'salary', label: 'Salaire', amount: profile.salary })
}

return {
  ...existingFields,
  meta: { readOnlyIncomes },
}

// Dans getGroupFinancialData :
const readOnlyIncomes: ReadOnlyIncome[] = []
const userContribution = await fetchUserContribution(profileId, groupId)  // déjà fait pour totalIncome
if (userContribution > 0) {
  readOnlyIncomes.push({ kind: 'contribution', label: 'Contribution groupe', amount: userContribution })
}
return { ...existingFields, meta: { readOnlyIncomes } }
```

### `components/dashboard/EstimatedIncomesList.tsx` (ou équivalent)

```tsx
'use client'
import { Lock } from 'lucide-react'

interface IncomeRow {
  id: string | null  // null pour virtual rows
  name: string
  amount: number
  isMonthlyRecurring: boolean
  readOnly: boolean  // NEW
  kind?: 'salary' | 'contribution' | null
}

export function EstimatedIncomesList({
  estimatedIncomes,
  readOnlyIncomes,
  onEdit,
  onDelete,
}: {
  estimatedIncomes: EstimatedIncome[]
  readOnlyIncomes: ReadOnlyIncome[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  // Merge : virtual rows en haut (read-only), puis real rows
  const allRows: IncomeRow[] = [
    ...readOnlyIncomes.map(r => ({
      id: null,
      name: r.label,
      amount: r.amount,
      isMonthlyRecurring: true,
      readOnly: true,
      kind: r.kind,
    })),
    ...estimatedIncomes.map(e => ({
      id: e.id,
      name: e.name,
      amount: e.amount,
      isMonthlyRecurring: e.is_monthly_recurring,
      readOnly: false,
    })),
  ]

  return (
    <ul className="space-y-2">
      {allRows.map((row, idx) => (
        <li key={row.id ?? `readonly-${idx}`} className={`flex items-center justify-between rounded-lg border p-3 ${row.readOnly ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}>
          <div className="flex items-center gap-2">
            {row.readOnly && <Lock size={14} className="text-gray-500" aria-label="Read-only" />}
            <span className={row.readOnly ? 'text-sm text-gray-700' : 'text-sm text-gray-900'}>{row.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{formatEuro(row.amount)}</span>
            {!row.readOnly && (
              <>
                <button onClick={() => onEdit(row.id!)} aria-label={`Modifier ${row.name}`}>...</button>
                <button onClick={() => onDelete(row.id!)} aria-label={`Supprimer ${row.name}`}>...</button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
```

### Adaptation pages dashboards

`app/(dashboards)/dashboard/page.tsx` et `group-dashboard/page.tsx` doivent passer `readOnlyIncomes={financialData.meta?.readOnlyIncomes ?? []}` au composant.

## Étapes d'implémentation suggérées
1. **Trouver le composant** : `Grep "estimated.*income" components/` pour identifier le nom exact (probablement `EstimatedIncomesList` ou `IncomesEstimatedCard` ou similaire).
2. **Étendre `FinancialData` type** dans `lib/finance/types.ts` avec `meta.readOnlyIncomes`.
3. **Modifier `getProfileFinancialData`** : populer `meta.readOnlyIncomes` avec salary virtual row.
4. **Modifier `getGroupFinancialData`** : populer `meta.readOnlyIncomes` avec contribution virtual row (calculé depuis group_contributions ou via fetch user contribution).
5. **Adapter le composant** : merge virtual rows en haut + lock icon + no actions.
6. **Adapter les pages dashboards** : passer `readOnlyIncomes` au composant.
7. **Vérifier `/api/finance/summary`** : retourne déjà `meta` automatiquement si on étend `FinancialData`. Aucune modif route nécessaire normalement.
8. **Tests RTL** : EstimatedIncomesList avec mix de rows (2 readOnly + 3 real) → lock icons + no actions sur les readOnly + actions visibles sur les real.
9. **Tests intégration** (gated) : getProfile/GroupFinancialData retourne meta.readOnlyIncomes correctement.
10. **Smoke** : recap complete → dashboard → liste revenus estimés montre "Salaire 2500€" en première position avec lock icon, non-éditable.
11. **Commit** : `feat(recap): virtual read-only rows for salary/contribution in estimated incomes`.

## Critères d'acceptation
- [ ] `FinancialData` étendu avec `meta?.readOnlyIncomes: ReadOnlyIncome[]`
- [ ] `getProfileFinancialData` populate meta avec `{ kind: 'salary', amount: profile.salary }` si salary > 0
- [ ] `getGroupFinancialData` populate meta avec `{ kind: 'contribution', amount: userContribution }` si > 0
- [ ] `totalEstimatedIncome` reste inchangé (pas de double-comptage)
- [ ] EstimatedIncomesList affiche virtual rows en haut avec lock icon + label + amount
- [ ] Pas de bouton edit/delete sur les virtual rows
- [ ] Pages dashboards passent meta.readOnlyIncomes correctement
- [ ] Tests RTL ≥6 cas (merge ordre, lock icon, actions disabled)
- [ ] Tests intégration ≥3 cas (financial-data meta populated)
- [ ] Smoke : dashboard post-recap montre salary virtual row
- [ ] Mobile viewport clean
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### `EstimatedIncomesList.test.tsx` (RTL)
- Render 0 real + 2 readOnly → 2 rows lock icon visible, no actions
- Render 3 real + 1 readOnly → 1 readOnly en premier + 3 real avec actions
- Click edit sur real row → onEdit(id) called
- Click edit sur readOnly row → bouton ABSENT (assert query par `aria-label` retourne null)
- a11y axe pas de violations

### `financial-data.test.ts` (gated, ~3 cas)
- profile avec salary=2500 → meta.readOnlyIncomes = [{ kind:'salary', amount:2500 }]
- profile avec salary=0 → meta.readOnlyIncomes = [] (skip)
- group avec contribution=1500 → meta.readOnlyIncomes = [{ kind:'contribution', amount:1500 }]

## Pièges et points d'attention
- **No double-counting** : crucial. `totalEstimatedIncome` est déjà somme de `estimated_incomes + profile.salary + group_contributions`. La virtual row N'EST PAS un additionnel — c'est juste un affichage. Si quelqu'un (futur) modifie le composant pour `sum(allRows)` ça doublerait. Documenter dans un commentaire inline + tester via assertion `totalEstimatedIncome === sum(estimated_incomes) + sum(virtual_amounts)`.
- **`totalEstimatedIncome` affichage UI** : la card "Total revenus estimés" déjà existante affiche `summary.totalEstimatedIncome`. Doit rester cohérent : `Σ(displayed rows) === totalEstimatedIncome` même avec virtual rows. Vérifier visuel.
- **Pas de feature recap_month/recap_year scoping** : la spec dit "remplacent celles du mois précédent (pas d'accumulation)" — avec virtual rows, c'est trivial (toujours la salary actuelle). Si on persistait des rows en DB, il faudrait gérer le replace. Avec virtual UI-only, aucun problème.
- **Cas no group** : pour un user sans group_id, `getGroupFinancialData` n'est pas appelé → no contribution virtual row. OK.
- **`Lock` icon a11y** : `<Lock aria-label="Read-only" />` ou wrapper `<span title="Lecture seule"><Lock /></span>`. Spec UI accessibility.
- **Order virtual rows** : salary en premier (perso) ou contribution en premier (group context). UI cohérence : toujours en TOP de la liste, avant les real rows.
- **`hooks/useIncomes.ts`** : si ce hook retourne UNIQUEMENT les real estimated_incomes (sans meta), le composant doit fetch FinancialData séparément OU le hook doit être adapté. Vérifier le pattern actuel.
- **Pages dashboard** : `app/(dashboards)/dashboard/page.tsx` server component vs client component. Vérifier où `financialData` est fetched (server vs client) pour passer le bon prop.
- **i18n labels** : "Salaire" en perso et "Contribution groupe" en group. Hardcoded en français OK (cf. CLAUDE.md "PWA francophone").

## Commandes utiles
```bash
# Trouver le composant
Grep "estimated.*income" components/ --type tsx

# Tests
pnpm test:run components/dashboard/__tests__/EstimatedIncomesList.test.tsx lib/finance/__tests__/financial-data.test.ts

# Smoke
pnpm dev → flow recap complet → /dashboard → liste revenus estimés
```

## Definition of Done
- Tous les critères d'acceptation cochés
- `meta.readOnlyIncomes` exposé correctement dans tous les contextes
- UI lock icon + actions disabled sur virtual rows
- 0 double-comptage (assertion explicite dans test)
- ≥9 tests passants
- Smoke post-recap : salary 2500€ visible avec lock icon
- Commit `feat(recap): virtual read-only rows for salary/contribution in estimated incomes`
- `pnpm verify` exit 0
