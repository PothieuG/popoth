# Patterns Zod — schemas, validation, forms client

> Extraction détaillée de CLAUDE.md §6 Validation Zod. Cf. CLAUDE.md §6 (résumé inline) et §8 ✅ (règle obligatoire pour tout nouveau body POST/PATCH/PUT).

## 1. Principes

- Tous les bodies POST/PATCH/PUT passent par `parseBody(request, schema)` depuis [lib/api/parse-body.ts](../../lib/api/parse-body.ts) avec les schemas dans `lib/schemas/<domain>.ts` (barrel [lib/schemas/index.ts](../../lib/schemas/index.ts)).
- Format réponse erreur unifié à 400 : `{ error: 'Body invalide', issues: ZodIssue[] }` via `handleBadRequest(error)` placé au top du catch de la route (avant le 500 fallback).
- Préférer `z.discriminatedUnion` quand chaque branche a un literal de discriminant commun (cas `remaining_to_live_choice.action` dans `completeBodySchema`), ou `z.union` + type guard quand une des branches n'a pas le champ discriminant (cas `transferSavingsBodySchema` post Sprint Atomicity-Savings v2). Préférer `.refine` pour la cross-field validation (PUT partial-update "at least one field", password match, same-id rejection).

## 2. Pattern serveur POST/PUT

```ts
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { someSchema } from '@/lib/schemas/<domain>'

export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const body = await parseBody(request, someSchema)
    // body est typé et validé — pas de validation manuelle subséquente
    // ...
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

## 3. Primitives partagés (lib/schemas/common.ts)

- `contextSchema` (profile/group enum)
- `uuidSchema`
- `moneySchema` (positive finite 2-décimales)
- `nonNegativeMoneySchema` (allow zero pour accumulate-piggy-bank)
- `isoDateSchema` (YYYY-MM-DD)
- `moneyFormSchema` (coerced positive client-side Sprint v3)
- `periodSchema` (enum month|week|day, Sprint P1)

**Query schemas** (Sprint Zod-Rollout v2) : `contextOnlyQuerySchema` (~10 GET routes), `estimatedListQuerySchema` (`?group=true|false` coerce), `deleteByIdQuerySchema` (`?id=<uuid>` pour 6 DELETE handlers), `summaryQuerySchema` (`?context + ?recalculate=true` coerce), `progressQuerySchema` (Sprint P1 — context + period).

## 4. `parseQuery` helper

Sibling sync de `parseBody` pour les GET routes avec query params. Signature `parseQuery<T>(request, schema): T`. Throw `BadRequestError` → `handleBadRequest` retourne 400 avec `{ error: 'Query invalide', issues }`. Schemas downstream utilisent `z.coerce.number()` / `z.coerce.boolean()` / `z.enum()` car `URLSearchParams` retourne uniquement des strings.

## 5. Côté client — react-hook-form + zodResolver

Pour les forms à validation, utiliser `react-hook-form` + `@hookform/resolvers/zod` avec le même schema serveur quand la shape est identique. Per-field error display via `form.formState.errors.<field>` ; serveur-side errors via un `useState('serverError')` séparé.

## 6. Patterns standardisés

### Pattern A — dual-type décimal pour `z.coerce.number()`

PoC Sprint Zod-Rollout v2 dans [components/dashboard/EditBalanceModal.tsx](../../components/dashboard/EditBalanceModal.tsx). Les schémas avec coerce ont input ≠ output types.

```ts
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { editBalanceFormSchema, type EditBalanceForm } from '@/lib/schemas/bank-balance'

type EditBalanceFormInput = z.input<typeof editBalanceFormSchema>

const form = useForm<EditBalanceFormInput, undefined, EditBalanceForm>({
  resolver: zodResolver(editBalanceFormSchema),
  defaultValues: { balance: currentBalance },
  mode: 'onSubmit',
})

const handleValidSubmit = async (data: EditBalanceForm) => { ... }

