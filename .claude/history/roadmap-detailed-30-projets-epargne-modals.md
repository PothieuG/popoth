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

---

- ✅ **Sprint 07 — Drawer "Projets en cours" sur l'écran initial du wizard recap** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Sur l'écran `summary` du wizard Monthly Recap V3, ajout d'un bouton-cellule "📋 N projet(s) en cours" affiché sous "Total économies" quand l'owner a au moins 1 projet, ouvrant un drawer lecture-seule violet qui liste chaque projet (mini cercle de progression + nom + `amount_saved/target` + deadline + N mois restants). 0 fetch supplémentaire : la donnée est portée par `RecapSummary.savingsProjects` (nouveau champ), alimenté depuis `financialData.meta?.savingsProjects` déjà fetché par `_loadFinancialData` (sprint 03). 7 tests RTL drawer + 3 tests SummaryStep + 2 tests pure passthrough sur `computeRecapSummary`. **0 modif backend / DB** — pur passthrough de données déjà disponibles.

  ### Modules livrés (2 nouveaux + 9 modifiés)
  - [`components/monthly-recap/SavingsProjectsDetailDrawer.tsx`](../../components/monthly-recap/SavingsProjectsDetailDrawer.tsx) (~155 LOC) — Mirror `SavingsDetailDrawer` : header violet plein (icône clipboard-check + DialogTitle "Projets en cours" + sous-titre + `ModalCloseX variant="circle"`), `DRAWER_CONTENT_CLASSES` fullscreen, body scroll. Liste : 1 `<li>` par projet avec mini SVG ring (40px, palette `violet-100`/`violet-600`) + % centré (`aria-label="X% atteint"`), nom + ligne "Échéance : JJ/MM/AAAA · N mois restants" via `formatDeadline` + `formatMonthsRemaining`, montant `saved / target` (text-violet-700 / text-gray-500). Empty state : "Tu n'as aucun projet en cours pour l'instant."
  - [`components/monthly-recap/__tests__/SavingsProjectsDetailDrawer.test.tsx`](../../components/monthly-recap/__tests__/SavingsProjectsDetailDrawer.test.tsx) (~120 LOC) — 7 cas RTL : rendu 3 projets (nom + % + montant + deadline + plural "N mois restants"), singular "1 mois restant", empty state, `isOpen=false` unmount, close button `aria-label="Fermer"`, ESC close via `expectEscClose`, axe 0 violations.
  - [`lib/recap/types.ts`](../../lib/recap/types.ts) — Ajout `RecapSummary.savingsProjects: readonly SavingsProjectMeta[]` (toujours présent, `[]` quand aucun projet). Import du type depuis `@/lib/finance/types`. Le commentaire pointe sprint 09 (`RefloatProjectsLine` consommera la même donnée).
  - [`lib/recap/calculations.ts`](../../lib/recap/calculations.ts) — `computeRecapSummary` accepte `savingsProjects?: readonly SavingsProjectMeta[]` (optional input avec default `[]` au return). Pure passthrough — aucune logique de calcul ajoutée.
  - [`lib/recap/load-summary.ts`](../../lib/recap/load-summary.ts) — Lit `financialData.meta?.savingsProjects ?? []` et forward à `computeRecapSummary`. Zero round-trip supplémentaire : `getProfileFinancialData`/`getGroupFinancialData` fetch déjà la table `savings_projects` au sprint 03 et expose `SavingsProjectMeta[]` dans `meta`.
  - [`lib/recap/__tests__/calculations.test.ts`](../../lib/recap/__tests__/calculations.test.ts) — 2 cas nouveaux : default `[]` quand omis ; passthrough verbatim quand fourni (2 projets, deep equality).
  - [`components/monthly-recap/steps/SummaryStep.tsx`](../../components/monthly-recap/steps/SummaryStep.tsx) — `useState projectsOpen`, calcul `activeProjects` + `hasProjects` + `projectsLabel` (singular/plural). Bouton cellule ajouté sous "Total économies" : `border-l-4 border-l-violet-400`, fond hover violet pâle, icône 📋 + texte + chevron droit `aria-hidden`, masqué entièrement si `hasProjects=false`. Drawer lazy-mounted `{projectsOpen && <SavingsProjectsDetailDrawer ... />}` (pattern Sprint 1.5 standard).
  - [`components/monthly-recap/__tests__/SummaryStep.test.tsx`](../../components/monthly-recap/__tests__/SummaryStep.test.tsx) — Factory `makeSummary` étendue avec `savingsProjects: []` (default). 3 cas nouveaux : ligne hidden si vide, "1 projet" singular, "N projets" plural + click ouvre le drawer.
  - **5 factories `makeSummary` étendues** dans les RTL tests recap : `BilanNegativeStep.test.tsx`, `BilanPositiveStep.test.tsx`, `FinalRecapStep.test.tsx`, `RecapWizard.test.tsx`, `SalaryUpdateStep.test.tsx` — ajout du field `savingsProjects: []` pour matcher le nouveau shape (sinon `toEqual` casse).

  ### Décisions de design
  - **Passthrough via `RecapSummary` plutôt que nouveau hook `useFinancialData()` côté UI** : 0 fetch supplémentaire, single-source-of-truth (le wizard consomme déjà `useMonthlyRecap` qui fetche `/api/monthly-recap/status` qui pipe `loadRecapSummary`). Le sprint 09 (refloat from projects via cascade `BilanNegativeStep`) consommera la même donnée — symétrique au pattern `summary.budgets[]` déjà utilisé par les 2 autres detail drawers. Le plan sprint 07 laissait la décision ouverte ("via `meta` ou nouvelle query") — choix pesé en favor du passthrough.
  - **Field `savingsProjects` requis (non-optional) sur `RecapSummary`** : `groupSalaryTotal` est conditionnel (spread `...(value !== undefined && {...})`) car sémantiquement absent en perso, mais `savingsProjects` est applicable aux 2 contextes (juste `[]` quand 0 projet). Le coût : 6 factories `makeSummary` à étendre. Bénéfice : pas de `?? []` chez chaque consumer (sprint 09 inclus).
  - **Bouton cellule plutôt que `<SummaryCard>` avec `onShowDetail`** : la `SummaryCard` impose label + amount + lien optionnel — un projet n'a pas de montant global pertinent (l'aggregate `totalMonthlyProjects` existe mais affiché en plein recap n'apporte rien à l'utilisateur). Le format "📋 N projet(s) en cours" + chevron est plus proche d'un lien de navigation que d'une carte de métrique. Garde l'accent visuel violet `border-l-4 border-l-violet-400` pour rester dans la palette "économies" sans copier la structure de la card.
  - **Singular/plural via ternaire `length === 1`** : "1 projet en cours" sans `s`, "N projets en cours" sinon. Le `0` est masqué donc pas géré. Le test couvre les 3 cas (0/1/N).
  - **Mini ring 40px (vs 44px planner)** : le drawer recap est dense (plusieurs lignes empilées), 40px laisse plus de respiration sans casser la lisibilité du % au centre (`text-[10px] font-bold`).
  - **Lazy-mount drawer mais import statique** : conditional `{projectsOpen && <Drawer />}` évite le mount du Radix Portal au load initial du wizard (~5kB JS sinon). `next/dynamic` aurait été overkill (le drawer est déjà côté client only, et la Suspense boundary requise complexifierait le SummaryStep). Pattern cohérent avec les 2 sibling drawers du même fichier.

  ### Invariants bumpés
  - **Tests non-gated passants** : 713 → 725 (+12 : 7 SavingsProjectsDetailDrawer RTL + 3 SummaryStep RTL + 2 computeRecapSummary pure passthrough).
  - **Tests gated skipped** : 211 stables (aucun nouveau gated DB sprint 07).
  - Lint baseline 0/0 préservée. EXPECTED_RPCS 25 stable. Functions DB 34 stable. Routes API 43 stable. 0 nouvelle migration.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (725/211) ; `pnpm format:check` ✓ ; `pnpm check:md-size` ✓.
  - **Vérif visuelle DevTools non-effectuée côté CLI** : aucun seed-recap scénario embarquant des projets à ce jour. À valider par le user en `pnpm dev` après création manuelle de 2 projets via le planificateur (sprints 04-06) puis démarrage d'un recap.
  - `pnpm verify` chain : tous les db:\* checks ✓ contre `ddehmjucyfgyppfkbddr` (set `$env:SUPABASE_PROJECT_REF`) ; drift contre prod rouge pré-existant (migrations Projets-Épargne non encore pushées prod, expected sprint 11).

  ### Hors scope sprint 07 (à venir)
  - Sprint 08 : RPC `executeRefloatFromProjects` + endpoint `POST /api/monthly-recap/refloat-from-projects` + mutation `useRefloatFromProjects`. Extension `monthly_recaps.project_snapshot_data jsonb` (miroir `budget_snapshot_data`). Pure helper `computeProportionalProjectsRefloat`.
  - Sprint 09 : Composant `RefloatProjectsLine` dans la cascade `BilanNegativeStep` entre `RefloatSavingsLine` et `RefloatBudgetSnapshotLine`. Lire `summary.savingsProjects` (livré ce sprint 07).
  - Sprint 10 : Wire de `project_snapshot_data` dans `finalize_recap_apply_snapshot` (extension de la RPC sprint 08 V3) + résumé final `FinalRecapStep`.
  - Sprint 11 : Seeds dédiés projets, push prod migrations Projets-Épargne, PR finalisation.

