# Sprint Zod-Rollout v4 — Closeout auth client surface + (optionnel) factor `<DecimalFormInput>`

> ⚠️ Lire d'abord [`CLAUDE.md`](../CLAUDE.md) §6 "Validation Zod (parseBody)" + §11 entrées Sprint Zod-Rollout v1 → v3.
> Le v3 a livré les 10 client forms du périmètre principal (AddIncome/EditIncome/EditProfile/FirstTimeProfile/CreateGroup/connexion + 3 moderate + AddTransaction). Le v4 ferme **2 pages auth orphelines** (forgot-password + reset-password) qui ont été manquées par l'inventaire v3 — et propose en option d'extraire un composant `<DecimalFormInput>` réutilisable maintenant que 7 forms partagent le même pattern Controller + regex.

## Contexte

Le Sprint Zod-Rollout v3 (livré 2026-05-13, 3 commits + closeout) a migré 10 client forms identifiés dans le prompt v3. **Inventaire post-livraison** :

- ✅ Le périmètre du prompt v3 est entièrement couvert (10 forms / 10).
- ⚠️ **2 forms auth ont été manqués** par l'inventaire v3 :
  - [`app/forgot-password/page.tsx`](../app/forgot-password/page.tsx) — 1 champ email + validation manuelle (`if (!email)` + `if (!email.includes('@') || !email.includes('.'))`). Pattern identique aux 6 forms trivial du v3.
  - [`app/reset-password/page.tsx`](../app/reset-password/page.tsx) — 2 champs password + confirmPassword + validation manuelle (`length < 6` + `password !== confirmPassword`). Pattern miroir de `signupBodySchema` v1 mais sans email.
- 🎯 **Opportunité de factorisation** : les 7 forms décimaux v3 (`EditBalance` v2 + `AddIncome` + `EditIncome` + `CreateGroup` + `AddBudget` + `EditBudget` + `EditTransaction` + `AddTransaction`) partagent un Controller quasi-identique :
  ```tsx
  <Controller
    control={form.control}
    name="estimatedAmount"
    render={({ field }) => (
      <Input
        type="text"
        inputMode="decimal"
        value={field.value == null ? '' : String(field.value)}
        onChange={(e) => {
          const v = e.target.value
          if (v === '' || /^\d*[.,]?\d*$/.test(v)) {
            field.onChange(v.replace(',', '.'))
          }
        }}
        aria-invalid={fieldErrors.estimatedAmount ? 'true' : 'false'}
      />
    )}
  />
  ```
  ~17 lignes par site × 8 sites = ~140 LOC dupliquées. Candidat à un composant `<DecimalFormInput control={form.control} name="..." />` (~30 LOC réutilisable).

## Scope (ARBITRER QUAND TU LANCES CE PROMPT)

**Axe 1 — auth password forms (recommandé)** :

1. Migrer `app/forgot-password/page.tsx` vers `useForm` + `zodResolver`.
   - Nouveau schema : `forgotPasswordFormSchema = z.object({ email: z.string().trim().email("Format d'email invalide") })` dans `lib/schemas/auth.ts`.
   - OU réutiliser un sous-set du `signupBodySchema` (les types `Pick<SignupBody, 'email'>` peuvent suffire, mais un schema dédié est plus explicite).
   - Pattern : Text-only B (`form.register('email')` direct).
   - Server-side errors (Supabase `resetPasswordForEmail` rate limit / network) → `useState<string | null>(serverError)` séparé (mirror connexion v3).

2. Migrer `app/reset-password/page.tsx` vers `useForm` + `zodResolver`.
   - Nouveau schema : `resetPasswordFormSchema` dans `lib/schemas/auth.ts` :
     ```ts
     export const resetPasswordFormSchema = z
       .object({
         password: z.string().min(6, 'Le mot de passe doit contenir au moins 6 caractères'),
         confirmPassword: z.string().min(1, 'Confirmation requise'),
       })
       .refine((d) => d.password === d.confirmPassword, {
         message: 'Les mots de passe ne correspondent pas',
         path: ['confirmPassword'],
       })
     ```
   - Pattern : Text-only B + Pattern F serverError.
   - **Préserver verbatim** : la logique de validation du token (`validateToken` useEffect + `isValidToken` state + 3 sub-states `validatingToken` / `success` / form). Le `useForm` ne couvre QUE le form lui-même, pas le state-machine.
   - Server-side errors mapping : `session_not_found`, `New password should be different from the old password`, `password` keyword catch (≥3 cas), generic fallback.

