# Sprint Zod-Rollout v8 — Focus trap audit + Radix Dialog migration

> Sprint **optionnel** post-v7. Le chantier Zod-client est complètement clos sur 7 sprints. v8 ferme un gap a11y non-trivial **surfacé pendant le Phase 1 de v7** mais explicitement laissé hors scope : les modals "custom" du repo utilisent un raw `<div>` au lieu de `@radix-ui/react-dialog`, donc lack focus trap + Esc-to-close + return-focus-on-close.
>
> ⚠️ **Pas une régression, juste un manque silencieux**. axe-core ne flag pas ce pattern parce que ses règles statiques ne testent pas les interactions clavier. À déclencher si signalement keyboard-only user, audit RGAA/WCAG niveau AA, ou inconfort identifié sur Tab/Esc dans les modals.

## Contexte

Sprint v7 a normalisé les **close X buttons** (`aria-label="Fermer"` + `aria-hidden="true"` sur le `<svg>`) sur 9 fichiers / 11 sites, et étendu l'audit axe-core de 2 → 7 surfaces. **Trouvaille Phase 1 v7** : [components/ui/dialog.tsx](../components/ui/dialog.tsx) (le wrapper Radix shadcn) gère nativement focus trap + Esc + sr-only label via `@radix-ui/react-dialog`, mais **seulement 3 modals du repo l'utilisent** (EditBalanceModal, EditProfileDialog, FirstTimeProfileDialog). Les 8+ autres modals sont des `<div className="fixed inset-0 ...">` custom :

| Fichier                                                      | Type modal                | Focus trap | Esc close | Return focus | role/aria-modal |
| ------------------------------------------------------------ | ------------------------- | ---------- | --------- | ------------ | --------------- |
| components/dashboard/EditBudgetDialog.tsx                    | Raw `<div>` fullscreen    | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/EditIncomeDialog.tsx                    | Raw `<div>` fullscreen    | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/AddBudgetDialog.tsx                     | Raw `<div>` fullscreen    | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/AddIncomeDialog.tsx                     | Raw `<div>` fullscreen    | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/PlanningDrawer.tsx                      | Raw `<div>` drawer        | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/SavingsDistributionDrawer.tsx           | Raw `<div>` × 2 (nested)  | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/AddTransactionModal.tsx                 | Raw `<div>` overlay       | ❌         | ❌        | ❌           | ❌              |
| components/dashboard/EditTransactionModal.tsx                | Raw `<div>` overlay       | ❌         | ❌        | ❌           | ❌              |
| components/groups/GroupMembersModal.tsx                      | Raw `<div>` overlay       | ❌         | ❌        | ❌           | ❌              |
| components/groups/GroupMembersWithContributionsModal.tsx     | Raw `<div>` overlay       | ❌         | ❌        | ❌           | ❌              |
| components/groups/DeleteGroupModal.tsx                       | Raw `<Card>` overlay      | ❌         | ❌        | ❌           | ❌              |

**11 surfaces modal sans focus trap** (vs 3 sur Radix). Conséquences UX pour les keyboard-only users :

1. **Tab depuis le dernier champ saute hors du modal** → le focus part vers la barre de navigation du dashboard / footer / autre contenu derrière l'overlay. L'utilisateur perd le contexte de la saisie.
2. **Pas d'`Escape` pour fermer** → l'utilisateur doit explicitement Tab jusqu'au bouton "Annuler" ou close X. Inconfortable, non-conformant avec les attentes WCAG 2.1.1 keyboard / 2.1.2 no keyboard trap.
3. **Pas de return-focus** après fermeture → le focus part vers `<body>` au lieu de revenir sur le bouton qui a ouvert le modal.
4. **Lecteurs d'écran** : sans `role="dialog"` + `aria-modal="true"`, le SR peut continuer à lire le contenu derrière l'overlay (background announcements).

## Phase 1 — Audit pré-sprint (Explore)

Avant d'attaquer, lancer 1 Explore agent pour :

