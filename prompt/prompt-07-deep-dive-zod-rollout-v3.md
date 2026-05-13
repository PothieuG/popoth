# Sprint Zod-Rollout v3 — Client Forms (suite Sprint Zod-Rollout v2)

> ⚠️ Lire d'abord [`CLAUDE.md`](../CLAUDE.md) §6 "Validation Zod (parseBody)" + §11 entrées Sprint Zod-Rollout-Money-First (v1) et Sprint Zod-Rollout v2.
> Le v2 a livré l'intégralité du server-side (parseQuery + 17 GET routes + 6 DELETE + auth + groups + recap + debug) + 1 PoC client (EditBalanceModal). Le v3 ferme les 10 client forms restants.

## Contexte

Le Sprint Zod-Rollout v2 (livré 2026-05-13, commits `3ec719d → 5ba2d11`, 14 commits) a installé `parseQuery` + 5 query schemas + 6 nouveaux body schemas (auth session discriminated union, groups create/update, recap initialize/recover/update-step, debug retrigger-recap) et migré tous les server-side routes restants. Le côté client a un seul PoC : `EditBalanceModal` migré avec le pattern dual-type `useForm<FormInput, undefined, FormOutput>` pour gérer les schémas `z.coerce.number()`.

v3 doit fermer les 10 client forms restants en réutilisant ce pattern et en introduisant le pattern factory `makeBudgetClientSchema(opts)` pour les balance refines prop-dependent.

**Pattern de référence** : [`components/dashboard/EditBalanceModal.tsx`](../components/dashboard/EditBalanceModal.tsx) (commit `5ba2d11`).

## Forms à migrer

### Trivial (6 restants, ~70-100 LOC chacun) — tous text-only ou single-decimal

| Form | LOC | Fields | Schema (existant v1/v2) | Notes |
|------|-----|--------|------------------------|-------|
| `AddIncomeDialog.tsx` | 301 | name, amount | `createIncomeBodySchema` (camelCase) | Décimal — pattern dual-type. `currentIncomesTotal` prop display-only (pas dans schema). |
| `EditIncomeDialog.tsx` | 230 | name, amount | `updateIncomeBodySchema` | Décimal + edit mode lazy init `useState(() => editing.foo)` + parent `key={editing.id}`. Promise<bool> async. |
| `EditProfileDialog.tsx` | 207 | firstName, lastName | `updateProfileBodySchema` | Text-only. Edit mode lazy init. Promise<bool> async. |
| `FirstTimeProfileDialog.tsx` | 194 | firstName, lastName | `createProfileBodySchema` | Text-only. Promise<bool> async. |
| `CreateGroupForm.tsx` | 133 | name, monthly_budget_estimate | `createGroupBodySchema` (v2 commit 9) | Décimal — pattern dual-type. Promise<bool> async. |
| `app/connexion/page.tsx` | 150 | email, password | `loginFormSchema` (v2 commit 7) | Text-only. Server-side errors via `useState('serverError')` (cf. inscription PoC). |

### Moderate (3 forms, prop-dependent refines)

| Form | LOC | Complexité | Schema |
|------|-----|------------|--------|
| `AddBudgetDialog.tsx` | 371 | **factory needed** : balance refine on `currentBudgetsTotal` + `totalEstimatedIncome` from parent | `makeBudgetClientSchema({...})` à créer dans `lib/schemas/budget.ts` |
| `EditBudgetDialog.tsx` | 257 | **factory + edit mode** : `currentBudgetAmount` = `editing.estimated_amount` for delta calc | même factory + `useMemo` to recreate when props change |
| `EditTransactionModal.tsx` | 406 | **discriminated union on `transactionType`** : expense vs income branches; refine `is_exceptional || budget_id/income_id !== null` per branch | `editTransactionFormSchema` (à créer dans `lib/schemas/`, possiblement nouveau `transactions.ts`) |

### Complex (1 form, ~487 LOC, useRavValidation separation)