// Controller pattern pour décimaux fr-FR (comma → dot normalization)
<Controller
  control={form.control}
  name="balance"
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
      aria-invalid={form.formState.errors.balance ? 'true' : 'false'}
    />
  )}
/>
```

### Pattern B — text-only

`form.register('field')` direct, pas de Controller. PoC v1 inscription, v3 connexion/EditProfile/FirstTimeProfile.

### Pattern C — edit dialog avec `key={editing.id}`

Parent conditionally render `{isOpen && editing && <Modal key={editing.id} ... />}` ; child lit `defaultValues` une fois au mount. Sprint 1.5 standard pour les modal forms qui mirror un prop dans le state local.

### Pattern D — factory pour refines prop-dependent

Quand un schema doit valider contre des props parent (cas balance check budget : `currentBudgetsTotal + newAmount <= totalEstimatedIncome`), créer une factory et l'utiliser via `useMemo` :

```ts
// lib/schemas/budget.ts
export function makeBudgetClientSchema(opts: {
  currentBudgetsTotal: number
  totalEstimatedIncome: number
  currentBudgetAmount?: number  // 0 pour Add, editing.estimated_amount pour Edit
}) {
  return z.object({ name: ..., estimatedAmount: moneyFormSchema })
    .refine((d) => totalEstimatedIncome - (currentBudgetsTotal - currentBudgetAmount + d.estimatedAmount) >= 0,
            { message: '...', path: ['estimatedAmount'] })
}

// AddBudgetDialog.tsx / EditBudgetDialog.tsx
const schema = useMemo(
  () => makeBudgetClientSchema({ currentBudgetsTotal, totalEstimatedIncome }),
  [currentBudgetsTotal, totalEstimatedIncome],
)
type FormInput = z.input<typeof schema>
type FormOutput = z.output<typeof schema>
const form = useForm<FormInput, undefined, FormOutput>({
  resolver: zodResolver(schema), defaultValues: {...},
})
```

Le resolver capture la closure ; useForm reçoit un nouveau resolver à chaque recreation. Trade-off : si les props bougent pendant la saisie, RHF re-run la validation au prochain submit.

### Pattern E — useRavValidation hors schema

[`hooks/useRavValidation.ts`](../../hooks/useRavValidation.ts) calcule un blocage de soumission basé sur des données async (financialData, expenseProgress) qui peuvent refetcher pendant la saisie. **Ne PAS** l'embarquer dans le schema Zod — le hook reste hors-schema, consulté en `onValidSubmit` après le resolver :

```ts
const ravValidation = useRavValidation({ transactionType, isExceptional, amount: previewSafe, ... })

const onValidSubmit = async (data: AddTransactionFormOutput) => {
  if (ravValidation.blocked) {
    setServerError("Impossible d'ajouter cette dépense...")
    return
  }
  // submit
}
```

Le button disable continue de refléter l'état courant : `disabled={isSubmitting || ravValidation.blocked}`. Pattern dans [AddTransactionModal](../../components/dashboard/AddTransactionModal.tsx).

### Pattern F — serverError découplé useState

Mirror inscription PoC v1, v3 dans tous les forms avec onSubmit async. Server-side errors via un `useState<string | null>('serverError')` séparé de `form.formState.errors` (qui contient uniquement les erreurs Zod côté client).

### Pattern G — `useWatch` vs `form.watch()` (React Compiler)

Pour lire un champ réactivement (live preview, RAV check, conditional UI), utiliser `useWatch({ control: form.control, name: 'field' })` plutôt que `form.watch('field')`. `form.watch()` déclenche le warning ESLint `react-hooks/incompatible-library` du React Compiler ; `useWatch` est le hook canonique RHF et ne flag pas. **Pattern installé dans tous les forms avec preview/conditional rendering** ([AddIncomeDialog](../../components/dashboard/AddIncomeDialog.tsx), [EditIncomeDialog](../../components/dashboard/EditIncomeDialog.tsx), [AddBudgetDialog](../../components/dashboard/AddBudgetDialog.tsx), [EditBudgetDialog](../../components/dashboard/EditBudgetDialog.tsx), [AddTransactionModal](../../components/dashboard/AddTransactionModal.tsx), [EditTransactionModal](../../components/dashboard/EditTransactionModal.tsx)).

### Pattern H — `<DecimalFormInput>` composant réutilisable

Sprint Zod-Rollout v4 dans [components/ui/DecimalFormInput.tsx](../../components/ui/DecimalFormInput.tsx) — centralise le pattern `<Controller>` + regex `^(-?)?\d*[.,]?\d*$` + comma→dot conversion pour les forms à input décimal validés via `z.coerce.number()`.

**API** :

```tsx
<DecimalFormInput
  control={form.control}
  name="estimatedAmount"
  id="optional-id"
  placeholder="0.00"
  disabled={isSubmitting}
  ariaInvalid={!!fieldErrors.estimatedAmount}
  ariaDescribedby={fieldErrors.estimatedAmount ? 'amount-error' : undefined}
  allowNegative // opt-in pour ^-?\d*[.,]?\d*$ (EditBalance seulement)
  className="h-auto rounded-xl px-4 py-3 pr-12 focus-visible:ring-green-500" // override shadcn defaults
