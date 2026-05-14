# 03 — UserGroupsList : implémenter view-members + leave-group (2 TODO)

> ⚠️ **STALE — closed-by-deletion (Path B) 2026-05-14**
>
> Ce prompt a été triagé puis fermé par DELETE du composant cible plutôt que par implémentation. Phase 1 audit a surfacé que `components/groups/UserGroupsList.tsx` est **0-consumer applicatif** : grep cross-codebase `.{ts,tsx}` retourne uniquement le fichier lui-même + 4 docs `audit_2/`. `app/settings/page.tsx:253-337` rend déjà inline la même UI (mêmes boutons "Voir membres"/"Supprimer"/"Quitter" + mêmes handlers déjà fonctionnels) et le composant supposait un futur multi-groups (itère sur `groups[]`) alors que `useGroups.ts:231` `currentGroup: groups[0]` confirme que l'app limite à 1 groupe par utilisateur.
>
> 7ᵉ application du pattern Path B closed-by-deletion (mirror Lot 5b status-test / Lot 5c testSupabaseConnection / Atomicity-Savings v2 handlePiggyBankAction / Sprint Dead-Code-Purge / Audit-Closeout I3 monthly-recap-calculations). Cohérent avec CLAUDE.md system prompt "Don't design for hypothetical future requirements" + "Don't add features beyond what the task requires". **Recovery** : `git show <sha>:components/groups/UserGroupsList.tsx > components/groups/UserGroupsList.tsx` si un futur consumer (e.g. `app/groups/page.tsx` multi-groups dashboard) le justifie. Voir CLAUDE.md §11 entrée Sprint UserGroupsList-Cleanup.

## En-tête

| Champ | Valeur |
|-------|--------|
| **Source primaire** | `components/groups/UserGroupsList.tsx:107` (view members handler) + `:132` (leave group handler) — **non documenté CLAUDE.md** |
| **Type** | feature incomplète |
| **Priorité** | Haute |
| **Effort estimé** | S (1-2h) |
| **Statut** | Non commencé |
| **Dépendances** | Aucune (infrastructure entièrement en place) |
| **Bloque** | — |

## Contexte

Phase 1 audit a trouvé les **2 seuls TODO concrets non documentés** de tout le repo :

```tsx
// components/groups/UserGroupsList.tsx:101-111
{/* View Members Button */}
<Button
  variant="outline"
  size="sm"
  className="w-full"
  onClick={() => {
    // TODO: Implement view members functionality
  }}
>
  Voir membres
</Button>
```

```tsx
// components/groups/UserGroupsList.tsx:125-137
{/* Leave Button (only for non-creators) */}
{!group.is_creator && (
  <Button
    variant="outline"
    size="sm"
    className="w-full border-orange-300 text-orange-600 hover:border-orange-400 hover:bg-orange-50"
    onClick={() => {
      // TODO: Implement leave group functionality
    }}
  >
    Quitter
  </Button>
)}
```

Ces 2 boutons sont **rendus dans l'UI** mais leurs handlers sont vides — le clic ne fait rien (effet "bouton mort"). Quick win UX :
- L'infrastructure est entièrement en place
- `useGroups()` expose `leaveGroup` mutation (Sprint 1.5 + 2-followup-v2 cascade invalidation `['profile']` + financials)
- `GroupMembersWithContributionsModal` existe et est migré Sprint Zod-Rollout v8 (Radix Dialog + focus trap + close X via `<ModalCloseX>`)
- `ConfirmationDialog` disponible pour le confirm leave (a11y-clean post v8)
- 0 RPC, 0 migration DB, 0 nouveau test gated requis

## Prompt prêt à l'emploi pour Claude Code

> Copier-coller dans une nouvelle session Claude Code à la racine du repo.

### 1. Objectif

Implémenter les 2 handlers `onClick` actuellement vides dans `components/groups/UserGroupsList.tsx:107` (view members → ouvre `GroupMembersWithContributionsModal`) et `:132` (leave group → ouvre `ConfirmationDialog` puis appelle `useGroups().leaveGroup`), sans introduire de nouvelle dépendance ni nouveau composant.

### 2. Contexte technique

