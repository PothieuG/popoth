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