/>
```

**Consommé par 8 sites post-v4** : EditBalanceModal (suffix € + allowNegative), AddIncome/EditIncome/AddBudget/EditBudget (suffix € + focus-{green,orange}-500 via className), AddTransactionModal/EditTransactionModal (no suffix, w-full), CreateGroupForm (placeholder "Ex: 2500"). Wrapper suffix `€` reste consumer-side (`<div className="relative">` + DecimalFormInput + `<span className="absolute ...">€</span>`).

**Extensions Sprint v6** : (a) `ariaDescribedby?: string` prop ajoutée + propagée à `<Input aria-describedby={...}>` — consumer pattern `ariaDescribedby={fieldErrors.X ? '<id-prefix>-error' : undefined}` lié à un `id` sur l'`<p>` d'erreur. (b) `ref={field.ref}` + `onBlur={field.onBlur}` propagés à `<Input>` — Risk #1 mitigation pour `form.setFocus(name)` qui sinon sautait le champ wrappé par `<Controller>`.

## 7. Patterns a11y associés

### setFocus on invalid submit (Sprint v6)

Pour tout form `react-hook-form`, wrapper le submit handler avec un 2ᵉ argument `onInvalidSubmit` qui focus le premier champ erroné. Mirror sur les 14 forms du repo (4 auth + 10 client) :

```tsx
import { type FieldErrors, type FieldPath } from 'react-hook-form'

const onInvalidSubmit = (errors: FieldErrors<FormType>) => {
  const firstErrorKey = Object.keys(errors)[0]
  if (firstErrorKey) {
    form.setFocus(firstErrorKey as FieldPath<FormType>)
  }
}