**Fichiers concernés** :
- `components/groups/UserGroupsList.tsx` — fichier principal (refactor handlers + ajout state pour les 2 modals)
- `components/groups/__tests__/UserGroupsList.test.tsx` — **à créer** si pas existant (suivre pattern `components/dashboard/__tests__/`)

**Fichiers à consulter** (read-only contexte) :
- `components/groups/GroupMembersWithContributionsModal.tsx` — props attendus : `{ isOpen, onClose, groupId, groupName }` (à confirmer par Read)
- `components/ui/ConfirmationDialog.tsx` — props attendus : `{ isOpen, onClose, title, message, onConfirm, loading? }` (à confirmer par Read)
- `hooks/useGroups.ts` — exposer `leaveGroup` mutation : signature attendue `leaveGroup({ id }) → Promise<void>` ou similaire (CLAUDE.md §11 entrée Sprint 2-followup-v2 confirme l'invalidation cascade)
- `app/groups/page.tsx` ou wherever `<UserGroupsList />` est consommé — pour vérifier que la page parent re-fetch `useGroups()` après leaveGroup (TanStack Query invalidation devrait gérer)

**État actuel** :
- 2 handlers `onClick={() => { /* TODO */ }}` vides (L107, L132)
- 0 state local lié à modals dans le composant
- Le composant est `'use client'` et reçoit `groups: GroupData[]` + `isLoading: boolean` + `onDeleteGroup: (group: GroupData) => void` en props (delete déjà implémenté)
- Les boutons "Voir membres" sont visibles **pour tous les membres** (creator + non-creator)
- Le bouton "Quitter" est visible **uniquement non-creator** (le creator a "Supprimer" à la place)

**Tests existants pertinents** :
- `components/groups/__tests__/CreateGroupForm.test.tsx` — pattern RTL pour les groups components (Sprint Zod-Rollout v5)
- `components/dashboard/__tests__/ConfirmationDialog.*.test.tsx` — pattern usage ConfirmationDialog (si existe)
- `hooks/useGroups.ts` — hooks 5 mutations CRUD, tests pas direct mais comportement bien documenté CLAUDE.md §11

**Précédents codebase** :
- Sprint 1.5 — `useGroups` migré TanStack Query avec optimistic updates
- Sprint 2-followup-v2 — invalidation cascade `['profile']` + `invalidateFinancialRefreshes(qc)` ajoutée pour `joinGroup`/`leaveGroup`/`createGroup`/`deleteGroup`
- Sprint Zod-Rollout v8 — `GroupMembersWithContributionsModal` + `ConfirmationDialog` + `DeleteGroupModal` migrés Radix Dialog

### 3. Spécifications fonctionnelles attendues

**Cas nominal — View Members** :
- Click sur "Voir membres" → ouvre `<GroupMembersWithContributionsModal isOpen onClose groupId={group.id} groupName={group.name} />`
- L'utilisateur voit la liste des membres + leurs contributions (UI gérée par le modal lui-même)
- Click sur close X (Esc, click outside, click X) → ferme le modal
- Aucun side effect DB

**Cas nominal — Leave Group** :
- Click sur "Quitter" → ouvre `<ConfirmationDialog isOpen onClose title="Quitter le groupe" message="Êtes-vous sûr de vouloir quitter le groupe '{group.name}' ? Cette action ne peut pas être annulée." onConfirm={...} loading={isLeaving} />`
- Click sur "Confirmer" → appelle `leaveGroup({ id: group.id })` (ou signature équivalente exposée par useGroups)
- Pendant la mutation : `loading: true` désactive les boutons + close X
- Mutation success : ferme le modal, le hook TanStack Query invalide `['groups']` + `['profile']` + financial caches → la liste `groups` se re-fetch et l'item disparaît de l'UI
- Mutation error : ferme le confirmation, affiche un toast/error inline (à voir si toast system existant — sinon `alert()` temporaire ou state `error` dans le composant)

**Cas edge** :
- Click "Quitter" puis Esc avant confirm → ferme sans appel mutation
- Mutation timeout réseau → error path (le hook retry 1× via TanStack Query default config)
- Group supprimé entre-temps (race) → mutation 404 → afficher erreur

**Cas erreur** :
- `leaveGroup` API retourne 403 (non-membre) → afficher erreur générique
- `leaveGroup` API retourne 409 (creator ne peut pas quitter, doit supprimer) → afficher erreur métier (mais le bouton "Quitter" n'est rendu que si `!group.is_creator` donc improbable côté UI)

### 4. Contraintes techniques

- **Style** : suivre conventions CLAUDE.md §6 (no `console.log`, imports `import type`, Prettier strict)
- **A11y** : les modals existants sont déjà a11y-clean (Sprint Zod-Rollout v8/v9/v10 — focus trap + Esc + role=dialog + ModalCloseX). Pas de gap a11y nouveau à créer.
- **Pattern hook usage** : utiliser `useGroups()` directement dans le composant (`'use client'` permet) — pattern miroir parent page consumer (qui passe `onDeleteGroup` en prop pour la même raison probablement)
- **State local** : 2 `useState` minimum :
  - `viewingGroupId: string | null` pour controller le View Members modal
  - `leavingGroup: GroupData | null` pour controller le Confirmation Dialog
  - (Ou consolider en 1 state avec discriminated union si préféré)
- **Render conditionnel modals** : pattern Sprint 1.5 + Sprint Zod-Rollout v8 — render `{viewingGroupId && <Modal isOpen ... />}` (parent gate via `&&`, child reçoit `isOpen` toujours `true`, Radix Dialog gère via `open={isOpen}`)
- **Pas de prop drilling** : le composant est déjà `'use client'`, peut consommer `useGroups()` directement plutôt que recevoir `onLeaveGroup` en prop. Cohérent avec `onDeleteGroup` qui est passé en prop par symétrie historique — vérifier si on veut garder la symétrie (passer `onLeaveGroup` en prop) ou refactorer.

### 5. Critères d'acceptation vérifiables

- [ ] **0 TODO résiduel** : `Grep "TODO" components/groups/UserGroupsList.tsx` retourne 0 hit
- [ ] **2 modals importés** : `Grep "GroupMembersWithContributionsModal\|ConfirmationDialog" components/groups/UserGroupsList.tsx` retourne 2+ hits (imports)
- [ ] **leaveGroup appelé** : `Grep "leaveGroup\|useGroups" components/groups/UserGroupsList.tsx` retourne au moins 1 hit
- [ ] **typecheck** : `pnpm typecheck` exit 0
- [ ] **lint** : `pnpm lint:check` exit 0, baseline 183 stable
- [ ] **format** : `pnpm format:check` exit 0
- [ ] **tests** : `pnpm test:run` exit 0, +N cas non-gated (3-5 cas RTL idéal)
- [ ] **build** : `pnpm build` exit 0, 55/55 routes
- [ ] **smoke browser** :
  - Click "Voir membres" sur un groupe → modal s'ouvre, affiche les membres + contributions, Esc ferme
  - Click "Quitter" sur un groupe non-creator → ConfirmationDialog s'ouvre, click "Confirmer" → appel API + le groupe disparaît de la liste après refetch
  - Click "Quitter" puis Esc → ConfirmationDialog ferme sans appel API
  - Lecteur d'écran : modals annoncent `role="dialog"` + title (regression-guard a11y v6/v7/v8)

### 6. Tests à écrire ou à mettre à jour

#### RTL non-gated — `components/groups/__tests__/UserGroupsList.test.tsx` (~5 cas)

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UserGroupsList from '../UserGroupsList'

// Mock useGroups
const mockLeaveGroup = vi.fn(async () => ({ data: null, error: null }))
vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ leaveGroup: mockLeaveGroup, /* ... */ }),
}))

