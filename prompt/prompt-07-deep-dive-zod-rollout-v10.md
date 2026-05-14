# Sprint Zod-Rollout v10 — Modal patterns extraction

> Sprint **optionnel** post-v8/v9. Le chantier a11y modal est clos depuis v8 (Radix migration) + v9 (DRY drawer + test coverage). v10 propose 2 axes de **consolidation finale** identifiés lors de la livraison v9 :
>
> - **Axe 1** — `<ModalCloseX>` composant réutilisable : les 12 modals migrés v8 partagent le MÊME bouton close X (SVG path + className + `aria-label="Fermer"` + `aria-hidden="true"` sur le `<svg>`) avec uniquement 2 variantes structurelles (raw `<button>` vs shadcn `<Button variant="ghost">`).
> - **Axe 2** — Helper de test `expectEscClose()` : les 12 cas focus-trap regression-guards dans `a11y-audit.test.tsx` répètent le même 5-line boilerplate (`userEvent.setup()` + `render()` + `waitFor(title)` + `user.keyboard('{Escape}')` + `expect(onClose).toHaveBeenCalled()`).
>
> Sprint **petite envergure** : ~1h30 estimé, valeur DRY pure, **0 changement utilisateur visible**, **0 changement test résultat** (mêmes assertions, signature plus concise). À déclencher uniquement si on touche les modals pour autre chose et qu'on profite du contexte, OU si un audit code review surface explicitement la duplication.

## Contexte

Sprint v8 (2026-05-14) a migré 11 modals vers Radix Dialog. Sprint v9 (2026-05-14) a consolidé le drawer pattern via `DRAWER_CONTENT_CLASSES` + étendu la couverture RTL focus-trap à 12 surfaces. Deux duplications subsistent :

1. **Close X button duplication** : grep `aria-label="Fermer"` retourne **≥11 hits** dans `components/` (12 modals + ServiceWorkerRegistration contexte différent). Chaque site fait :

   ```tsx
   <button
     type="button" // omitted for shadcn variant
     onClick={() => !isSubmitting && onClose()}
     aria-label="Fermer"
     className="..."
   >
     <svg className="..." fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
     </svg>
   </button>
   ```

   Le SVG path est **identique** dans les 12 surfaces. Le className varie (`flex h-8 w-8 ...` vs `h-9 w-9 ...`) selon la variante visuelle (small icon button vs ghost button avec padding).

2. **Focus-trap test boilerplate** : dans [components/\_\_tests\_\_/a11y-audit.test.tsx](../../components/__tests__/a11y-audit.test.tsx), les 12 tests du `describe('Radix Dialog focus-trap + Esc-to-close (regression-guard)')` partagent le même squelette :

   ```tsx
   it('XxxModal: Esc keydown invokes onClose', async () => {
     const onClose = vi.fn()
     const user = userEvent.setup()
     render(<XxxModal isOpen onClose={onClose} {...props} />)
     await waitFor(() => {
       expect(screen.getByText('<Title>')).toBeInTheDocument()
     })
     await user.keyboard('{Escape}')
     expect(onClose).toHaveBeenCalled()
   })
   ```

## Phase 1 — Audit pré-sprint

Avant de coder, 1 Explore agent (ou Read direct) pour confirmer :

1. **Inventaire close X sites stable** : grep `aria-label="Fermer"` dans `components/`. Attendu ≥11 hits dans les 9 fichiers v6/v7 + v8/v9 close buttons (Edit/Add Budget/Income + Add/EditTransactionModal + PlanningDrawer + SavingsDistributionDrawer×2 + DeleteGroupModal + GroupMembersWithContributionsModal + ConfirmationDialog). Identifier les 2 variantes structurelles :
   - Variante A — raw `<button onClick>` (Edit/Add Budget/Income, PlanningDrawer, SavingsDistributionDrawer×2 = 6 sites)
   - Variante B — shadcn `<Button variant="ghost">` (Add/EditTransactionModal, GroupMembersWithContributions, DeleteGroup = 4 sites)
   - Variante C — autre ? (ConfirmationDialog might use a different pattern — verify)