1. **Confirmer la liste exhaustive** des modals custom (pourrait avoir bougé depuis v7). Pattern grep : `class[Nn]ame="fixed inset-0` + filtrer par les fichiers `components/**`.
2. **Vérifier qu'aucun consumer ne s'appuie sur la non-existence du focus trap** (e.g. un test qui tab outside intentionnellement). Pattern : grep `fireEvent.keyDown.*Tab|userEvent.tab\(\)` cross-codebase.
3. **Vérifier l'inventaire des Radix Dialog consumers** pour le pattern miroir : `import.*from '@/components/ui/dialog'` — 3 fichiers attendus (EditBalanceModal, EditProfileDialog, FirstTimeProfileDialog).
4. **Confirmer** que `@radix-ui/react-dialog` est déjà installé (transitif via shadcn). `Grep "react-dialog" pnpm-lock.yaml` ou `package.json`.
5. **Identifier les complications spécifiques** par modal :
   - **SavingsDistributionDrawer** a un nested transfer modal — focus trap par instance, comment gérer le bascule sans piéger deux fois ?
   - **PlanningDrawer** contient des dialogs lazy-loadés (`AddBudgetDialog`, etc.) — focus trap parent vs enfant ?
   - **AddTransactionModal** + EditTransactionModal — Radix Dialog peut-il supporter le `useRavValidation.blocked` flow + serverError pattern existant ?

## Objectifs

### Option A — Migration totale vers Radix `<Dialog>` (Recommended)

Pour chacun des 11 modals, remplacer le scaffolding `<div className="fixed inset-0 z-50 ...">` + overlay + content div par :

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function EditBudgetDialog({ isOpen, onClose, ... }: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le budget</DialogTitle>
        </DialogHeader>
        {/* Form content unchanged */}
      </DialogContent>
    </Dialog>
  )
}
```

**Gains** automatiques fournis par Radix :

- Focus trap par instance (FocusScope avec autoFocus + restoreFocus)
- Escape pour fermer (`onEscapeKeyDown` callback default = close)
- Return focus au trigger après close (FocusScope.restoreFocus)
- `role="dialog"` + `aria-modal="true"` + ARIA description linkage
- Click outside overlay pour fermer (Portal + interaction outside detection)
- Body scroll lock pendant ouverture
- Animation fade/zoom préservée (déjà dans `<DialogContent>` classNames)

**Cleanup à effectuer côté consumer** :

- Drop le bouton close X custom (Radix fournit son propre `<span className="sr-only">Close</span>` + Cross2Icon ; cf. dialog.tsx:64)
- Drop le `useEffect` outside-click handler manuel si présent
- Drop le `<div className="fixed inset-0 bg-black/60">` overlay manuel (Radix `<DialogOverlay>`)
- Garder le close X custom **seulement** si le design l'exige (utiliser `hideCloseButton={true}` sur `<DialogContent>` et garder le custom)

**Complications connues** :

- **AddTransactionModal + EditTransactionModal** sont les plus complexes (form heavy + useRavValidation). Vérifier que `<DialogContent>` className override accepte la hauteur dynamique (`max-h-[80vh]` etc.).
- **SavingsDistributionDrawer** : 2 instances `<Dialog>` séparées plutôt que nested divs.
- **PlanningDrawer** : les dialogs lazy-loadés enfants (`AddBudgetDialog`, etc.) doivent aussi être migrés sinon focus trap concurrent.
- **Add/EditTransactionModal** : le `<Button variant="ghost">` close X est gratuit après migration (Radix le fournit). Drop-able mais Phase 1 Audit doit confirmer.

### Option B — Manual focus trap via `focus-trap-react`

Plus chirurgical, moins risqué visuellement. Install `focus-trap-react@^11` + wrap chaque modal :

```tsx
import FocusTrap from 'focus-trap-react'