**Axe 2 — `<DecimalFormInput>` reusable component (optionnel, gain ~−100 LOC)** :

Extraire un composant générique dans `components/ui/DecimalFormInput.tsx` :

```tsx
'use client'

import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { Input } from '@/components/ui/input'

interface DecimalFormInputProps<T extends FieldValues> {
  control: Control<T>
  name: FieldPath<T>
  id?: string
  placeholder?: string
  disabled?: boolean
  ariaInvalid?: boolean
  className?: string
}

export function DecimalFormInput<T extends FieldValues>({
  control,
  name,
  id,
  placeholder = '0.00',
  disabled,
  ariaInvalid,
  className,
}: DecimalFormInputProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={field.value == null ? '' : String(field.value)}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || /^-?\d*[.,]?\d*$/.test(v)) {
              field.onChange(v.replace(',', '.'))
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid ? 'true' : 'false'}
          className={className}
        />
      )}
    />
  )
}
```

Sites à migrer : 8 forms (EditBalanceModal v2 + les 7 nouveaux v3 — AddIncome, EditIncome, AddBudget, EditBudget, AddTransactionModal, EditTransactionModal, CreateGroupForm).

**Trade-off à arbitrer** :

- Pour : DRY, single source of truth, easier to evolve (e.g. ajouter un blur handler qui efface les inputs partiels `-` / `.` non-parsables).
- Contre : les 7 forms ont des styles légèrement différents (classNames Tailwind différents, certains ont un suffixe `€` à droite, certains n'en ont pas). Le composant doit accepter un `suffix?: ReactNode` ou `children` pour rester flexible. Risque de "design for hypothetical" si le composant grossit pour absorber les variations.
- **Note CLAUDE.md "Three similar lines is better than premature abstraction"** : 8 sites est au seuil. Faut-il extraire maintenant ou attendre la 10e copie ? Mon arbitrage : **8 sites = OK extraire**, mais garder le composant minimal (juste le pattern Controller + regex, pas les classNames / suffixes — laisser ceux-ci au consumer via props ou wrapping `<div>`).

**Axe 3 — cleanup lint baseline (trivial)** :

Le lint baseline 182 contient encore 1 warning `MonthlyRecapStep2.tsx:135 'currentTotalDeficit' is assigned a value but never used`. Si tu ouvres ce fichier pour autre chose, en profiter pour drop la variable. Pas worth un commit dédié.

## Décisions à demander à l'utilisateur

- **Q1 Scope** : Axe 1 only (2 auth forms) / Axe 1 + Axe 2 (factor `<DecimalFormInput>`) / Axe 1 + Axe 2 + Axe 3 (full sweep).
- **Q2 Schema location auth** : (a) Ajouter à `lib/schemas/auth.ts` (cohérent avec `signupBodySchema` + `loginFormSchema`) (Recommandé), (b) Nouveau `lib/schemas/auth-password.ts` séparé.
- **Q3 Découpage commits** : (a) 1 commit `feat(forms): migrate auth password forms` + 1 commit `refactor(ui): extract DecimalFormInput` (si Axe 2). (b) 1 commit "all v4". Mon vote (a) — chaque commit est un changement logique distinct.
- **Q4 Tests** : 1-3 cas par nouveau schema dans `lib/schemas/__tests__/auth.test.ts` (mirror v1/v2 pattern) — non-gated, ~10ms.

## Fichiers concernés

```
A NEW   lib/schemas/auth.ts                       # +forgotPasswordFormSchema +resetPasswordFormSchema (Axe 1)
M       app/forgot-password/page.tsx              # migration RHF + zodResolver (Axe 1)
M       app/reset-password/page.tsx               # migration RHF + zodResolver (Axe 1, préserver token validation state-machine)
A NEW   components/ui/DecimalFormInput.tsx        # composant réutilisable (Axe 2)
M (×8)  components/dashboard/{AddIncome,EditIncome,AddBudget,EditBudget,AddTransactionModal,EditTransactionModal}.tsx
M       components/dashboard/EditBalanceModal.tsx # v2 PoC peut adopter le composant aussi (Axe 2)
M       components/groups/CreateGroupForm.tsx     # (Axe 2)
M       lib/schemas/__tests__/auth.test.ts        # +3-6 cas (Axe 1)
M       CLAUDE.md                                 # §6 ajouter mention `<DecimalFormInput>` si Axe 2 + §11 nouvelle entrée Sprint v4
```

## Critères de succès

- 2 auth forms passent au RHF + zodResolver (Axe 1)
- Si Axe 2 : 8 sites consomment `<DecimalFormInput>`, ~−100 LOC nets
- `pnpm verify` exit 0 à chaque commit
- Lint baseline stable (182 warnings, peut descendre à 181 si Axe 3 fait)
- Tests stable ou +3-6 cas non-gated (Axe 1 schemas)
- 0 migration DB, 0 nouveau test gated

## Verification

```bash
pnpm typecheck && pnpm lint:check && pnpm test:run && pnpm format:check
```

Negative greps :

- `Grep "useState<string>\|setError" app/forgot-password/page.tsx app/reset-password/page.tsx` → 0 hit pour les state manuels remplacés (mais `serverError` séparé OK)
- Si Axe 2 : `Grep "type=\"text\".*inputMode=\"decimal\".*onChange.*replace" components/` → 0 hit (tout migré sur `<DecimalFormInput>`)
- Positive : `Grep "DecimalFormInput" components/` → 8 hits si Axe 2 livré

## Smoke browser (deferred)

- `/forgot-password` : email vide → erreur inline ; email invalide → erreur inline ; email valide → success state.
- `/reset-password?token=...` : token invalide → invalid state ; password <6 → erreur inline ; passwords ≠ → erreur inline sous confirmPassword ; valide → success → /connexion redirect.
- Si Axe 2 : flow rapide AddIncome / AddBudget / AddTransaction pour vérifier le composant DecimalFormInput n'a pas régressé l'UX (comma→dot, regex partial input).

## Out of scope (explicite — déjà roadmappés ailleurs)

- **RTL tests client forms** : Sprint Zod-v5-Client-Testing dédié si surface assez grande (10 forms v3 + 2 v4 = 12 candidats × ~5 cas = ~60 nouveaux tests RTL). Trade-off : c'est un investment coverage important — à arbitrer si les forms continuent d'évoluer ou si l'app est en mode maintenance.
- **Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup** : roadmappés CLAUDE.md §11, hors scope Zod.
- **OpenAPI / schema-to-docs** : R10 audit, séparé.
- **Refactor monthly-recap stateful routes** : couplé I6, hors scope Zod.

## Risques résiduels

- **Reset-password token validation state-machine** : la migration RHF ne doit toucher QUE le form (le state-machine `validatingToken` → `isValidToken` → `success` → form reste verbatim). Risque de casser le flow auth si on déplace la logique de validation token.
- **DecimalFormInput générique** (Axe 2) : 8 sites ont des styles légèrement différents (3 forms `<input>` raw, 5 forms `<Input>` shadcn). Le composant doit utiliser `<Input>` (shadcn) et laisser le wrapper consumer gérer le suffixe `€` via `<div className="relative">`. Si certains forms refusent shadcn `<Input>` (cas AddIncomeDialog raw input), accepter une variante OU faire 2 composants `<DecimalFormInput>` (shadcn) + `<DecimalRawInput>` (raw) — mais c'est probablement overkill.

## Prochaine étape après v4

Si Axe 1 + Axe 2 livrés, le chantier Zod-client est **complètement fermé** : tous les forms client du repo utilisent RHF + zodResolver, et le pattern décimal est centralisé. Score estimé après v4 : ~99.99 → ~99.995/100 (consolidation, pas saut métier).

Si tu identifies des forms encore non migrés au Phase 1 audit (e.g. composants oubliés dans `components/profile/*` ou `app/settings/*`), les ajouter au scope v4 ou créer un v5.
