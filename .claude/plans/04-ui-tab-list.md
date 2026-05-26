# Sprint 04 — UI : 3ème onglet "Projets" dans PlanningDrawer + ProjectListItem

> ✅ **LIVRÉ 2026-05-26** sur branche `feature/projets-epargne`, commit `5255fa5`. Détails closeout → [Part 29](../history/roadmap-detailed-29-projets-epargne.md). Tests non-gated 680 → 695 (+15) ; lint baseline 0/0 préservée. Modals create/edit/delete = stubs `logger.info` (modal create/edit sprint 05, confirmation delete sprint 06).

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet.

## Objectif

Le `PlanningDrawer` existant a 2 onglets (Budgets / Revenus). Ajouter un 3ème onglet "Projets" qui rend une liste de projets avec :

- Cercle de progression (% = `amount_saved / target_amount`)
- Nom + deadline + mois restants
- Montant `amount_saved / target_amount` (ex : `4084 / 7000€`)
- Dropdown Modifier/Supprimer (placeholders — les modals viennent aux sprints 05-06)

## Pré-lecture obligatoire

- [components/dashboard/PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) — 480 LOC. `TabType` ligne 48, switch tab ligne 73, onglet budgets 517-645.
- [components/dashboard/BudgetProgressIndicator.tsx](../../components/dashboard/BudgetProgressIndicator.tsx) — pattern visuel item budget
- [components/ui/DropdownMenu.tsx](../../components/ui/DropdownMenu.tsx) — composant actions
- [hooks/useProjects.ts](../../hooks/useProjects.ts) — sprint 02
- [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) — règles ❌ Modals & UI

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Étendre `PlanningDrawer.tsx`

- `TabType = 'budgets' | 'revenus'` → `'budgets' | 'revenus' | 'projets'`
- Ajouter un 3ème bouton onglet dans le header tab-switcher (même style que les 2 existants — copier le pattern Tailwind exact)
- Ajouter le rendu de la liste projets (mirror lignes 517-645 budgets)
- Brancher `useProjects(context)` (depuis `hooks/useProjects.ts`)
- Empty state : "Aucun projet en cours. Tap '+' pour créer ton premier projet."

### 2. Nouveau composant — `components/dashboard/ProjectListItem.tsx`

- Props : `{ project: SavingsProjectRow, onEdit, onDelete, onTapInfo? }`
- Layout : `rounded-xl border border-gray-200 p-3 shadow-md` (cohérent budgets)
- Cercle de progression à gauche (SVG ou Tailwind ring) — utiliser couleur violet (cohérent économies / `cumulated_savings`)
- À droite : nom, date deadline formatée fr-FR ("Échéance : 31/12/2027"), mois restants ("36 mois restants"), montant `4084 / 7000€`
- Dropdown actions à droite : "Modifier" → `onEdit`, "Supprimer" → `onDelete`

### 3. Helper format

Étendre [lib/format-currency.ts](../../lib/format-currency.ts) si nécessaire ou créer un helper local `formatMonthsRemaining(deadline: string): string` dans `lib/finance/projects-meta.ts` (sprint 03).

### 4. Cercle de progression

Composant interne ou réutilisation `BudgetProgressIndicator` si le pattern circulaire existe. Sinon créer un mini composant SVG circle (40px viewport).

### 5. Tests RTL — `components/dashboard/__tests__/ProjectListItem.test.tsx`

- Cas 1 : rendu happy path (nom, %, montants visibles)
- Cas 2 : dropdown action Modifier déclenche `onEdit`
- Cas 3 : dropdown action Supprimer déclenche `onDelete`
- Cas 4 : empty state quand pas de projets (test sur PlanningDrawer monté)

### 6. Tests RTL focus-trap

Étendre `components/dashboard/__tests__/PlanningDrawer.test.tsx` si existant pour valider l'onglet Projets respecte `expectEscClose` (cf. [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md)).

### 7. Vérifications

- Lancer `pnpm dev` + tester en navigateur DevTools mobile 412×916 que l'onglet Projets s'affiche, scroll, dropdown ouvre.
- `pnpm typecheck` + `pnpm lint:check` exit 0
- `pnpm test:run` exit 0

### 8. Commit

```
feat(projects): UI — 3rd tab in PlanningDrawer with project list
```

## Acceptance criteria

- 3 onglets visibles dans le drawer planificateur, switch sans flicker.
- Cliquer sur l'onglet Projets affiche la liste (ou empty state).
- Dropdown Modifier/Supprimer ouvre des stubs `alert()` ou `console.log` (sera branché aux modals sprints 05-06).
- 0 régression visuelle sur les onglets Budgets/Revenus.

## Hors scope

- Modal create/edit (sprint 05-06).
- Validation RAV via factory schema (sprint 05).
- Recap (sprint 07+).