---

- ✅ **Sprint 08 — Backend refloat-from-projects + `project_snapshot_data` JSONB** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Nouvel endpoint `POST /api/monthly-recap/refloat-from-projects` qui calcule une allocation proportionnelle des projets actifs (pool = `monthly_allocation`) et OVERWRITE le tracker `monthly_recaps.project_snapshot_data` JSONB. Snapshot deferred : aucune mutation côté `savings_projects` ici — l'application est repoussée à finalize (sprint 10) via `apply_recap_projects_snapshot` (sprint 01). Pure helper `computeProportionalProjectsRefloat` réutilise `distributeProportional` (engine stable cents-precise). `computeDeficitRemaining` étendu d'un terme optionnel `projectSnapshotData` qui soustrait le snapshot projet du déficit restant. Les 3 helpers existants (`executeRefloatFromPiggy`/`Savings`/`SaveBudgetSnapshot`) le passent désormais — soustraction transparente pour le sprint 09 cascade UI. Endpoint status expose `recap.projectSnapshotData` à parité avec `snapshotData`/`piggyTransfersData`.

  ### Modules livrés (1 migration + 5 modifs + 1 nouveau + 1 test gated)
  - [supabase/migrations/20260602000000_add_project_snapshot_to_monthly_recaps.sql](../../supabase/migrations/20260602000000_add_project_snapshot_to_monthly_recaps.sql) — `ALTER TABLE monthly_recaps ADD COLUMN project_snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb` + `NOTIFY pgrst, 'reload schema'`. Sibling pattern de `20260530000000_add_piggy_transfers_data_to_monthly_recaps.sql`. Appliqué à dev (`ddehmjucyfgyppfkbddr`), prod différée sprint 11.
  - [lib/recap/calculations.ts](../../lib/recap/calculations.ts) — `computeProportionalProjectsRefloat(targetAmount, projects)` (pool=`monthly_allocation`, mappe `projectId → budgetId` pour réutiliser `distributeProportional` + `RefloatProportionalAllocation` shape).
  - [lib/recap/deficit-math.ts](../../lib/recap/deficit-math.ts) — `ComputeDeficitArgs.projectSnapshotData` (optional) + soustraction `sumSnapshotValues(projectSnapshotData)` au déficit restant. Optionnel pour back-compat des call sites legacy + tests.
  - [lib/recap/actions-negative.ts](../../lib/recap/actions-negative.ts) — `executeRefloatFromProjects(args)` (+118 LOC) mirror `executeSaveBudgetSnapshot` : load summary → check bilan négatif → calc deficitRemaining (snapshotData budget inclus, projectSnapshotData=null car overwrite) → `computeProportionalProjectsRefloat(deficit, summary.savingsProjects.map(p → projectId+monthlyAllocation))` → UPDATE `monthly_recaps.project_snapshot_data`. Throws `RecapActionError('no_projects_available', 409)` quand 0 projet ou totalPool=0. Les 3 helpers existants (`RefloatFromPiggy/Savings`, `SaveBudgetSnapshot`) reçoivent `projectSnapshotData: coerceSnapshot(args.recap.project_snapshot_data)` pour soustraire le snapshot projet du target.
  - [lib/schemas/recap.ts](../../lib/schemas/recap.ts) — `refloatFromProjectsBodySchema = z.object({ context })`.
  - [app/api/monthly-recap/refloat-from-projects/route.ts](../../app/api/monthly-recap/refloat-from-projects/route.ts) (nouveau) — mirror `refloat-from-savings/route.ts`. `withAuthAndProfile` + Zod parseBody + getActiveRecap + step gate `summary|manage_bilan` + executeRefloatFromProjects. NE PAS advance `current_step` (sprint 09 cascade UI owns transitions).
  - [app/api/monthly-recap/status/route.ts](../../app/api/monthly-recap/status/route.ts) + [hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts) `RecapProgress.projectSnapshotData: Record<string, number> | null` — parité avec `snapshotData` / `piggyTransfersData`. 3 test fixtures mises à jour (`BilanNegativeStep.test.tsx`, `FinalRecapStep.test.tsx`, `RecapWizard.test.tsx`) — pattern miroir du field `piggyTransfersData`.
  - [app/api/monthly-recap/refloat-from-projects/**tests**/route.integration.test.ts](../../app/api/monthly-recap/refloat-from-projects/__tests__/route.integration.test.ts) — 7 cas gated `SUPABASE_RECAP_TESTS=1` (happy, partial pool<deficit, no_projects_available, no_deficit déjà couvert, overwrite idempotence, not_initiator group, invalid_step).
  - +8 unit tests purs (6 `computeProportionalProjectsRefloat` + 2 `computeDeficitRemaining` term projectSnapshotData).

  ### Décisions de design
  - **Pool = `monthly_allocation` (PAS `amount_saved`)** : sémantique "renoncer temporairement à l'épargne mensuelle d'un projet" du plan §5.2. Le capital `amount_saved` reste sanctuarisé jusqu'à `delete_savings_project_to_piggy`. Cohérent avec la formule où `monthly_allocation` est traitée comme un budget virtuel (sprint 03 — `totalEstimatedBudgets` inclut les allocations projets).
  - **`projectSnapshotData` optional dans `ComputeDeficitArgs`** : éviter de casser les ~30 call sites + tests legacy qui invoquent `computeDeficitRemaining(...)` sans ce field. Quand omis = `undefined` → `sumSnapshotValues(undefined) = 0` → no-op. Symétrique avec `snapshotData` qui reste `Record<string,number> | null | undefined`.
  - **`executeRefloatFromProjects` inclut `budget_snapshot_data` dans la cible** (vs `null` pour le budget snapshot helper) : projets sont une étape UPSTREAM du budget snapshot dans le cascade. Quand le user retourne sur l'étape projets après avoir saved le budget snapshot, le projet allocation ne doit pas re-couvrir le déficit déjà adressé par le budget snapshot. `projectSnapshotData=null` est seul exclu (replace), tout le reste reste inclus.
  - **No advance `current_step`** : pattern miroir `executeRefloatFromSavings`. Le sprint 09 cascade UI gérera les transitions explicites via `useAdvanceStep`.
  - **Erreur `no_projects_available` (snake_case)** : cohérent avec les autres codes (`no_deficit`, `not_initiator`, `invalid_step`). Le plan utilisait `no-projects-available` (hyphen) — corrigé pour uniformité.

  ### Invariants bumpés / stables
  - **Routes API : 43 → 44** (`/api/monthly-recap/refloat-from-projects`).
  - EXPECTED_RPCS 25 stable. Functions DB 34 stable. Lint 0/0 préservée.
  - **Tests non-gated : 725 → 733** (+8 unit pure-calc / deficit-math).
  - **Tests gated `SUPABASE_RECAP_TESTS=1` : 78 → 85** (+7 cas integration refloat-from-projects).
  - **`monthly_recaps` Insert/Row : +1 colonne** `project_snapshot_data: Json` (DEFAULT `'{}'`). 1 nouvelle migration appliquée à dev (prod sprint 11).
  - **`RecapProgress.projectSnapshotData`** exposé via `/api/monthly-recap/status` — disponible côté client pour le sprint 09 sans plumbing additionnel.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (733/218) ; `pnpm format:check` ✓.
  - `pnpm db:check-drift` ✓ contre dev ; `pnpm db:check-rpcs` ✓ (25) ; `pnpm db:check-types-fresh` ✓ (matches dev).
  - `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/refloat-from-projects` → 7/7 passing (1.3s).
  - **Régression connue pré-existante** : 4 tests gated `save-budget-snapshot` étaient déjà rouges AVANT sprint 08 (stash-pop check confirmed). Hors scope ce sprint ; à investiguer séparément.

  ### Hors scope sprint 08 (à venir)
  - Sprint 09 : UI cascade `RefloatProjectsLine` dans `BilanNegativeStep` entre savings et budget snapshot ; mutation `useRefloatFromProjects` côté hook ; copy + ARIA + tests RTL.
  - Sprint 10 : Wire `project_snapshot_data` dans `finalize_recap_apply_snapshot` (ou route directe vers `apply_recap_projects_snapshot` sprint 01 RPC) + résumé final `FinalRecapStep` (section "Renflouement via projets : N€ réparti sur M projets").
  - Sprint 11 : Seeds dédiés projets + push prod migrations Projets-Épargne (sprint 01 + 08 — `savings_projects` + `project_snapshot_data` column) + PR finalisation.