2. **Inventaire focus-trap tests** : confirmer 12 cas dans `a11y-audit.test.tsx` (2 v8 + 10 v9). Vérifier que tous suivent le même pattern d'assertion (pas de cas spécial qui diverge).

3. **Tester si shadcn `<Button>` peut être stylé pour matcher la variante A** : la variante A fait `flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 ...`. La variante B fait `<Button variant="ghost" size="sm">`. Si shadcn `<Button>` accepte ces overrides via `className`, on peut unifier à 1 seul composant `<ModalCloseX variant="circle" | "ghost">`. Sinon, on garde 2 patterns internes (mais 1 seul export public).

## Axe 1 — `<ModalCloseX>` composant réutilisable

### Création

`components/ui/modal-close-x.tsx` (~50 LOC + JSDoc) :

```tsx
import { cn } from '@/lib/utils'

interface ModalCloseXProps {
  onClick: () => void
  disabled?: boolean
  /**
   * 'circle' : raw <button> avec bg-gray-100 + rounded-full (default).
   *   Used by 6 modals (Edit/Add Budget/Income, PlanningDrawer, SavingsDistribution×2).
   * 'ghost'  : shadcn <Button variant="ghost"> (h-9 w-9, transparent bg).
   *   Used by 4 modals (Add/EditTransactionModal, GroupMembers, DeleteGroup).
   */
  variant?: 'circle' | 'ghost'
  className?: string
  /**
   * Override the default "Fermer" aria-label (rare — preserve for i18n if needed).
   */
  ariaLabel?: string
}

/**
 * Close X button used inside Radix Dialog headers since Sprint Zod-Rollout v8.
 * Centralizes the SVG path + aria-label + aria-hidden pattern that was
 * duplicated across 10 modal surfaces. Variant prop preserves the 2 visual
 * styles (rounded gray circle vs shadcn ghost) without forcing one over the
 * other.
 *
 * Use inside a <DialogContent> header. Disabled state respects the parent's
 * isSubmitting/isProcessing/isDeleting/loading flag.
 */
export function ModalCloseX({
  onClick,
  disabled = false,
  variant = 'circle',
  className,
  ariaLabel = 'Fermer',
}: ModalCloseXProps) {
  if (variant === 'ghost') {
    // shadcn Button is too heavy a dependency for this — keep it minimal with a button
    return (
      <button
        type="button"
        onClick={() => !disabled && onClick()}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-gray-100',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <CloseSvg />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <CloseSvg />
    </button>
  )
}

function CloseSvg() {
  return (
    <svg
      className="h-4 w-4 text-gray-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
```

### Migration

10 sites consommateurs migrent leur close X inline vers :

```tsx
<ModalCloseX
  onClick={onClose}
  disabled={isSubmitting} // ou isProcessing/isDeleting/loading selon le modal
  variant="circle" // ou "ghost"
/>
```

Estimation par site : −10/−15 LOC. Total : −100/−150 LOC sur les 10 sites + +60 LOC nouveau module = **net −50/−90 LOC**.

### Edge cases

- **`<Button variant="ghost">` shadcn caller** : si le caller utilise le shadcn `<Button>` exactement, l'API gain pourrait être minime. Vérifier au cas par cas si on garde shadcn (variant 'ghost' alternative) ou si on remplace par le button natif (cohérence).
- **ConfirmationDialog** : possiblement pas de close X (juste Annuler/Confirmer buttons). Vérifier en Phase 1.
- **Color customization** : 1 ou 2 sites pourraient utiliser une couleur différente du gray-600 (e.g. red sur DeleteGroup ?). Si oui, ajouter un prop `iconClassName` ou `tone="danger" | "default"`.

### Tests

1 nouveau fichier test [components/ui/\_\_tests\_\_/ModalCloseX.test.tsx](../../components/ui/__tests__/ModalCloseX.test.tsx) (~4 cas non-gated) :