// Mock children modals to keep tests focused
vi.mock('@/components/groups/GroupMembersWithContributionsModal', () => ({
  default: ({ isOpen, onClose, groupName }) =>
    isOpen ? <div role="dialog">Members of {groupName} <button onClick={onClose}>Close</button></div> : null,
}))
vi.mock('@/components/ui/ConfirmationDialog', () => ({
  default: ({ isOpen, onClose, onConfirm, message }) =>
    isOpen ? <div role="dialog">{message}<button onClick={onConfirm}>Confirm</button><button onClick={onClose}>Cancel</button></div> : null,
}))

describe('UserGroupsList', () => {
  const groups = [
    { id: 'g1', name: 'Famille', monthly_budget_estimate: 1000, is_creator: false, member_count: 3, created_at: '2026-01-01', updated_at: '2026-05-01' },
    { id: 'g2', name: 'Coloc', monthly_budget_estimate: 500, is_creator: true, member_count: 2, created_at: '2026-02-01', updated_at: '2026-05-10' },
  ]

  it('renders empty state when no groups', () => {
    render(<UserGroupsList groups={[]} isLoading={false} onDeleteGroup={vi.fn()} />)
    expect(screen.getByText(/aucun groupe/i)).toBeInTheDocument()
  })

  it('opens view members modal when clicking "Voir membres"', async () => {
    const user = userEvent.setup()
    render(<UserGroupsList groups={groups} isLoading={false} onDeleteGroup={vi.fn()} />)
    const viewBtns = screen.getAllByText(/voir membres/i)
    await user.click(viewBtns[0])
    expect(await screen.findByText(/Members of Famille/)).toBeInTheDocument()
  })

  it('opens leave confirmation for non-creator group', async () => {
    const user = userEvent.setup()
    render(<UserGroupsList groups={groups} isLoading={false} onDeleteGroup={vi.fn()} />)
    const leaveBtn = screen.getByText(/quitter/i)
    await user.click(leaveBtn)
    expect(await screen.findByText(/Êtes-vous sûr.*Famille/)).toBeInTheDocument()
  })

  it('calls leaveGroup on confirm', async () => {
    const user = userEvent.setup()
    render(<UserGroupsList groups={groups} isLoading={false} onDeleteGroup={vi.fn()} />)
    await user.click(screen.getByText(/quitter/i))
    await user.click(await screen.findByText(/confirm/i))
    await waitFor(() => expect(mockLeaveGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' })))
  })

  it('does not show "Quitter" button for creator group', () => {
    render(<UserGroupsList groups={groups} isLoading={false} onDeleteGroup={vi.fn()} />)
    // groups[1] is_creator=true → "Supprimer" but no "Quitter"
    const quitterButtons = screen.queryAllByText(/quitter/i)
    expect(quitterButtons).toHaveLength(1) // Only g1 (non-creator) has it
  })
})
```

### 7. Documentation à mettre à jour

- **CLAUDE.md** :
  - **§1 score** : peut passer à ~99.999/100 stable (consolidation feature, pas de saut métier mais close 2 TODO publics)
  - **§4 Structure du repo** : entrée `components/groups/UserGroupsList.tsx` n'est pas listée — pas besoin d'ajouter sauf si le composant devient référence pour d'autres
  - **§11 Roadmap** : nouvelle entrée `✅ **Sprint UserGroupsList-Handlers** : ferme les 2 TODO concrets non documentés CLAUDE.md trouvés via grep dans le seul composant les contenant. Implémente view members (ouvre GroupMembersWithContributionsModal) + leave group (ouvre ConfirmationDialog → leaveGroup mutation). 5 cas RTL non-gated. Lint baseline 183 stable. Score : ~99.999 stable (consolidation feature).`

- **next-steps.md** : pas concerné (pas P1-P10).

### 8. Étapes de validation avant commit

```powershell
# 1. Pré-flight
git status -s

# 2. Read context
# Read components/groups/GroupMembersWithContributionsModal.tsx (props expected)
# Read components/ui/ConfirmationDialog.tsx (props expected)
# Read hooks/useGroups.ts (leaveGroup signature + cascade)
# Read app/groups/page.tsx ou parent consumer (vérifier comment onDeleteGroup est branché)

# 3. Implementation
# Edit components/groups/UserGroupsList.tsx :
# - Ajouter useGroups + 2 useState
# - Implémenter handler view members
# - Implémenter handler leave group
# - Render conditionnel des 2 modals

# 4. Tests
# Write components/groups/__tests__/UserGroupsList.test.tsx (5 cas)
pnpm test:run components/groups/__tests__/UserGroupsList.test.tsx

# 5. Validation totale
pnpm typecheck
pnpm lint:check
pnpm format:check
pnpm test:run
pnpm build

# 6. Negative greps
# Grep "TODO" components/groups/UserGroupsList.tsx  # 0 hit
# Grep "alert\(" components/groups/UserGroupsList.tsx  # 0 hit (si on a temporairement utilisé alert pour error toast)

# 7. Smoke browser
pnpm dev
# /groups (ou wherever UserGroupsList est rendu)
# - Click "Voir membres" → modal s'ouvre avec liste membres + contributions
# - Click "Quitter" sur un groupe non-creator → confirmation
# - Confirm → groupe disparaît après refetch
# - Esc sur l'un ou l'autre → ferme sans side effect
```

## Pièges connus / points d'attention

- **Symétrie `onDeleteGroup` prop vs `useGroups()` direct** : le composant reçoit déjà `onDeleteGroup` en prop. **Recommandé** : par symétrie, recevoir aussi `onLeaveGroup` et `onViewMembers` en prop, et les mutations + modal state vivent dans le parent (e.g. `app/groups/page.tsx`). **Alternative** : mettre tout dans `UserGroupsList` directement (consommer `useGroups()`). À arbitrer en lisant le parent — si le parent gère déjà delete via state local + modal, suivre le même pattern pour leave.
- **`leaveGroup` côté hook signature exacte** : vérifier dans `hooks/useGroups.ts` la signature exacte. CLAUDE.md §11 mentionne `leaveGroup` comme une des 5 mutations. Soit `leaveGroup({ id })` soit `leaveGroup(groupId)` — adapter.
- **Toast / error feedback** : le repo n'a pas de toast system installé (pas de `react-hot-toast` / `sonner` dans deps). Pour le feedback d'erreur, utiliser un state local `error: string | null` + render conditionnel `{error && <p role="alert" className="text-red-600">{error}</p>}`. Pattern miroir SavingsDistributionDrawer.
- **Modal stacking** : si le user click "Quitter" alors que View Members modal est ouvert → fermer le précédent d'abord (UI state cleanup). Probablement pas de race UX puisque les boutons sont sur le même Card.
- **Leaving group while creator** : le bouton "Quitter" est seulement rendu pour `!group.is_creator`, donc le cas creator-leaving ne devrait pas arriver côté UI. Si par hasard l'API renvoie une erreur (race), afficher un message générique.
- **Pre-existing dirty working tree** : si chantier 16 pas encore traité, exclure du commit du chantier 03.
- **GroupMembersWithContributionsModal props exactes** : à vérifier par Read. CLAUDE.md mentionne le composant est utilisé par grep cross-codebase mais le call site exact n'est pas listé. Confirmer la signature des props avant de l'invoquer dans `UserGroupsList`.

## Découpage en sous-tâches (S → 2 commits)

1. **Sub-1 (Effort : XS)** — Read context + Phase 1 audit modal props. Documenter les signatures exactes dans le commit message du suivant.
2. **Sub-2 (Effort : S)** — Implementation + tests RTL en 1 commit `feat(groups): implement view-members + leave-group handlers in UserGroupsList`.
3. **Sub-3 (Effort : XS)** — Closeout doc CLAUDE.md §11. Commit `docs: closeout CLAUDE.md §11 for UserGroupsList handlers`.

(Total 2-3 commits, scope contenu, recoverable trivialement.)

## Recovery path

- `git revert <sha>` — pas de migration DB, pas d'effet persistant. Recovery trivial.

## Précédents codebase (références)

- Sprint Zod-Rollout v8 — `GroupMembersWithContributionsModal` migré Radix Dialog (CLAUDE.md §11 entrée Sprint Zod-Rollout v8 commit `45530f0`)
- Sprint Zod-Rollout v9 — focus-trap regression-guards extension à 12 surfaces (CLAUDE.md §11 entrée Sprint Zod-Rollout v9 commit `f4bf846`)
- Sprint 1.5 — `useGroups` migré TanStack Query, 5 mutations CRUD avec optimistic updates
- Sprint 2-followup-v2 — invalidation cascade `['profile']` + financials pour joinGroup/leaveGroup/createGroup/deleteGroup (CLAUDE.md §11 entrée commit `3af2920`)

---

**Estimation totale** : 1-2h (XS read + S implementation + XS closeout). Ferme 2 TODO concrets surfacés en Phase 1. Quick win UX maximal : effort minimal, valeur user-visible immédiate, infrastructure 100% réutilisée.