return (
  <FocusTrap focusTrapOptions={{ escapeDeactivates: true, returnFocusOnDeactivate: true }}>
    <div className="fixed inset-0 z-50 ...">
      <div className="bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" ...>
        {/* unchanged */}
      </div>
    </div>
  </FocusTrap>
)
```

**Gains** : focus trap + Esc + return focus + role/aria-modal en 5 LOC par modal, mais reste manuel pour body-scroll-lock et inert-background.

**Trade-off** : un nouveau dep (`focus-trap-react` ~3KB gzipped, popular lib battle-tested). Garde le look custom inchangé.

### Option C — Hybrid (PoC + report)

Migrer 1-2 modals en Option A (PoC) + écrire un report sur les autres avec recommandations. Bounded ~2h.

### Option D — Skip entirely

Si aucun signalement keyboard-user et pas d'audit RGAA prévu, ne pas livrer ce sprint. Pattern miroir Audit-Closeout C2/C3/C4 — "Don't design for hypothetical future requirements".

## Découpage suggéré (Option A — 4-5 commits)

### Commit 1 — Migration PoC : EditBudgetDialog + EditIncomeDialog (les + simples)

**Touche** : 2 fichiers (`Edit{Budget,Income}Dialog.tsx`). Pattern à valider avant sweep complet.

**Verif** : `pnpm typecheck` + `pnpm lint:check` + tests RTL existants doivent rester verts (EditBudget/EditIncome tests existent déjà sous `components/dashboard/__tests__/`). Le mock pattern Radix peut nécessiter `vi.mock('@radix-ui/react-dialog')` ou un setup `vitest.setup.ts` ajout — confirmer Phase 1 (sinon les tests Radix portal-render peuvent fail).

### Commit 2 — Add{Budget,Income,Transaction} + EditTransaction (4 fichiers)

**Touche** : 4 dashboard form modals. Pattern miroir Commit 1.

**Complication** : AddTransaction + EditTransaction discriminated union + useRavValidation. Les tests RTL existants (`AddTransactionModal.test.tsx`, `EditTransactionModal.test.tsx`) doivent passer.

### Commit 3 — PlanningDrawer + SavingsDistributionDrawer (2 fichiers, 3 modals)

**Touche** : 2 fichiers, mais SavingsDistributionDrawer a 2 instances Dialog (drawer principal + nested transfer modal).

**Complication** : PlanningDrawer contient les dialogs Add/Edit Budget/Income lazy-loadés. Vérifier que Dialog parent + Dialog enfant cohabitent sans focus trap conflict (Radix gère normalement via `<DialogContent>` z-index stacking).

### Commit 4 — Groups modals (3 fichiers)

**Touche** : `GroupMembersModal.tsx` + `GroupMembersWithContributionsModal.tsx` + `DeleteGroupModal.tsx`. Pattern le plus simple (pas de form heavy, juste display).

**Verif** : tests RTL existants pour ces 3 modals (à confirmer Phase 1 — peut-être 0 test aujourd'hui).

### Commit 5 — Tests + closeout

**Touche** : (a) extension `a11y-audit.test.tsx` pour ajouter focus trap regression-guards via `userEvent.tab() + expect(document.activeElement).toBe(...)` sur ≥2 modals représentatifs ; (b) closeout CLAUDE.md §1 + §8 + §11.

**Pattern test focus trap** :

```tsx
it('EditBudgetDialog traps Tab inside the modal', async () => {
  const user = userEvent.setup()
  render(<EditBudgetDialog isOpen onClose={() => {}} onSave={() => {}} budget={fixture} />)
  // Initial focus should be on the first focusable element inside the dialog
  await user.tab()
  expect(screen.getByLabelText(/nom/i)).toHaveFocus()
  // Tab through all fields
  await user.tab()
  expect(screen.getByLabelText(/montant/i)).toHaveFocus()
  await user.tab()
  await user.tab() // continuer tab until cycle
  // After the last focusable element, Tab should wrap back to the first
  await user.tab()
  expect(screen.getByLabelText(/nom/i)).toHaveFocus()
})