| Form | LOC | Complexité | Schema |
|------|-----|------------|--------|
| `AddTransactionModal.tsx` | 487 | **adaptive UI** + **useRavValidation hook préservé séparé** | `addTransactionFormSchema` discriminated union par type ; **hook lu après zodResolver dans onValidSubmit pour bloquer si `ravValidation.blocked`** |

## Patterns établis (v2) à réutiliser

### Pattern 1 — Décimal avec `z.coerce.number()` (dual-type)

Quand un schema utilise `z.coerce.number()`, l'input type (`z.input<schema>`) accepte `string|number` mais l'output (`z.output<schema>`) est toujours `number`. `useForm` a besoin des deux :

```ts
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { mySchema, type MyFormOutput } from '@/lib/schemas/...'

type MyFormInput = z.input<typeof mySchema>

const form = useForm<MyFormInput, undefined, MyFormOutput>({
  resolver: zodResolver(mySchema),
  defaultValues: { amount: 0 },
  mode: 'onSubmit',
})

const handleValidSubmit = async (data: MyFormOutput) => {
  await onSave(data)
}

<Controller
  control={form.control}
  name="amount"
  render={({ field }) => (
    <Input
      type="text"
      inputMode="decimal"
      value={field.value == null ? '' : String(field.value)}
      onChange={(e) => {
        const v = e.target.value
        if (v === '' || /^-?\d*[.,]?\d*$/.test(v)) {
          field.onChange(v.replace(',', '.'))
        }
      }}
      aria-invalid={form.formState.errors.amount ? 'true' : 'false'}
    />
  )}
/>
```

### Pattern 2 — Text-only (no coerce)

Sans `z.coerce`, `useForm<MyForm>` suffit. Pas de `Controller` nécessaire — `form.register` direct. Voir le PoC v1 [`app/inscription/page.tsx`](../app/inscription/page.tsx).

### Pattern 3 — Edit dialog avec `key={item.id}` lazy init

Le parent passe `key={editing.id ?? 'closed'}` pour forcer un remount à chaque nouvelle sélection. RHF `defaultValues` ne se re-syncs PAS sur prop change sans remount.

```ts
// Parent
{isOpen && editing && <EditBudgetDialog key={editing.id} editing={editing} ... />}

// Child
const form = useForm<...>({
  resolver: zodResolver(...),
  defaultValues: { name: editing.name, amount: editing.estimated_amount },
  mode: 'onSubmit',
})
```

### Pattern 4 — Prop-dependent factory (moderate forms)

```ts
// lib/schemas/budget.ts (à ajouter)
export function makeBudgetClientSchema(opts: {
  currentBudgetsTotal: number
  totalEstimatedIncome: number
  currentBudgetAmount?: number  // 0 pour Add, editing.estimated_amount pour Edit
}) {
  const { currentBudgetsTotal, totalEstimatedIncome, currentBudgetAmount = 0 } = opts
  return z
    .object({
      name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères'),
      estimatedAmount: moneySchema,
    })
    .refine(
      (d) => {
        const newTotal = currentBudgetsTotal - currentBudgetAmount + d.estimatedAmount
        return totalEstimatedIncome - newTotal >= 0
      },
      {
        message: "Impossible d'ajouter ce budget : le reste à vivre deviendrait négatif. Réduisez le montant ou ajoutez des revenus.",
        path: ['estimatedAmount'],
      },
    )
}

// AddBudgetDialog.tsx
const schema = useMemo(
  () => makeBudgetClientSchema({ currentBudgetsTotal, totalEstimatedIncome }),
  [currentBudgetsTotal, totalEstimatedIncome],
)
type SchemaInput = z.input<typeof schema>
type SchemaOutput = z.output<typeof schema>

const form = useForm<SchemaInput, undefined, SchemaOutput>({
  resolver: zodResolver(schema),
  defaultValues: { name: '', estimatedAmount: 0 },
})
```