<form onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}>
```

**Discriminated union edge case** (AddTransactionModal + EditTransactionModal) : `Object.keys(errors)[0]` peut retourner une clé absente du type (e.g. `'expense_date'` côté income). Le cast permissif `as FieldPath<FormType>` est fine — RHF résout le ref au runtime depuis la branche active. **DecimalFormInput dependency** : si le champ ciblé est un `<DecimalFormInput>`, vérifier que le composant propage `ref={field.ref}` au `<Input>` interne (Sprint v6 a corrigé ce gap). Sans cette propagation, `setFocus` saute le champ silencieusement.

### Discriminated union narrowing pour les FieldErrors (Sprint v3)

TS ne narrow PAS un objet `FieldErrors<DiscriminatedUnion>` sur une propriété non-discriminator (e.g. `fieldErrors.expense_date` vs `.entry_date`). Pour accéder à un field error dont le nom dépend du discriminator runtime (transactionType prop ou watch), utiliser un index permissif avec un cast minimal :

```ts
const dateError = (fieldErrors as Record<string, { message?: string } | undefined>)[
  transactionType === 'expense' ? 'expense_date' : 'entry_date'
]
```

Pattern dans [EditTransactionModal](../../components/dashboard/EditTransactionModal.tsx) + [AddTransactionModal](../../components/dashboard/AddTransactionModal.tsx).

### `<ModalCloseX>` composant (Sprint v10)

[components/ui/modal-close-x.tsx](../../components/ui/modal-close-x.tsx) centralise le pattern raw `<button>` + SVG path `M6 18L18 6M6 6l12 12` + `aria-label="Fermer"` + `aria-hidden="true"` sur le `<svg>` pour les close X des modals Radix migrés v8.

**API** :

```tsx
<ModalCloseX
  onClose={handleClose}
  disabled={isSubmitting} // ou isDeleting/isProcessing/loading selon le modal
  variant="circle" // ou "ghost"
  className="h-10 w-10" // override optionnel (cas SavingsDistribution drawer principal)
  svgClassName="h-5 w-5 text-gray-600" // override optionnel si className resize le button
  ariaLabel="Fermer" // default — i18n future-proof