---

- ✅ **Sprint 09 — UI cascade RefloatProjectsLine entre savings et budget snapshot** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Nouveau composant `RefloatProjectsLine` inséré dans la cascade séquentielle du `BilanNegativeStep` ENTRE `RefloatSavingsLine` et `RefloatBudgetSnapshotLine`. Même UX que les lignes adjacentes : 5 états (`active | locked | done | empty | unneeded`), même couleur violet (économies family), même pattern preview/done/click → mutation → snackbar. La machine à états du `BilanNegativeStep` est étendue d'une 4e ligne entre savings et budget snapshot — `projects.state` calculé en fonction de `savingsOutOfTheWay + projects.length + projects.every(p ⇒ allocation ≤ 0) + deficitCovered + projectsDone`. Aucun nouveau endpoint (mutation `useRefloatFromProjects` câblée à l'endpoint sprint 08 `POST /api/monthly-recap/refloat-from-projects`). `computeDeficitRemaining` reçoit désormais `projectSnapshotData: recap.projectSnapshotData` côté UI (le helper le supportait déjà depuis sprint 08).

  ### Modules livrés (4 modifs + 1 nouveau composant + 1 nouveau test)
  - [components/monthly-recap/RefloatProjectsLine.tsx](../../components/monthly-recap/RefloatProjectsLine.tsx) (nouveau, +180 LOC) — clone `RefloatSavingsLine.tsx` adapté. Props `{ context, state, projects, deficitRemaining, projectSnapshotData, onError, onSuccess }`. Theme **violet** (cohérent économies family). États : `locked` (waiting copy "Disponible après avoir transféré la tirelire et les économies"), `empty` ("Aucun projet à utiliser"), `unneeded` ("Pas nécessaire — déficit comblé"), `done` (total refloué + remaining mensualité par projet `nouvelle / mensualité`), `active` (per-project preview `mensualité → after`, button "Utiliser X€ depuis les projets"). Filtre `projectsByPool = projects.filter(p ⇒ monthlyAllocation > 0)` côté active pour ne pas afficher les projets à 0€. Click → `useRefloatFromProjects.mutateAsync()` → `onSuccess(totalRefloated)` (snackbar) ou `onError(code)`.
  - [hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts) — nouvelle mutation `useRefloatFromProjects(context)` (+55 LOC). POST `/api/monthly-recap/refloat-from-projects` body `{ context }`. Cache strategy `setQueryData` fast path : patch `recap.projectSnapshotData = data.allocation` (mirror `useSaveBudgetSnapshot`). NE PAS advance step. Exports `RefloatFromProjectsResult` shape `{ newDeficit, allocation, perProject, shortfall }`.
  - [components/monthly-recap/steps/BilanNegativeStep.tsx](../../components/monthly-recap/steps/BilanNegativeStep.tsx) — import `RefloatProjectsLine`. `computeDeficitRemaining` étendu avec `projectSnapshotData: recap.projectSnapshotData`. State machine étendue : `projectsEmpty = projects.length === 0 || projects.every(p ⇒ allocation ≤ 0)`, `projectsDone = sum(projectSnapshotData) > 0`, `projectsState` (mirror `savingsState` avec branche locked si `!savingsOutOfTheWay`). `projectsOutOfTheWay = savingsOutOfTheWay && (projectsDone || projectsEmpty)`. `snapshotState` reçoit le nouveau gate `!projectsOutOfTheWay ? 'locked'`. `<RefloatProjectsLine>` inséré entre `<RefloatSavingsLine>` et `<RefloatBudgetSnapshotLine>`.
  - [components/monthly-recap/**tests**/BilanNegativeStep.test.tsx](../../components/monthly-recap/__tests__/BilanNegativeStep.test.tsx) — mock `useRefloatFromProjects` ajouté + 4 nouveaux tests cascade : (a) projets actifs après savings done → button visible + budgets locked, (b) projets actifs après savings empty (skip savings), (c) 0 projet → projects empty → budgets active direct, (d) `projectSnapshotData={p1: 80, p2: 45}` → projects done state + snapshot unneeded + Continuer visible.
  - [components/monthly-recap/**tests**/RefloatProjectsLine.test.tsx](../../components/monthly-recap/__tests__/RefloatProjectsLine.test.tsx) (nouveau, 8 cas) — mirror `RefloatSavingsLine.test.tsx` : (1) locked copy + pas de button, (2) empty "Aucun projet à utiliser", (3) unneeded "déficit déjà comblé", (4) done breakdown per-project remaining/total, (5) active preview, (6) click → mutateAsync + onSuccess regex, (7) error code forwarded, (8) filter out `monthlyAllocation = 0` du preview.
  - [components/monthly-recap/**tests**/RecapWizard.test.tsx](../../components/monthly-recap/__tests__/RecapWizard.test.tsx) — ajout de `useRefloatFromProjects` au `vi.mock('@/hooks/useMonthlyRecap')` (sinon `BilanNegativeStep` crash sur l'import).

  ### Décisions de design
  - **Theme violet identique à `RefloatSavingsLine`** : per CLAUDE.md operational-rules-ui-modals + `SavingsProjectsDetailDrawer` du sprint 07, projets = économies = famille violet. Le user voit deux cards violet successives (savings + projects) avant la card orange budgets — cohérent avec la sémantique "drainer l'épargne d'abord, puis toucher les budgets en dernier".
  - **Copy locked "transféré la tirelire et les économies"** (PAS "épuisé") : pour ne pas conflit textuel avec la card snapshot locked qui dit "épuisé la tirelire et les économies" (laissée inchangée pour préserver les regressions tests existantes). Le user voit deux locked cards distinguables.
  - **`projectsEmpty` ordering BEFORE `deficitCovered`** dans la state machine : miroir `savingsState`. Si 0 projet dès le départ, on affiche "Aucun projet à utiliser" plutôt que "Pas nécessaire" — feedback plus précis.
  - **`projectsState='empty'` greyed sans interférer avec snapshot** : `getAllByText(/Pas nécessaire/)` reste à 2 occurrences (savings + snapshot) dans le test "piggy alone covers" parce que projects empty utilise une copy DIFFÉRENTE ("Aucun projet à utiliser"). Les regressions tests existantes passent verbatim.
  - **Mutation cache patch `recap.projectSnapshotData = data.allocation`** : mirror `useSaveBudgetSnapshot` (pas de summary refetch). Le `loadRecapSummary` n'a pas besoin d'être re-fetched parce que (a) les `cumulated_savings` n'ont pas bougé (snapshot DEFERRED), (b) le `summary.bilan` ne change pas (recompute depuis ravEffectif/ravEstime, indépendant du `refloated_*` côté DB). Une seule UPDATE côté DB sur `monthly_recaps.project_snapshot_data` JSONB suffit.
  - **NO smoke browser dans ce closeout** : pas d'outil de driving navigateur disponible côté Claude Code dans ce repo. Les RTL tests couvrent : la cascade gating (4 nouveaux + 4 existants étendus), le click handler (mutation called + onSuccess + onError), le breakdown rendering (active preview + done remaining/total). Validation visuelle manuelle laissée au user (commande `pnpm dev` + scénario seed-recap `bilan-negative-*` + 2 projets actifs).

  ### Invariants bumpés / stables
  - **Routes API : 44 stable** (mutation câblée sur endpoint sprint 08 existant).
  - **EXPECTED_RPCS : 25 stable**. Functions DB : 34 stable.
  - **Lint baseline : 0 errors / 0 warnings** préservé.
  - **Tests non-gated : 733 → 745** (+8 nouveaux `RefloatProjectsLine.test.tsx` + 4 nouveaux dans `BilanNegativeStep.test.tsx` cascade projets).
  - **Tests gated `SUPABASE_RECAP_TESTS=1` : 85 stable** (pas de nouveau test gated DB, l'endpoint refloat-from-projects était déjà couvert au sprint 08).
  - **Build Next.js** : 44 routes, 0 régression.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (745/218) ; `pnpm format:check` ✓.
  - `pnpm db:check-drift` ✓ contre dev (`SUPABASE_PROJECT_REF=ddehmjucyfgyppfkbddr`) ; `pnpm db:check-rpcs` ✓ (25) ; `pnpm db:check-types-fresh` ✓ ; `pnpm db:audit-functions` ✓ ; `pnpm db:audit-objects` ✓ ; `pnpm check:md-size` ✓.
  - `pnpm build` ✓ (44 routes).
  - **Drift contre prod attendue** (sprint 01 + 08 migrations Projets-Épargne pas encore push prod, prévu sprint 11).

  ### Hors scope sprint 09 (à venir)
  - Sprint 10 : Wire `project_snapshot_data` dans `finalize_recap_apply_snapshot` (ou route directe vers `apply_recap_projects_snapshot` sprint 01 RPC) + résumé final `FinalRecapStep` (section "Renflouement via projets : N€ réparti sur M projets"). → **livré 2026-05-26 commit `51bb362`**, voir [Part 31](roadmap-detailed-31-projets-epargne-finalize.md).
  - Sprint 11 : Seeds dédiés projets + push prod migrations Projets-Épargne (sprint 01 + 08 — `savings_projects` + `project_snapshot_data` column) + PR finalisation.
