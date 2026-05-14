# Sprint Zod-Rollout v9 — Test coverage extension + v8 cleanup

> Sprint **optionnel** post-v8. v6+v7+v8 ont clos le chantier a11y modal (close button + axe-core + Radix structural migration). v9 propose 2 axes de **consolidation post-v8** identifiés lors du closeout v8 :
>
> - **Axe 1** — étendre la couverture RTL focus-trap des 2 cas Esc-close (v8 Commit 6) aux 9 autres modals migrés + 1 test de nested stacking (PlanningDrawer + child)
> - **Axe 2** — 2 petits cleanups du code v8 (DRY sur l'override className drawer + drop des `selectedFromBudget?.X` optional chaining workaround)
>
> Sprint **petite envergure** : ~1h30 estimé, valeur a11y test + propreté code, **0 changement utilisateur visible**. À déclencher si le score métier n'est pas l'objectif d'une session future et qu'on veut juste solidifier ce qui a été livré.

## Contexte

Sprint v8 (2026-05-14) a migré **11 modals** vers Radix Dialog en 6 commits (`8289419` → `b8742fe`). Le **Commit 6** a ajouté 2 cas focus-trap regression-guards dans [components/\_\_tests\_\_/a11y-audit.test.tsx](../components/__tests__/a11y-audit.test.tsx) :

- EditBudgetDialog : Esc-close → onClose called
- AddTransactionModal : Esc-close → onClose called

**Gap identifié post-v8** : les 9 autres modals migrés (Edit/Add Income, AddBudget, EditTransaction, GroupMembersWithContributions, DeleteGroup, ConfirmationDialog, PlanningDrawer, SavingsDistributionDrawer + son nested transfer modal) **n'ont pas** de focus-trap regression-guard. Une régression future (e.g. retour à raw `<div>` ou bug Radix upstream) sur l'un de ces 9 surfaces ne serait catché par aucun test — uniquement par smoke browser.

**Cleanups v8 identifiés mid-sprint** :

1. **Drawer className override dupliqué** : les ~12 utility classes `cn('inset-0 left-0 top-0 h-screen w-screen max-h-screen max-w-none translate-x-0 translate-y-0 sm:inset-0 ...')` sont copiées-collées dans **2 fichiers** (PlanningDrawer.tsx + SavingsDistributionDrawer.tsx). Violation DRY mineure mais réelle. Pattern : extraire `DRAWER_CONTENT_CLASSES` constante dans un module dédié.

2. **`selectedFromBudget?.X` optional chaining** : SavingsDistributionDrawer L491+494+517 utilisent `selectedFromBudget?.name` et `selectedFromBudget?.cumulated_savings` parce que v8 a dropé le `{selectedFromBudget && (...)}` conditional render wrapper (Dialog `open=isTransferModalOpen && !!selectedFromBudget` gère la visibilité, mais TS ne narrow pas le prop). Le `?.` est safe mais affiche `undefined.toString()` → `"undefined"` si jamais le Dialog est mounted avec `selectedFromBudget=null`. Cleanup : wrapper le contenu interne en `{selectedFromBudget && (...)}` à l'intérieur du DialogContent, et restorer les accès directs `selectedFromBudget.X` à l'intérieur du wrapper.

## Phase 1 — Audit pré-sprint (Explore)

Avant de coder, 1 Explore agent pour confirmer :

1. **L'inventaire des modals v8** (11 fichiers) est bien stable. Grep `from '@/components/ui/dialog'` dans components/ → attendu ≥14 hits (3 pre-v8 + 11 v8). Pas de régression silencieuse vers raw `<div>`.

2. **Le DRY drawer className** est bien limité à 2 fichiers (PlanningDrawer + SavingsDistributionDrawer). Si un futur drawer apparaît entre v8 et v9 (cf. nouveau code), l'extension réduirait > 50% de duplication.

3. **Le contrat de `vi.mock('@/lib/supabase-client', ...)` dans a11y-audit.test.tsx** supporte bien tous les modals que je veux tester (les 4 vi.fn auth + le mock CustomDropdown sont actuellement consommés par 7 cas axe-core). Si certains modals testés en v9 utilisent un mock supplémentaire (e.g. `useFinancialData`, `useProgressData` pour SavingsDistributionDrawer), il faudra l'ajouter ou skipper ces surfaces.

## Axe 1 — RTL focus-trap coverage extension

### Surfaces à couvrir

| Modal                                | Type      | Mock surface                                              | Cas |
| ------------------------------------ | --------- | --------------------------------------------------------- | --- |
| EditBudgetDialog                     | centered  | (already in v8 Commit 6)                                  | ✅  |
| AddTransactionModal                  | centered  | (already in v8 Commit 6)                                  | ✅  |
| EditIncomeDialog                     | centered  | none                                                      | +1  |
| AddIncomeDialog                      | centered  | none                                                      | +1  |
| AddBudgetDialog                      | centered  | none                                                      | +1  |
| EditTransactionModal                 | centered  | 6-hook copy de AddTransactionModal                        | +1  |
| GroupMembersWithContributionsModal   | centered  | useGroupMembers + useGroupContributions                   | +1  |
| DeleteGroupModal                     | centered  | none (stateless)                                          | +1  |
| ConfirmationDialog                   | utility   | none (props-driven)                                       | +1  |
| PlanningDrawer (drawer)              | drawer    | useBudgets + useIncomes + useBudgetProgress + useIncomeProgress + useProfile | +1  |
| SavingsDistributionDrawer (drawer)   | drawer    | useQuery savings-data + state-driven                      | +1  |
| Nested: PlanningDrawer + AddBudget child | nested | Same as PlanningDrawer + react-hook-form                  | +1  |

**Total : +9 cas** (passer de 2 → 11 focus-trap regression-guards). Wall time attendu ~3s additional vs ~1s actuel.

### Pattern type pour chaque cas

Mirror v8 Commit 6 pattern :

```tsx
it('XxxModal: Esc keydown invokes onClose', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<XxxModal isOpen onClose={onClose} {...required-props} />)
  await waitFor(() => {
    expect(screen.getByText('Modal Title Text')).toBeInTheDocument()
  })
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
```

### Cas spécial — nested stacking (PlanningDrawer + AddBudgetDialog child)

```tsx
it('PlanningDrawer with AddBudget child: Esc closes child first, then drawer', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<PlanningDrawer isOpen onClose={onClose} />)
  await waitFor(() => {
    expect(screen.getByText('Planification Financière')).toBeInTheDocument()
  })

  // Ouvrir le child via le bouton "+" (ou simuler le click)
  // Cela dépend de la structure interne du drawer — Phase 1 doit auditer
  // le pattern d'ouverture (probablement onClick={() => setIsAddBudgetOpen(true)})

  // ... (open AddBudgetDialog)
  await waitFor(() => {
    expect(screen.getByText('Nouveau Budget')).toBeInTheDocument()
  })

  // First Esc — ferme le child
  await user.keyboard('{Escape}')
  await waitFor(() => {
    expect(screen.queryByText('Nouveau Budget')).not.toBeInTheDocument()
  })
  expect(onClose).not.toHaveBeenCalled() // drawer parent encore ouvert

  // Second Esc — ferme le drawer parent
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
```

**Risque** : ce test dépend de la structure interne du PlanningDrawer pour ouvrir le child. Si elle est trop complexe (passage par hook `useBudgets.addBudget` etc.), simplifier en mockant directement le `isAddBudgetOpen` state, ou skipper le cas et laisser un commentaire dans le test file pour documenter le gap.

### Pattern mocks consolidés

Si plusieurs modals partagent les mêmes mocks Supabase / hooks, garder le pattern actuel `vi.mock('@/lib/supabase-client', ...)` au top du fichier + mocks spécifiques inline dans le cas. Préférer la mutualisation à la duplication.

Pour SavingsDistributionDrawer : ses `useQuery({ queryKey: ['savings-data'] })` avec `enabled: isOpen` doit être mocké. Soit `vi.mock('@tanstack/react-query', ...)` pour stub le hook complet, soit fournir un QueryClient avec données pré-chargées via `setQueryData`. La seconde option est plus représentative mais plus de boilerplate.

## Axe 2 — Cleanup v8 mid-sprint

### 2.A — Extraction de la constante drawer className

**Action** : créer `components/ui/drawer-content-classes.ts` (ou inline dans `components/ui/dialog.tsx` comme `export const DRAWER_CONTENT_CLASSES`) :

```tsx
/**
 * Override className pour <DialogContent> qui transforme un modal centré
 * en drawer bottom-up fullscreen. Utilisé par les 2 drawers du repo
 * (PlanningDrawer + SavingsDistributionDrawer) post-Sprint Zod-Rollout v8.
 *
 * Si un 3ᵉ drawer apparaît OU si on observe un signalement drag-to-dismiss
 * desired, envisager la migration vers `vaul` + nouveau `components/ui/drawer.tsx`
 * wrapper shadcn — vaul fournit drag handle + snap points natifs.
 */
export const DRAWER_CONTENT_CLASSES = cn(
  // Override default centered modal sizing → fullscreen drawer
  'inset-0 left-0 top-0 h-screen w-screen max-h-screen max-w-none translate-x-0 translate-y-0',
  'sm:inset-0 sm:left-0 sm:max-w-none sm:translate-x-0',
  // Drop centered-modal chrome
  'rounded-none border-0 p-0 shadow-none sm:rounded-none',
  // Drawer body
  'flex flex-col gap-0 bg-white',
  // Override animations: slide from bottom
  'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  'data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100',
  'duration-300',
)
```

**Consommateurs** : PlanningDrawer.tsx + SavingsDistributionDrawer.tsx :

```tsx
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
// ...
<DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
```

Diff net : −20 LOC × 2 = −40 LOC, +30 LOC nouveau fichier = −10 LOC. Plus important : seul site de vérité pour le pattern drawer.

### 2.B — Drop des `selectedFromBudget?.X` workarounds

**Action** : wrapper le body interne du nested transfer Dialog dans `{selectedFromBudget && (...)}` :

```tsx
<Dialog open={isTransferModalOpen} onOpenChange={handleTransferModalOpenChange}>
  <DialogContent hideCloseButton className="...">
    {selectedFromBudget && (
      <>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <DialogTitle asChild>
            <h3 className="text-lg font-semibold text-gray-900">Transférer des économies</h3>
          </DialogTitle>
          {/* ... close button ... */}
        </div>

        {/* Body avec accès direct selectedFromBudget.X (plus de ?. ) */}
        <div className="rounded-xl bg-purple-50 p-3">
          <p>{selectedFromBudget.name}</p>
          <p>{formatCurrency(selectedFromBudget.cumulated_savings || 0)} disponibles</p>
        </div>
        {/* ... */}
      </>
    )}
  </DialogContent>
</Dialog>
```

**Changement open prop** : passer de `open={isTransferModalOpen && !!selectedFromBudget}` à `open={isTransferModalOpen}` (le child render guard remplace).

**Trade-off** : Dialog mount/unmount cycle change. Si `isTransferModalOpen=true` et `selectedFromBudget=null` (jamais en pratique mais possible par bug), le Dialog s'ouvre vide. Avec le current open prop, le Dialog reste closed. Le wrapper child garde l'invariant : Dialog content seulement quand selectedFromBudget truthy. Defensive.

Net LOC : −3 (drop `?.`) + 2 (open wrapper) + 2 (closing tags) = +1 LOC. Mais 0 workaround, TS narrow propre.

## Découpage commits (3 + closeout)

### Commit 1 — Axe 1 RTL coverage extension (1 fichier, +~9 cas)

**Touche** : [components/\_\_tests\_\_/a11y-audit.test.tsx](../components/__tests__/a11y-audit.test.tsx)

Action : étendre le `describe('Radix Dialog focus-trap + Esc-to-close (regression-guard)')` block avec les 9 nouveaux cas (Edit/Add Income, AddBudget, EditTransaction, GroupMembersWithContributions, DeleteGroup, ConfirmationDialog, PlanningDrawer, SavingsDistributionDrawer + nested stacking).

**Verif** : tests 279 → ~288. Lint baseline 180 stable. Typecheck OK.

### Commit 2 — Axe 2.A drawer className DRY

**Touche** : nouveau `components/ui/drawer-content-classes.ts` + edits PlanningDrawer.tsx + SavingsDistributionDrawer.tsx.

**Verif** : pnpm typecheck + lint:check + test:run, smoke browser ouverture drawers (visual parity check).

### Commit 3 — Axe 2.B selectedFromBudget cleanup

**Touche** : SavingsDistributionDrawer.tsx (3 sites `?.` + 1 nested wrapper + open prop change).

**Verif** : pnpm typecheck + lint:check + test:run, smoke browser ouverture transfer modal depuis un budget.

### Commit 4 — Closeout CLAUDE.md + README

Update §1 score (+0 — pure consolidation), §11 add v9 entry, README.md Sécurité section bump.

## Verification end-to-end

```powershell
pnpm typecheck
pnpm lint:check
pnpm test:run
```

**Attendu** :
- `pnpm typecheck` exit 0
- `pnpm lint:check` 0 errors / **180 warnings stable**
- `pnpm test:run` ~288 passed / 64 skipped (vs 279/64 pre-v9 = +9 focus-trap regression-guards)
- Pas de `pnpm verify` (aucun changement DB)

**Smoke browser deferred to user** :
1. `/dashboard` ouvrir PlanningDrawer → visual parity (slide-from-bottom, fullscreen, etc.) avec v8 ; identical sauf code interne extrait constante
2. `/dashboard` SavingsDistributionDrawer → ouvrir transfer modal depuis un budget → contenu rendered (plus de `undefined` visible si jamais le optional chaining tirait au render)

## Critères de succès

- ✅ +9 cas focus-trap regression-guards (toutes les surfaces v8 migrées + 1 nested test)
- ✅ Drawer className extrait en constante partagée (DRY)
- ✅ `selectedFromBudget?.X` workaround droppé (TS narrowing propre)
- ✅ Lint baseline 180 stable, tests 279 → ~288, typecheck OK
- ✅ 0 migration DB, 0 nouveau dep
- ✅ Score : ~99.999 → ~99.999 stable (pure consolidation, pas de saut métier)

## Hors scope explicite

- **vaul migration pour drawers** (drag-to-dismiss) — déférer tant que pas de signalement keyboard user ou audit RGAA AA
- **Storybook setup** pour visual regression — chantier dédié si valeur surfacée
- **Pre-existing dirty working tree** (Prettier whitespace fixes + docs/ → doc2/ reorg + prompts/ → prompt/ reorg, ~80 M+D+?? files dans `git status`) — laisser au user : ces changements ne sont pas v9 scope, ils sont WIP user-side
- Sprint Tailwind-v4 / Supabase-Strict-Types / Chantier I6 / Lot 6 console-cleanup / OpenAPI — roadmap §11 inchangée

## Trade-off documenté

v9 ne fait pas avancer le score métier. Pure consolidation post-v8 :
- (a) couverture test alignée sur tous les surfaces migrées (réduit le risque de régression silencieuse)
- (b) DRY violation v8 fermée (1 site de vérité pour le drawer override)
- (c) TS narrowing propre (drop des `?.` qui étaient des smells)

Sprint optionnel — si la prochaine session vise un saut métier (Tailwind v4, Chantier I6, etc.), reporter v9 ad-hoc PR-by-PR au fil des futures touchings sur ces fichiers.

## Estimation

- Phase 1 audit : ~10 min (1 Explore agent)
- Commit 1 RTL extension : ~30-40 min (9 nouveaux cas, dont 1 nested stacking)
- Commit 2 drawer className DRY : ~15 min
- Commit 3 selectedFromBudget cleanup : ~10 min
- Commit 4 closeout : ~15 min

**Total : 1h30 ± 15 min**