### Pattern 5 — useRavValidation séparation (complex form)

Pour `AddTransactionModal`, le schema Zod gère uniquement la syntaxe (description, amount, date, budgetId/incomeId, exceptional). Le hook `useRavValidation` reste séparé et est consulté après resolver :

```ts
const ravValidation = useRavValidation({ transactionType, isExceptional, amount, ... })

const onValidSubmit = async (data: AddTransactionFormBody) => {
  if (ravValidation.blocked) {
    setServerError("Impossible d'ajouter cette dépense : votre reste à vivre (sans économies) deviendrait négatif.")
    return
  }
  await onSave(data)
}
```

**Ne PAS** déplacer la logique RAV-blocking dans le schema — elle dépend de données réactives (RAV, budgetProgress) qui changent en dehors du form.

## Décisions d'arbitrage à demander avant exécution

- **Q1 Découpage commits** : (A) 1 commit par form (10 commits ; pattern uniforme), (B) 1 commit par catégorie (trivial / moderate / complex = 3 commits ; plus brut mais réduit le bruit), (C) un seul commit "all forms" (1 commit lourd, diff massif).
- **Q2 Factory location** : `makeBudgetClientSchema` dans `lib/schemas/budget.ts` (recommandé) ou nouveau `lib/schemas/budget-client.ts` séparé (sépare server vs client schemas, mais ajoute un module).
- **Q3 EditTransactionModal schema location** : nouveau `lib/schemas/transactions.ts` (recommandé — `lib/schemas/expense.ts` et `income.ts` sont déjà multi-purpose mais le discriminated union croise expense+income) ou folder dans expense.ts.
- **Q4 AddTransactionModal scope** : (A) migrer en v3 (487 LOC, useRavValidation séparation), (B) défer en v4 dédié (vu sa complexité, mérite peut-être son propre sprint).

## Fichiers à lire en priorité

