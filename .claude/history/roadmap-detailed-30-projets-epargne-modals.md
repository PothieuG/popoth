# Roadmap détaillée — Part 30 : Projets d'épargne — modals + recap (sprints 05-11)

> Append-only chronologique pour la feature **Projets d'épargne**, suite de [Part 29](roadmap-detailed-29-projets-epargne.md) (sprints 01-04 livrés). Créée 2026-05-26 par split préemptif : Part 29 saturée à 37k+ avant le closeout sprint 05.
>
> Contexte produit : voir Part 29 intro + [`.claude/plans/00-Readme.md`](../plans/00-Readme.md).

---

- ✅ **Sprint 05 — Modal CREATE projet + calcul mutuel durée↔mensuel** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Modal `AddProjectDialog` (Radix Dialog + RHF + `zodResolver(makeProjectClientSchema)`) avec toggle 2 modes (durée pilote / mensuel pilote), calcul mutuel live, deadline auto-syncée. Branchée dans `PlanningDrawer` onglet Projets (bouton "+" purple). 7 tests RTL. **0 modif backend / DB / RAV** — UI-only consuming hooks existants.

  ### Modules livrés (1 nouveau + 1 modifié + 1 test)
  - [`AddProjectDialog.tsx`](../../components/dashboard/AddProjectDialog.tsx) (~340 LOC) — État local : `mode: 'duration' | 'monthly'` + `durationInputA` (utilisé UNIQUEMENT en mode='duration' ; en mode='monthly' la durée est dérivée via `useMemo(derivedDurationFromMonthly)`). 2 useEffect sync `form.setValue` exclusivement (pas de `setDurationInputA` en effect → satisfait `react-hooks/set-state-in-effect`). Toggle `'monthly' → 'duration'` seed `setDurationInputA(derivedDurationFromMonthly)` dans handler synchrone. `onInvalidSubmit` route le focus vers `#add-project-duration` quand `monthlyAllocation` invalid en mode='duration' (le Controller n'est pas monté).
  - [`PlanningDrawer.tsx`](../../components/dashboard/PlanningDrawer.tsx) — pull `addProject` du hook, state `isAddProjectOpen`, lazy dynamic import `AddProjectDialog`, render passant `currentAllocatedTotal={totalBudgets + totalMonthlyAllocations}` + `totalEstimatedIncome={budgetCeiling}` (réutilise même plafond que budgets pour briser le cycle groupe vide). Handler `handleAddProject` retourne `boolean` (await + close + propagate `onPlanningChange`). `handleAddProjectStub` supprimé.
  - [`AddProjectDialog.test.tsx`](../../components/dashboard/__tests__/AddProjectDialog.test.tsx) — 7 cas RTL (mode A/B happy paths, toggle preserve, refine RAV, refine durée min, Esc focus trap, axe 0 violations).

  ### Décisions de design
  - **Arrondi cents `ceil(target × 100 / duration) / 100`** : `target/duration` perd des fractions de centime à l'arrondi standard (ex. 1000/3=333.33, ×3=999.99 < 1000 → refine 2 du schéma fail). Arrondi supérieur au centime garantit `monthly × duration ≥ target` toujours.
  - **Pas de `setDurationInputA` dans useEffect** : refactor après ESLint flag `react-hooks/set-state-in-effect`. Mode='monthly' : durée purement dérivée (`useMemo`). Mode='duration' : durée = state local. `effectiveDuration` ternaire mode-conditionnel alimente l'unique useEffect sync de `deadlineDate` (via `form.setValue`, pas setState React → pas de cascade renders). Seed du toggle déplacé dans handler synchrone.
  - **`currentAllocatedTotal` au call-site** (`totalBudgets + totalMonthlyAllocations`) plutôt que `useFinancialData(...).totalEstimatedBudgets` : PlanningDrawer a déjà ces totaux en scope via `useBudgets`+`useProjects`, pas besoin d'introduire `useFinancialData`. Mirror `AddBudgetDialog`'s `currentBudgetsTotal={totalBudgets}`.

  ### Invariants bumpés
  - **Tests non-gated passants** : 695 → 702 (+7).
  - Lint baseline 0/0 préservée. EXPECTED_RPCS, fn DB versionnées, routes API inchangés.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ ; `pnpm test:run` ✓ (702/211) ; `pnpm format:check` ✓ ; `pnpm dev` smoke compile 433ms, `/connexion` HTTP 200.
  - **Vérif visuelle DevTools non-effectuée côté CLI** — à valider par le user en `pnpm dev` avant push prod sprint 11.
  - `pnpm verify` drift check rouge **pré-existant** (baseline file ref dev vs live prod) — non lié sprint 05 UI-only.

  ### Hors scope sprint 05 (à venir)
  - Sprint 06 : `EditProjectDialog` (réutilise `makeProjectClientSchema` avec `currentProjectAllocation` + `amountSaved`) + `ConfirmationDialog` suppression (crédit tirelire via `delete_savings_project_to_piggy`).
  - Sprints 07-11 : drawer recap, refloat backend/UI, finalize wiring, seeds + push prod + PR.

---

- ✅ **Sprint 06 — Modal EDIT projet + DELETE avec snackbar tirelire** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Modal `EditProjectDialog` (mirror `AddProjectDialog` + delta-math RAV + prise en compte `amount_saved`). Branchement EDIT/DELETE dans `PlanningDrawer` onglet Projets via stubs sprint 04 remplacés. `<ConfirmationDialog>` étendu pour le case `type='project'` : message dédié + annonce du transfert tirelire si `amount_saved > 0`. Snackbar transient réécrit en union discriminée `{ piggy-credit | project-deleted }` pour gérer le cas "projet supprimé sans solde". 11 tests RTL livrés (7 EditProjectDialog + 4 DeleteProjectConfirmation). **0 modif backend / DB / RAV** — UI-only consuming hooks et RPC existants.

  ### Modules livrés (1 nouveau + 1 modifié + 2 tests)
  - [`EditProjectDialog.tsx`](../../components/dashboard/EditProjectDialog.tsx) (~365 LOC) — Pré-rempli depuis `project.{name, target_amount, monthly_allocation, deadline_date}`. `initialDuration = monthsBetween(today, deadline) ?? 1` (clamp ≥ 1 pour ne pas afficher "0 mois" sur deadline passée). `makeProjectClientSchema({ ..., currentProjectAllocation, amountSaved })` — delta-math RAV pour ne pas double-compter l'allocation existante. Mode A "Tu épargneras X€/mois" utilise `(target − amountSaved)` (pas `target/duration` naïf) pour ne pas ignorer l'argent déjà capitalisé. Marge dispo affichée = `totalEstimatedIncome − (currentAllocatedTotal − currentProjectAllocation)` (ce que l'edit pourrait libérer). Note "Déjà épargné : X€ · Reste à atteindre : Y€" sous le champ target si `amountSaved > 0`.
  - [`PlanningDrawer.tsx`](../../components/dashboard/PlanningDrawer.tsx) — pull `updateProject` + `deleteProject` du hook, state `isEditProjectOpen` + `editingProject`. Union `deletingItem.type` étendue avec `'project'` + champ `amountSaved` (0 pour budget/income). Stubs `handleEditProjectStub` + `handleDeleteProjectStub` supprimés (drop de l'import `logger` orphelin). Handlers `handleEditProject` + `handleRequestDeleteProject` + `handleSaveEditedProject` ajoutés. `handleConfirmDelete` étendue avec branche `type === 'project'` → `deleteProject(id)` + read du `transferredAmount` (RPC `delete_savings_project_to_piggy`). `<ConfirmationDialog>` adapté : message court "Êtes-vous sûr de vouloir supprimer le projet \"X\" ?" + details mentionnant le transfert tirelire si `amountSaved > 0` + bouton "Supprimer et transférer" / "Supprimer" selon le cas. Snackbar refactoré en union discriminée `{ piggy-credit; amount } | { project-deleted }` — message "Projet supprimé" (court) pour le case `amount_saved = 0`. Lazy-mount `{isEditProjectOpen && editingProject && <EditProjectDialog key={editingProject.id} />}` standard Sprint 1.5.
  - [`EditProjectDialog.test.tsx`](../../components/dashboard/__tests__/EditProjectDialog.test.tsx) — 7 cas RTL : pré-remplissage + note "Déjà épargné", refine RAV avec delta (passe), refine RAV qui bloque, mensuel dérivé tient compte d'`amount_saved` (target=12k saved=3k duration=30 → mensuel=300 pas 400), key reset cross-project (rerender avec key différente → defaultValues re-init), Esc focus-trap, axe 0 violations.
  - [`DeleteProjectConfirmation.test.tsx`](../../components/dashboard/__tests__/DeleteProjectConfirmation.test.tsx) — 4 cas RTL monte `PlanningDrawer` minimal (mocks hooks + lazy modals stubbés sauf `ConfirmationDialog` réel) : message avec amount_saved > 0 + bouton "Supprimer et transférer", confirm → `deleteProject` appelé + snackbar tirelire (`/4 084,00 €/ + /transféré dans la tirelire/`), amount_saved = 0 → confirm → snackbar court "Projet supprimé", cancel → modal close sans mutation.

  ### Décisions de design
  - **`monthsBetween` clampé à ≥ 1** pour `initialDuration` : si la deadline existante est dans le passé ou ce mois (rare en pratique, projet "en retard"), on tomberait sur 0 → input "Durée (mois)" vide + mensuel dérivé impossible → submit fail silencieux. Clamp ≥ 1 permet à l'utilisateur de visualiser le bug et de prolonger l'échéance.
  - **Snackbar union discriminé** : le pattern existant `{ amount: number }` ne pouvait pas porter le case "projet supprimé sans solde" sans heuristique fragile (`amount === 0` ⇒ message court). Migration vers `{ kind: 'piggy-credit'; amount } | { kind: 'project-deleted' }` explicite. Le case `income` n'a pas de snackbar (suppression silencieuse, la row disparaît visuellement) — comportement préservé.
  - **Détail "Déjà épargné · Reste à atteindre"** affiché conditionnellement si `amountSaved > 0` : sinon la note apparaîtrait sur un projet jamais touché (0€/X€), bruit inutile. Le refine 2 utilise `target − amountSaved` peu importe la valeur ; seul l'affichage cosmétique est conditionné.
  - **Tests `DeleteProjectConfirmation` monte PlanningDrawer entier** : alternative envisagée (test isolé du `ConfirmationDialog` avec props générées) ne couvrait pas le wiring (handler `handleConfirmDelete` + snackbar + close). Le coût d'un mount complet est faible (~600ms par test) car les autres modals sont stubbées via `vi.mock`.

  ### Invariants bumpés
  - **Tests non-gated passants** : 702 → 713 (+11 : 7 EditProjectDialog + 4 DeleteProjectConfirmation).
  - Lint baseline 0/0 préservée. EXPECTED_RPCS, fn DB versionnées, routes API inchangés (pas de modif backend).

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (713/211) ; `pnpm format:check` ✓.
  - **Vérif visuelle DevTools non-effectuée côté CLI** — à valider par le user en `pnpm dev` avant push prod sprint 11.
  - `pnpm verify` drift check rouge **pré-existant** (baseline file ref dev vs live prod, noté Part 30 sprint 05 closeout) — non lié sprint 06 UI-only.

  ### Hors scope sprint 06 (à venir)
  - Sprints 07-11 : drawer recap, refloat backend/UI, finalize wiring, seeds + push prod + PR.