it('EditBudgetDialog closes on Escape', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<EditBudgetDialog isOpen onClose={onClose} ... />)
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
```

### Commit 6 — Closeout CLAUDE.md + README

Mêmes patterns que v7 closeout.

## Critical files

**Modals à migrer (11 surfaces, 11 fichiers)** :

| Fichier                                                  | Commit | Complexité  |
| -------------------------------------------------------- | ------ | ----------- |
| components/dashboard/EditBudgetDialog.tsx                | 1 PoC  | Moyenne     |
| components/dashboard/EditIncomeDialog.tsx                | 1 PoC  | Moyenne     |
| components/dashboard/AddBudgetDialog.tsx                 | 2      | Moyenne     |
| components/dashboard/AddIncomeDialog.tsx                 | 2      | Moyenne     |
| components/dashboard/AddTransactionModal.tsx             | 2      | **Élevée**  |
| components/dashboard/EditTransactionModal.tsx            | 2      | **Élevée**  |
| components/dashboard/PlanningDrawer.tsx                  | 3      | **Élevée**  |
| components/dashboard/SavingsDistributionDrawer.tsx       | 3      | **Élevée**  |
| components/groups/GroupMembersModal.tsx                  | 4      | Faible      |
| components/groups/GroupMembersWithContributionsModal.tsx | 4      | Faible      |
| components/groups/DeleteGroupModal.tsx                   | 4      | Faible      |

**Patterns / helpers à réutiliser** :

- [components/ui/dialog.tsx](../components/ui/dialog.tsx) — wrapper Radix shadcn (DialogContent + Header + Footer + Title + Description + close natif sr-only)
- 3 existing Radix consumers comme reference d'usage : [components/dashboard/EditBalanceModal.tsx](../components/dashboard/EditBalanceModal.tsx), [components/profile/EditProfileDialog.tsx](../components/profile/EditProfileDialog.tsx), [components/profile/FirstTimeProfileDialog.tsx](../components/profile/FirstTimeProfileDialog.tsx)

## Verification end-to-end

```powershell
pnpm typecheck
pnpm lint:check
pnpm test:run
pnpm test:run components/__tests__/a11y-audit.test.tsx
```

**Positive greps post-sprint** :

- `Grep "from '@/components/ui/dialog'" components/` → ≥14 hits (3 v0 + 11 v8)
- `Grep "class[Nn]ame=\"fixed inset-0" components/dashboard/ components/groups/" -L` → 0 hit (toutes les surfaces migrées)
- `Grep "role=\"dialog\"" components/` → 0 hit côté consumer (Radix fournit nativement, pas besoin de l'ajouter manuellement)

**Negative greps** :

- `Grep "onClick={onClose}" components/dashboard/ components/groups/` → uniquement sur les close button résiduels (qui doivent passer par `<DialogClose>` ou Radix natif close X)

**Smoke browser deferred to user** :

1. `/dashboard` ouvrir EditBudget → Tab cycles within modal, Esc closes, focus returns to trigger button
2. Idem pour les 10 autres modals
3. SavingsDistributionDrawer → ouvrir drawer principal + cliquer "Transférer" pour nested modal → Tab trap dans nested seulement (drawer principal devient inert), Esc ferme nested d'abord, second Esc ferme drawer
4. PlanningDrawer → ouvrir, puis ouvrir AddBudgetDialog enfant → Tab trap dans AddBudget seulement, Esc ferme AddBudget mais pas PlanningDrawer
5. Lecteur d'écran (VoiceOver/NVDA) : annonce du modal opening + focus message + lecture seule du contenu du modal (background announcements muted via aria-modal)

## Critères de succès

- ✅ Lint baseline 180 stable (ou variation marginale due au cleanup côté consumer)
- ✅ Tests existants RTL des 11 modals (s'ils existent) restent verts
- ✅ ≥2 nouveaux tests focus trap regression-guard
- ✅ 7/7 cas axe-core existants restent verts
- ✅ 0 régression sur les 277 tests existants
- ✅ 0 migration DB
- ✅ Score estimé : ~99.998 → ~99.999/100 (gain a11y keyboard-only users, contribution marginale au score métier)

## Hors scope explicite

- **Sprint Tailwind-v4** (roadmap §11)
- **Sprint Supabase-Strict-Types** (roadmap §11)
- **Chantier I6** (roadmap §11)
- **Lot 6 console.log cleanup** (roadmap §11)
- **OpenAPI / schema-to-docs** (roadmap §11)
- **Error boundaries** (React error handling) — gap orthogonal, sprint séparé si valeur
- **Sentry / observability** — gap orthogonal, sprint séparé
- **i18n** (fr-FR explicit layer) — sprint séparé si surface internationale planifiée

## Pattern miroir

v7 a fixé les **boutons** svg-only (close X). v8 ferme la **structure** des modals (focus trap + Esc + return focus + role/aria-modal). Ensemble, v7+v8 closent le chantier "a11y full coverage" pour les modals.

## Estimation

- Phase 1 audit : ~20 min (1 Explore agent)
- Commit 1 PoC : ~30 min (2 fichiers simples + test pattern validation)
- Commit 2 dashboard forms : ~45 min (4 fichiers, AddTransaction/EditTransaction complexes)
- Commit 3 drawers : ~45 min (PlanningDrawer + SavingsDistributionDrawer nested)
- Commit 4 groups : ~20 min (3 fichiers simples)
- Commit 5 tests focus trap : ~25 min (2 nouveaux RTL cases pin contrat)
- Commit 6 closeout : ~15 min

**Total : 3h00 ± 30 min**

## Trade-off documenté

v8 ne fait pas avancer le score métier — pure consolidation a11y keyboard-only. À déclencher uniquement si :

- Signalement keyboard-only user / lecteur d'écran
- Audit RGAA niveau AA / WCAG niveau AA planifié
- Surface internationale qui requiert WCAG conformance

Sinon, **Option D (skip)** est légitime. Le score Lighthouse a11y restera ≥95 sans v8 (les rules axe-core ne testent pas focus trap).

## Pourquoi pas inclus dans v7

v7 a fixé les **attributs HTML** des boutons (`aria-label`, `aria-hidden`) — diff mécanique, 0 réflexion architecturale. v8 nécessite une **migration architecturale** (raw `<div>` → Radix `<Dialog>`) qui touche la structure des modals + les tests RTL associés. Séparation propre.