/>
```

**Consommé par 11 sites dans 10 fichiers post-v10** : 7 sites circle (4 Add/Edit Budget/Income + PlanningDrawer + SavingsDistribution drawer principal avec `h-10 w-10` + svgClassName `h-5 w-5` + SavingsDistribution nested transfer avec `disabled={isProcessing}`) + 4 sites ghost (Add/EditTransactionModal `disabled={isSubmitting}` + GroupMembersWithContributions no disabled + DeleteGroupModal `disabled={isDeleting}` + `className="p-1"`).

## 8. Schemas client carved (Sprint v3)

Pour les forms client qui prennent du texte décimal en entrée (les inputs HTML retournent toujours du string), créer un schema variant avec `z.coerce.number()`. Pattern :

- [`moneyFormSchema`](../../lib/schemas/common.ts) : coerced positive 2-décimales. Réutilisable cross-domaine.
- Schemas dérivés : `createIncomeFormSchema` / `updateIncomeFormSchema` ([lib/schemas/income.ts](../../lib/schemas/income.ts)), `createGroupFormSchema` ([lib/schemas/groups.ts](../../lib/schemas/groups.ts)). Le server schema (avec `z.number()`) reste inchangé — coexiste avec le form variant.
- Pour les profile names (`first_name` / `last_name`) le UX historique exige min 2 chars vs server `min(1)` ; nouveau `profileNameFormFieldsSchema` ([lib/schemas/profile.ts](../../lib/schemas/profile.ts)) carve la version client stricte.
- **Schema discrimination union expense|income** : [`lib/schemas/transactions.ts`](../../lib/schemas/transactions.ts) expose `editTransactionFormSchema` + alias `addTransactionFormSchema`. Discriminated sur `transactionType` literal ; chaque branche a son date field (`expense_date` vs `entry_date`) et son FK (`estimated_budget_id` vs `estimated_income_id`) avec `.refine` XOR `is_exceptional` ↔ FK. Pour AddTransactionModal (transactionType mutable), `form.reset({ transactionType: newType, ... })` swap proprement de branche au radio click.

## 9. Tests des schemas

1-3 cas non-gated par schema, pattern miroir [lib/**tests**/auth-reducer.test.ts](../../lib/__tests__/auth-reducer.test.ts) — direct vitest imports, no mocks, `schema.safeParse()`. **11 fichiers de test** sous `lib/schemas/__tests__/` post-v2 (common/budget/income/expense-real/expense-add/savings/bank-balance/profile/auth/recap/recap-complete/groups) couvrant les schemas critiques (refine, discriminatedUnion, dispatch). Tests parseBody + parseQuery framework lui-même dans [lib/api/**tests**/parse-body.test.ts](../../lib/api/__tests__/parse-body.test.ts) (9 cas).

## 10. Migrations Zod par sprint (récapitulatif)

- **Sprint Zod-Rollout-Money-First** (2026-05-13) — 13 routes server-side : `savings/transfer`, `bank-balance`, `profile`, `monthly-recap/{auto-balance, balance, transfer, accumulate-piggy-bank, complete}`, `lib/api/finance/{budgets, incomes, expenses-real, expenses-add-with-logic, income-real}`. + `monthly-recap/process-step1` au Sprint Refactor-I5.
- **Sprint Zod-Rollout v2** (2026-05-13) — (a) 17 GET routes via `parseQuery` ; (b) 6 DELETE handlers via `deleteByIdQuerySchema` ; (c) 4 POST/PUT routes ; (d) 2 forgotten estimated POST+PUT ; (e) 1 debug POST (retrigger-recap). PoC client EditBalanceModal Pattern A dual-type.
- **Sprint Zod-Rollout v3** (2026-05-13) — 10 client forms migrés : trivial (6 — connexion, FirstTimeProfile, EditProfile, CreateGroupForm, AddIncomeDialog, EditIncomeDialog) + moderate (3 — AddBudget, EditBudget, EditTransaction) + complex (1 — AddTransactionModal avec wizard 2-step + useRavValidation séparation Pattern E).
- **Sprint Zod-Rollout v4** (2026-05-13) — 2 forms auth orphelins (forgot-password + reset-password) + extraction `<DecimalFormInput>` composant Pattern H + 8 sites consumer.
- **Sprint Zod-Rollout v5** (2026-05-13) — install RTL infra (jsdom + @testing-library/{react,user-event,jest-dom}) + `vitest.setup.ts` + `test.projects` split + 64 nouveaux tests RTL sur 15 fichiers `*.test.tsx`. Axe 5 a11y `aria-describedby` + `role="alert"` sur les 4 auth forms. Axe 6 drop unused var.
- **Sprint Zod-Rollout v6** (2026-05-13) — extension `aria-describedby` aux 10 forms client non-auth + Pattern v6 setFocus sur 14 forms + axe-core install (jest-axe@10) + premier audit auto sur ConnexionPage + AddBudgetDialog.
- **Sprint Zod-Rollout v7** (2026-05-13) — extension axe-core audit de 2 → 7 surfaces (3 auth + 2 modals) + propagation `aria-label="Fermer"` + `aria-hidden="true"` sur 9 fichiers raw/shadcn close X.
- **Sprint Zod-Rollout v8** (2026-05-14) — migration **structurale** 11 modals raw `<div className="fixed inset-0 ...">` → Radix `<Dialog>` + `<DialogContent>` via wrapper shadcn existant. Focus trap + Esc + return-focus + role=dialog + aria-modal natif. **Path B closed-by-deletion** GroupMembersModal (175 LOC, 0 consumer). Drawers via heavy `<DialogContent>` className override.
- **Sprint Zod-Rollout v9** (2026-05-14) — étend focus-trap RTL coverage de 2 → 12 surfaces + extraction `DRAWER_CONTENT_CLASSES` constante ([components/ui/drawer-content-classes.ts](../../components/ui/drawer-content-classes.ts)) + drop `selectedFromBudget?.X` workarounds nested modal via wrapper.
- **Sprint Zod-Rollout v10** (2026-05-14) — extraction `<ModalCloseX>` composant ([components/ui/modal-close-x.tsx](../../components/ui/modal-close-x.tsx)) + migration 11 sites dans 10 fichiers + helper test `expectEscClose()` ([components/\_\_tests\_\_/a11y-helpers.ts](../../components/__tests__/a11y-helpers.ts)) + migration 10/12 cas focus-trap.

**État actuel** : 100% des routes API du repo utilisent Zod (`parseBody` ou pattern inline pour les empty-body routes). 14 forms client migrés sur `react-hook-form` + `zodResolver`. Patterns A-H standardisés. 12 modals Radix-migrated avec focus trap natif. **Chantier a11y modal complètement clos** sur 3 sprints (v8/v9/v10).
