# Sprint 06 — Modal EDIT + DELETE projet

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la section "Modification" et "Suppression".

> 🔗 **Sprint 05 livré 2026-05-26** ([Part 30](../history/roadmap-detailed-30-projets-epargne-modals.md)). `AddProjectDialog` est la référence d'implémentation à mirror. `makeProjectClientSchema` supporte déjà `currentProjectAllocation` + `amountSaved` pour le mode EDIT (delta-math, voir [lib/schemas/projects.ts](../../lib/schemas/projects.ts)). `useProjects().updateProject` + `deleteProject` sont déjà exposés depuis sprint 02.

## Objectif

Permettre à l'utilisateur de modifier un projet existant (pré-rempli) et de le supprimer avec confirmation explicative. Le montant déjà épargné est reversé vers la tirelire à la suppression. Snackbar transient non-bloquant.

## Pré-lecture obligatoire

- [components/dashboard/EditBudgetDialog.tsx](../../components/dashboard/EditBudgetDialog.tsx) — pattern edit pré-rempli + `key={editing.id}`
- [components/ui/ConfirmationDialog.tsx](../../components/ui/ConfirmationDialog.tsx) — modal confirmation existante
- [components/dashboard/PlanningDrawer.tsx:84-101](../../components/dashboard/PlanningDrawer.tsx) — state `deletingItem` + `transferSnackbar`
- [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) — règles ❌ Modals & UI (false-affordance, key reset, lazy-mount)
- Sprint 05 (`AddProjectDialog`) — patterns à reprendre

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. EditProjectDialog — `components/dashboard/EditProjectDialog.tsx`

- Mirror `AddProjectDialog` (sprint 05) — même toggle 2 modes (durée pilote / mensuel pilote), même `useMemo(derivedDurationFromMonthly)` pour mode B (PAS de `setState` dans useEffect, sinon `react-hooks/set-state-in-effect` bloque le lint), même seed dans `handleToggleDuration` synchrone, même arrondi cents `ceil(target × 100 / duration) / 100`.
- Pré-rempli avec `editing.{name, target_amount, monthly_allocation, deadline_date}` ; `defaultDuration` initiale dérivée de `monthsBetween(today, editing.deadline_date)`.
- **Important** : le user a explicitement demandé "Le calcul doit tenir compte de l'argent déjà économisé" → passer `amountSaved={editing.amount_saved}` au factory `makeProjectClientSchema` (refine 2 utilise `target - amountSaved` pour le reste à atteindre). Le mode A "durée" continue à afficher `Tu épargneras X€/mois` avec `X = ceil((target - amountSaved) * 100 / duration) / 100`.
- Pattern `key={editing.id}` sur le composant + `useState(() => ...editing.foo)` lazy (cf. [operational-rules.md §6](../conventions/operational-rules.md) Sprint 1.5 standard).
- Parent wraps avec `{isEditProjectOpen && editingProject && <EditProjectDialog ... />}` pour lazy-mount.
- Refine RAV via `currentProjectAllocation={editing.monthly_allocation}` au factory (le schéma fait déjà le delta `currentAllocatedTotal - currentProjectAllocation + d.monthlyAllocation`).
- `useProjects().updateProject` au submit (signature `(projectId, input)` retournant `boolean`).

### 2. DeleteProjectConfirmDialog — réutiliser `<ConfirmationDialog>`

Pas un nouveau fichier — réutiliser le composant existant avec :

- Message : "Êtes-vous sûr de vouloir supprimer le projet "{name}" ? Le montant déjà épargné ({amount_saved}€) sera reversé dans votre tirelire."
- Si `amount_saved == 0` : message simplifié "Êtes-vous sûr de vouloir supprimer le projet "{name}" ?"
- Confirm action → `useProjects().deleteProject(id)` → en cas de succès, snackbar transient (3s auto-dismiss, fixed bottom z-[60]) : "💜 {transferredAmount}€ versés dans la tirelire" (si > 0) ou "Projet supprimé" (sinon).

### 3. Brancher dans `PlanningDrawer`

- State `isEditProjectOpen`, `editingProject`
- State `deletingItem.type: 'budget' | 'income' | 'project'` (étendre l'union existante ligne 88)
- Handlers `handleEditProject(project)` / `handleRequestDeleteProject(project)`
- Dropdown action "Modifier" → `setEditingProject` + `setIsEditProjectOpen`
- Dropdown action "Supprimer" → `setDeletingItem({type:'project', ...})` + `setIsDeleteConfirmOpen`
- Réutiliser le `<ConfirmationDialog>` existant avec une branche switch sur `deletingItem.type` pour le bon message + bon handler.

### 4. Snackbar étendu

Ajouter une variante `transferToPiggyFromProject` si pertinent (ou réutiliser tel quel le `transferSnackbar` existant — vérifier).

### 5. Tests RTL

**`components/dashboard/__tests__/EditProjectDialog.test.tsx`** :

- Cas 1 : pré-remplissage avec valeurs existantes
- Cas 2 : modifier target → re-calcule mois restants live (tenant compte `amount_saved`)
- Cas 3 : refine RAV avec différentiel (`-old + new`)
- Cas 4 : `key={editing.id}` reset le form quand on switch d'un projet à un autre

**`components/dashboard/__tests__/DeleteProjectConfirmation.test.tsx`** :

- Cas 1 : message inclut `amount_saved` si > 0
- Cas 2 : confirm → `deleteProject` appelé + snackbar visible
- Cas 3 : cancel → modal close sans mutation

### 6. Vérifications

- `pnpm dev` + créer / éditer / supprimer un projet en perso ET en groupe → tirelire crédite OK, snackbar visible
- `pnpm verify` exit 0

### 7. Commit

```
feat(projects): EDIT modal + DELETE with piggy refund snackbar
```

## Acceptance criteria

- Modifier un projet → valeurs sauvegardées + RAV recalculé correctement.
- Supprimer un projet avec `amount_saved=500€` → tirelire +500€ + snackbar "💜 500€ versés dans la tirelire".
- Le projet disparaît de la liste.
- 0 régression sur edit/delete budget existants.

## Hors scope

- Recap drawer (sprint 07).
- Refloat from projects (sprint 08-10).
