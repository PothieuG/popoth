# Sprint 05 — Modal CREATE projet + calcul mutuel durée↔montant mensuel

> ✅ **LIVRÉ 2026-05-26** — Closeout dans [.claude/history/roadmap-detailed-30-projets-epargne-modals.md](../history/roadmap-detailed-30-projets-epargne-modals.md). Commit `feat(projects): CREATE modal with mutual duration/monthly logic + RAV refine`. Modal `AddProjectDialog` + branchement `PlanningDrawer` onglet Projets + 7 tests RTL (mode A/B happy paths, toggle preserve, refine RAV/duration min, Esc focus trap, axe 0 violations).

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la section 3 "Création d'un projet" avec les deux modes de saisie.

## Objectif

Créer `AddProjectDialog` (mirror `AddBudgetDialog`) avec :

- Inputs : nom, montant total (target), saisie alternative durée OU montant mensuel
- Calcul mutuel : la saisie de l'un calcule l'autre live (en respectant la marge disponible)
- Validation refine : RAV reste ≥ 0 après ajout du `monthlyAllocation`
- Brancher depuis `PlanningDrawer` onglet Projets (bouton "+")

## Logique métier (à respecter strictement)

- `margeDispo = totalEstimatedIncome - totalEstimatedBudgets` (depuis `useFinancialData` — déjà inclut les projets existants depuis sprint 03)
- **Mode A (saisie target only)** : durée min calculée = `Math.ceil(target / margeDispo)`. Si user entre durée < min → erreur. Si durée valide → `monthlyAllocation = round2(target / duration)`.
- **Mode B (saisie monthly)** : `monthlyAllocation ≤ margeDispo` strict. Si valide → `duration = Math.ceil(target / monthlyAllocation)`.
- `deadlineDate = first_day_of_next_month + duration months` (helper `lib/finance/projects-meta.ts::computeDeadlineFromDuration` sprint 03)

## Pré-lecture obligatoire

- [components/dashboard/AddBudgetDialog.tsx](../../components/dashboard/AddBudgetDialog.tsx) — RHF + zodResolver + watchedAmount preview
- [components/ui/DecimalFormInput.tsx](../../components/ui/DecimalFormInput.tsx) — composant input décimal fr-FR (comma→dot)
- [lib/schemas/projects.ts](../../lib/schemas/projects.ts) — sprint 02 `makeProjectClientSchema`
- [hooks/useFinancialData.ts](../../hooks/useFinancialData.ts) — `totalEstimatedIncome` + `totalEstimatedBudgets` (sprint 03 inclut déjà projets)
- [.claude/conventions/zod-patterns.md](../conventions/zod-patterns.md) §A — Pattern dual-type `useForm<FormInput, undefined, FormOutput>`

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Composant — `components/dashboard/AddProjectDialog.tsx`

- Props : `{ isOpen, onClose, onSuccess?, context }`
- Mount via dynamic import dans `PlanningDrawer` (`ssr: false`)
- Header : "Nouveau projet d'épargne"

### 2. Form layout

- **Input 1** — Nom (text, min 2 chars)
- **Input 2** — Montant total visé (`DecimalFormInput`, € symbol)
- **Toggle 2 modes** :
  - Mode A : "Définir la durée" — input mois (number 1-360)
  - Mode B : "Définir le montant mensuel" — `DecimalFormInput`
- **Affichage dérivé** (read-only sous l'input actif) :
  - Si mode A actif → "Tu épargneras {target/duration}€/mois" + warning si > marge
  - Si mode B actif → "Durée : {ceil(target/monthly)} mois → échéance {date+months}"
- **Affichage marge disponible** : "Marge dispo : {totalEstimatedIncome - totalEstimatedBudgets}€/mois" — couleur si négatif

### 3. Hooks

- `useForm<FormInput, undefined, FormOutput>` avec resolver `makeProjectClientSchema({ currentAllocatedTotal, totalEstimatedIncome })`
- `useFinancialData(context)` pour la marge live
- `useProjects(context).addProject` pour la mutation

### 4. A11y

- Pattern §6 ✅ `aria-describedby` + `id` sur erreurs
- `onInvalidSubmit` → `form.setFocus(Object.keys(errors)[0])`
- Close X via `<ModalCloseX onClose variant="circle" />`

### 5. Brancher dans `PlanningDrawer`

- State `isAddProjectOpen`
- Bouton "+" dans onglet Projets → `setIsAddProjectOpen(true)`
- Lazy dynamic import `AddProjectDialog`
- `onSuccess` → invalidate via `refreshProjects()` (déjà géré dans `useProjects` via TanStack)

### 6. Tests RTL — `components/dashboard/__tests__/AddProjectDialog.test.tsx` (mirror `AddBudgetDialog` tests)

- Cas 1 : happy path mode A (saisie target + durée → preview monthly OK)
- Cas 2 : happy path mode B (saisie target + monthly → preview duration OK)
- Cas 3 : toggle mode A↔B preserve les valeurs cohérentes
- Cas 4 : refine RAV bloque si monthly > margeDispo
- Cas 5 : refine durée min bloque si user force durée trop courte
- Cas 6 : focus trap + ESC close
- Cas 7 : a11y violations 0 (axe)

### 7. Vérifications

- `pnpm dev` + créer un projet en perso, vérifier que la liste se rafraîchit
- `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` exit 0
- `pnpm verify` exit 0

### 8. Commit

```
feat(projects): CREATE modal with mutual duration/monthly logic + RAV refine
```

## Acceptance criteria

- Créer un projet via la modal → apparaît dans la liste avec progression 0% et bonnes valeurs.
- Saisir un monthly > marge dispo → message erreur "Reste à vivre négatif".
- Saisir une durée trop courte → preview monthly > marge dispo → erreur.
- 0 erreur a11y.

## Hors scope

- Modal EDIT + DELETE (sprint 06).
- Recap (sprint 07+).