- Rendu variant 'circle' : button has `aria-label="Fermer"` + bg-gray-100 + rounded-full
- Rendu variant 'ghost' : button has rounded-md (pas rounded-full) + h-9 w-9
- Click fires onClick prop
- Disabled state : onClick NOT fired when disabled=true (test the `!disabled && onClick()` guard)

## Axe 2 — Helper de test `expectEscClose()`

### Création

`components/__tests__/a11y-helpers.ts` (~25 LOC + JSDoc) :

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import type { ReactElement } from 'react'

/**
 * Asserts that pressing Escape inside the rendered Dialog invokes its onClose
 * callback. Centralizes the focus-trap regression-guard boilerplate that was
 * duplicated across 12 test cases in a11y-audit.test.tsx since Sprint v8/v9.
 *
 * The caller must :
 * (a) define a `vi.fn()` for onClose,
 * (b) include onClose={onCloseSpy} in the rendered component's props,
 * (c) provide the DialogTitle text (or regex) to assert mount completion.
 *
 * Example :
 *   const onClose = vi.fn()
 *   await expectEscClose(<AddBudgetDialog isOpen onClose={onClose} ... />, onClose, 'Nouveau Budget')
 */
export async function expectEscClose(
  element: ReactElement,
  onClose: ReturnType<typeof vi.fn>,
  titleText: string | RegExp,
): Promise<void> {
  const user = userEvent.setup()
  render(element)
  await waitFor(() => {
    expect(screen.getByText(titleText)).toBeInTheDocument()
  })
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
}
```

### Migration

Les 12 cas focus-trap dans `a11y-audit.test.tsx` deviennent :

```tsx
it('AddBudgetDialog: Esc keydown invokes onClose', async () => {
  const onClose = vi.fn()
  await expectEscClose(
    <AddBudgetDialog
      isOpen
      onClose={onClose}
      onSave={async () => true}
      currentBudgetsTotal={500}
      totalEstimatedIncome={2000}
    />,
    onClose,
    'Nouveau Budget',
  )
})
```

Estimation par cas : −5 LOC. Total : −60 LOC sur les 12 tests + +25 LOC helper = **net −35 LOC**.

### Edge cases

- **EditTransactionModal** : assertion via `getByRole('heading', { level: 2, name: /Modifier la dépense/i })` parce que "Modifier la dépense" apparaît dans `<h2>` ET `<Button>`. Le helper accepte regex. Pour ce cas spécial, ajouter un overload :

  ```tsx
  export async function expectEscClose(
    element: ReactElement,
    onClose: ReturnType<typeof vi.fn>,
    selector: { role?: string; level?: number; name: string | RegExp } | string | RegExp,
  ): Promise<void> {
    // ... use getByRole if selector is object, else getByText
  }
  ```

  Ou plus simple : laisser ce cas EditTransaction comme un test à part qui ne passe pas par le helper (1 cas spécial sur 12 = acceptable).

- **Nested stacking test** (PlanningDrawer + AddBudget child) : flow complexe (click puis 2 Esc consécutifs avec assertions intermédiaires). Le helper ne couvre PAS ce cas. Test reste manuel.

### Pattern à reprendre

Pour tout nouveau modal migré Radix dans le futur, ajouter un cas focus-trap via `expectEscClose(<NewModal ... />, onClose, '<Title>')` en 4-5 lignes au lieu de 8-10.

## Découpage commits (3 + closeout)

### Commit 1 — Axe 1 `<ModalCloseX>` création + tests

**Crée** : [components/ui/modal-close-x.tsx](../../components/ui/modal-close-x.tsx) (~60 LOC) + [components/ui/\_\_tests\_\_/ModalCloseX.test.tsx](../../components/ui/__tests__/ModalCloseX.test.tsx) (~30 LOC, 4 cas).

**Verif** : `pnpm typecheck` + `pnpm test:run components/ui/__tests__/ModalCloseX.test.tsx` (4/4 pass).

### Commit 2 — Axe 1 migration 10 sites

**Touche** : 10 modal files (4 dashboard + 2 drawers + 4 groups/ui).

Pour chaque site : drop le `<button onClick> ... <svg> ... </svg></button>` inline (12-15 LOC), replace by `<ModalCloseX ... />` (3-5 LOC) + ajout import. Run `pnpm test:run components/__tests__/a11y-audit.test.tsx` après chaque file pour catch any regression.

**Verif** : `pnpm typecheck` + `pnpm lint:check` (180 stable) + `pnpm test:run` (289 stable — le close X ne change pas le Esc-close path, donc les focus-trap tests doivent rester verts).

### Commit 3 — Axe 2 `expectEscClose()` helper + migration

**Crée** : [components/\_\_tests\_\_/a11y-helpers.ts](../../components/__tests__/a11y-helpers.ts) (~25 LOC).
**Touche** : a11y-audit.test.tsx — migrer 11 des 12 cas (EditTransactionModal reste manuel par le `getByRole` cas spécial, OR ajouter overload au helper).

**Verif** : `pnpm test:run components/__tests__/a11y-audit.test.tsx` (19/19 pass, attendu identique).

### Commit 4 — Closeout CLAUDE.md + README

- §1 score : ajout v10 entry
- §11 : nouvelle entrée v10
- README Sécurité : ajout paragraphe v10

## Verification

```powershell
pnpm typecheck
pnpm lint:check
pnpm test:run
```

**Attendu post-sprint** :

- `pnpm typecheck` exit 0
- `pnpm lint:check` 0 errors / **180 warnings stable**
- `pnpm test:run` **289 → 293 passed / 64 skipped** (+4 ModalCloseX tests, focus-trap tests inchangés en count)
- Pas de `pnpm verify` (aucun changement DB)
- LOC delta brut : −50 à −90 (close X) + −35 (test helper) + +85 (nouveau code) = **net ~−85 LOC**

**Negative greps post-sprint** :

- `Grep "M6 18L18 6M6 6l12 12" components/` → 1 hit (le SVG path centralisé dans ModalCloseX.tsx)
- `Grep "aria-label=\"Fermer\"" components/` → 1 hit (dans ModalCloseX.tsx) + 1 hit dans ServiceWorkerRegistration (out of scope, hors modal)

## Critères de succès

- ✅ `<ModalCloseX>` consommé par 10 modal sites (DRY violation v8/v9 fermée)
- ✅ Helper `expectEscClose()` consommé par ≥11 des 12 cas focus-trap
- ✅ Lint baseline 180 stable, tests 289 → ~293, typecheck OK
- ✅ Smoke browser : close X visuellement identique pré-v10 sur les 10 modals (variant circle/ghost preserved)
- ✅ 0 régression a11y (axe-core audit reste vert)

## Hors scope explicite

- `<ModalDrawer>` shadcn-style wrapper composant pour les 2 drawers — **pas justifié** : seulement 2 sites (< CLAUDE.md threshold "3 similar lines is better than premature abstraction"), et `DRAWER_CONTENT_CLASSES` (v9) déjà fournit le 80/20.
- Tab cycle / outside-click / return-focus tests pour les modals — Radix les fournit nativement, pas de valeur regression-guard supplémentaire pour ce point.
- Color theming (DeleteGroup close X en rouge ?) — défer si signalement design.
- Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup / OpenAPI — roadmap inchangée.

## Trade-off documenté

v10 ne fait pas avancer le score métier. Pure consolidation post-v9 :

- (a) DRY violation close X fermée (1 site de vérité pour le SVG path + a11y attributes)
- (b) Test helper DRY (1 site de vérité pour le focus-trap pattern)
- (c) Pattern à reprendre pour tout nouveau modal migré Radix dans le futur

Sprint optionnel — si la prochaine session vise un saut métier (Tailwind v4, Chantier I6, etc.), reporter v10 ad-hoc PR-by-PR quand on touche les modals pour autre chose.

## Estimation

- Phase 1 audit : ~10 min (grep + Read)
- Commit 1 ModalCloseX création + tests : ~30 min
- Commit 2 migration 10 sites : ~30 min (3 min/site)
- Commit 3 helper + test migration : ~20 min
- Commit 4 closeout : ~15 min

**Total : 1h45 ± 20 min**