- [`components/dashboard/EditBalanceModal.tsx`](../components/dashboard/EditBalanceModal.tsx) — **modèle dual-type décimal**
- [`app/inscription/page.tsx`](../app/inscription/page.tsx) — **modèle text-only signupBodySchema**
- [`lib/schemas/auth.ts`](../lib/schemas/auth.ts) — schemas auth (signup + login + sessionAction)
- [`lib/schemas/bank-balance.ts`](../lib/schemas/bank-balance.ts) — `editBalanceFormSchema` (modèle pour les autres décimaux)
- Les 10 fichiers de forms cités dans la table ci-dessus
- [`hooks/useRavValidation.ts`](../hooks/useRavValidation.ts) — NE PAS toucher (préservation Risk #3)

## Verification end-to-end

- Après chaque commit : `pnpm verify` (typecheck + test:run + 6 `db:*` checks) exit 0
- Lint baseline doit rester **183 warnings stable** (les forms n'introduisent pas de warning)
- Tests delta : 0 (les forms client n'ont pas de tests unitaires actuellement ; ce sera potentiellement un v4 dédié testing)
- Negative greps :
  - `Grep "isLoading.*useState\|setIsLoading" components/dashboard/{Add,Edit}*` = 0 hits dans les forms migrés (remplacé par `form.formState.isSubmitting`)
  - `Grep "useForm" components/` = 10 hits (les 10 forms migrés) + 1 hit pour le PoC EditBalanceModal v2

## Smoke browser deferred to user

- `/inscription` (v1 PoC) déjà migré, à confirmer non-régression
- `/connexion` login avec credentials valides + invalides → erreur inline sous le champ
- `/dashboard` → AddTransactionModal balance refine (Add/Edit Budget) → tester avec amount > totalIncome
- `/settings` ProfileSettingsCard / EditProfileDialog → tester firstName/lastName validation
- AddTransactionModal RAV blocking : ajouter une dépense > RAV → server error inline
- EditTransactionModal discriminated union : passer de expense → income via UI

## Out of scope (explicite)

- Sprint Tailwind-v4 (CSS-first migration)
- Sprint Supabase-Strict-Types (5 sites monthly-recap `RejectExcessProperties`)
- Chantier I6 (`complete/balance/auto-balance` extraction)
- Tests unitaires des forms client (React Testing Library) — Sprint v4 dédié si surface assez grande
- OpenAPI / schema-to-docs (R10 audit)
- Sweep final console.log Lot 6
- Migration des `useState<string>` qui tracent serverError dans certains forms — uniformiser en `useState<string | null>` est nice-to-have non-critique

## Instructions pour l'exécution

1. **Phase 1 obligatoire** : lire chaque form ciblé en entier AVANT de migrer pour identifier les variantes locales (validation, async, RAV/balance refine, lazy init).
2. **Réutiliser les schemas server quand la shape colle** (cas EditIncomeDialog → `updateIncomeBodySchema`, CreateGroupForm → `createGroupBodySchema`).
3. **Créer des `*FormSchema` séparés** quand le serveur attend une shape légèrement différente (cas EditBalanceModal qui accepte negative balance pour overdraft).
4. **Commit final** : update CLAUDE.md §11 avec entrée Sprint Zod-Rollout v3 + §6 "Côté client" enrichi avec le pattern factory + useRavValidation separation.
5. **Sanity test** à chaque commit : essayer un input invalide (e.g. amount=-5, name="X") → vérifier que l'erreur s'affiche inline sous le champ, pas en serverError global.

## Risques résiduels

### Risque 1 — Decimal input fragility

Le regex `^-?\d*[.,]?\d*$` accepte des entrées intermédiaires comme `"-"`, `"."`, `"-."` qui sont stockées comme string dans field.value mais `z.coerce.number()` échoue à parser au submit (résulte en NaN qui fail la refine `.finite()`). Solution : laisser ces intermédiaires traverser, l'erreur inline apparaît au submit (UX acceptable). Si on veut bloquer plus tôt, ajouter un blur handler qui efface la valeur si pas parsable.

### Risque 2 — Factory + useMemo recreation

`useMemo(() => makeBudgetClientSchema({...props}), [props])` recrée le schema à chaque changement de props (currentBudgetsTotal change quand l'utilisateur ajoute un budget). Ça invalide aussi le `resolver` passé à `useForm`. Si l'UX est imprévisible (errors qui apparaissent/disparaissent), envisager de gérer la refine balance en submit-time JS au lieu de schema-time.

### Risque 3 — useRavValidation re-run

`useRavValidation` est un useMemo qui dépend de `useFinancialData` / `useBudgetProgress`. Ces hooks fetch côté TanStack Query qui peut re-fetch en cours de saisie (e.g. window focus). Le `ravValidation.blocked` peut alors flipper pendant que l'utilisateur tape. UX acceptable : on bloque à submit-time. **Ne PAS** déplacer la check dans un useEffect qui setState — re-render loops garantis.

### Risque 4 — EditTransactionModal discriminated union

Le user peut switcher de type expense → income via radio button. Si le form est `useForm<DiscriminatedUnion>`, les champs `budget_id` / `income_id` ne sont pas synchronisés au switch — il faut `form.setValue('type', ...)` + `form.unregister('budget_id')` + `form.register('income_id')` ou similaire. Pattern correct : `form.reset({ type: newType, ... })` au moment du switch. Voir aussi le pattern `<Form ...>` de shadcn/ui form si déjà utilisé ailleurs.

---

## Livrables attendus

- 10 forms migrés (réparti selon Q1)
- 2-3 nouveaux schemas/factories (`makeBudgetClientSchema`, `editTransactionFormSchema`, `addTransactionFormSchema`)
- CLAUDE.md §11 entry + §6 client patterns documentés
- `pnpm verify` exit 0 à chaque commit
- Score estimé après v3 : ~99.99/100 (Zod rollout complet server + client)
