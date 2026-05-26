# Roadmap Detailed — Part 31 : Projets-Épargne finalize → polish

Sprint 10 (finalize wiring) + sprint 11 à venir (seeds + push prod) de la feature Projets-Épargne. Continuation de [Part 30](roadmap-detailed-30-projets-epargne-modals.md) (sprints 05-09 modals → refloat UI).

---

- ✅ **Sprint 10 — Finalize : application snapshot projets + preview FinalRecapStep** (livré 2026-05-26 sur `feature/projets-epargne`, commit `51bb362`).

  ### Périmètre

  Câblage de la RPC `apply_recap_projects_snapshot` (créée au sprint 01) dans l'orchestrateur `executeCompleteRecap`. À la finalisation du recap, la RPC itère sur TOUS les projets actifs de l'owner et applique : `amount_saved += monthly_allocation - refund` ; `pending_delay_fraction += refund/monthly_allocation` ; si le cumul fractionnaire ≥ 1, `deadline_date += FLOOR(...)` mois et la fraction résiduelle persiste. Pour la preview avant clic, `RecapSummary.projectSnapshot` est calculée pure côté serveur depuis `savingsProjects` + `monthly_recaps.project_snapshot_data` (miroir exact de la RPC), exposée au `FinalRecapStep` qui affiche une section "Projets" avec count + total refund + liste des shifts. La RPC est TOUJOURS invoquée (même `project_snapshot_data` vide) pour créditer les allocations mensuelles non-refloutées. Fail-soft : log + `projectsApplied=null` en cas d'erreur RPC, finalize continue. Aucune migration DB (la RPC sprint 01 était déjà déployée sur dev).

  ### Modules livrés (5 modifs core + 1 nouveau test gated + 5 modifs tests + 1 type extension)

  - [lib/recap/actions-finalize.ts](../../lib/recap/actions-finalize.ts) — `executeCompleteRecap` étendu d'une 2e étape entre snapshot budgets et process_transactions : `rpc('apply_recap_projects_snapshot', { p_recap_id, p_allocations: project_snapshot_data ?? {} })`. Toujours appelée (même `{}`) — la RPC LOOP no-op si l'owner n'a aucun projet. Args `ExecuteCompleteRecapArgs.recap` reçoit `project_snapshot_data: Json` (required, le route handler le forward). Outcome étendu `projectsApplied: { updated_count, total_refunded } | null`.
  - [app/api/monthly-recap/complete/route.ts](../../app/api/monthly-recap/complete/route.ts) — passe `recap.project_snapshot_data` à `executeCompleteRecap` (1 nouvelle ligne).
  - [app/api/monthly-recap/status/route.ts](../../app/api/monthly-recap/status/route.ts) — extrait `projectSnapshotData = coerceSnapshot(recapRow?.project_snapshot_data)` et le forward à `loadRecapSummary` (en plus de `piggyTransfersData`). Permet à `summary.projectSnapshot` de refléter le snapshot accumulé pendant la cascade.
  - [lib/recap/calculations.ts](../../lib/recap/calculations.ts) — `computeRecapSummary` accepte `projectSnapshotData?: Record<string, number>` et calcule `projectSnapshot` via nouvelle fonction privée `computeProjectSnapshotSummary` (semantics miroir RPC : `totalSaved = sum(monthly - refund)`, `totalRefunded = sum(refund)`, `shifted = projects where FLOOR(pending + refund/monthly) ≥ 1`). Omitted si `savingsProjects.length === 0`.
  - [lib/recap/types.ts](../../lib/recap/types.ts) — nouveau type `ProjectSnapshotSummary { totalSaved, totalRefunded, shifted: [{id, name, monthsShift}] }`. `RecapSummary.projectSnapshot?: ProjectSnapshotSummary` ajouté optionnel.
  - [lib/recap/index.ts](../../lib/recap/index.ts) — re-export `ProjectSnapshotSummary`.
  - [lib/recap/load-summary.ts](../../lib/recap/load-summary.ts) — input étendu `projectSnapshotData?: Record<string, number>`, forwardé verbatim à `computeRecapSummary`.
  - [lib/finance/types.ts](../../lib/finance/types.ts) — `SavingsProjectMeta.pendingDelayFraction: number` ajouté. Nécessaire pour que la preview UI matche la sémantique RPC (sinon le `monthsShift` ne pourrait être calculé que pour `frac_added = 1`).
  - [lib/finance/projects-meta.ts](../../lib/finance/projects-meta.ts) — `buildSavingsProjectMeta` mappe `row.pending_delay_fraction` → `meta.pendingDelayFraction`.
  - [lib/finance/financial-data.ts](../../lib/finance/financial-data.ts) — `.select('id, name, monthly_allocation, amount_saved, target_amount, deadline_date, pending_delay_fraction')` étendu d'une colonne.
  - [components/monthly-recap/steps/FinalRecapStep.tsx](../../components/monthly-recap/steps/FinalRecapStep.tsx) — nouvelle sous-composante `ProjectsSummary` rendue conditionnellement (`summary.savingsProjects.length > 0 && summary.projectSnapshot`). Affiche : 💰 "N projet(s) ont reçu leur allocation mensuelle ce mois" + (si `totalRefunded > 0`) 📋 "Renflouement projets : −X€" + liste des shifts `{name} → décalage de Z mois`. Theme violet (cohérent avec `RefloatProjectsLine`).
  - [hooks/useMonthlyRecap.ts](../../hooks/useMonthlyRecap.ts) — `CompleteRecapResult.projectsApplied?: { updated_count, total_refunded } | null` ajouté optionnel.
  - [lib/recap/**tests**/actions-finalize-projects.test.ts](../../lib/recap/__tests__/actions-finalize-projects.test.ts) — NOUVEAU, 5 cas gated `SUPABASE_RECAP_TESTS=1` end-to-end (seed `savings_projects` + `monthly_recaps` rows, invoque `executeCompleteRecap`, relit les rows pour assert) : (1) no projects → RPC no-op `updated_count=0`, (2) no refund → `amount_saved += monthly`, deadline unchanged, (3) partial 30/100 → `amount_saved += 70`, pending=0.3, deadline unchanged, (4) full 100/100 → pending=0, deadline +1 mois, (5) 4× partial 30/100 → 4e finalize shift +1 (cumul 1.2 → résiduel 0.2).
  - [lib/recap/**tests**/actions-finalize.test.ts](../../lib/recap/__tests__/actions-finalize.test.ts) — étendu : 3 nouveaux cas mock (`apply_recap_projects_snapshot` toujours appelée même avec snapshot vide ; `project_snapshot_data` forwardé verbatim comme `p_allocations` ; fail-soft sur erreur RPC projects). 4 cas existants adaptés pour ajouter le `project_snapshot_data: {}` dans les fixtures.
  - [lib/recap/**tests**/calculations.test.ts](../../lib/recap/__tests__/calculations.test.ts) — 6 nouveaux cas `computeRecapSummary.projectSnapshot` : (a) omitted si 0 projet, (b) no refund → `totalSaved = sum(monthly)`, (c) partial 30/100 → pending=0.3 no shift, (d) full 100/100 → shift +1, (e) accumulation 0.9 + 0.3 = 1.2 → shift +1, (f) foreign refund id ignored.
  - [components/monthly-recap/**tests**/FinalRecapStep.test.tsx](../../components/monthly-recap/__tests__/FinalRecapStep.test.tsx) — 3 nouveaux RTL cas section Projets : (a) masquée si `savingsProjects=[]`, (b) N projets sans refund → "N projet(s) ont reçu leur allocation" seul, (c) refund + shift → ligne "Renflouement projets : -100,00€" + liste shifts.
  - [lib/finance/**tests**/projects-meta.test.ts](../../lib/finance/__tests__/projects-meta.test.ts) — `buildSavingsProjectMeta` test étendu d'un cas `pendingDelayFraction` non-zero forwarded verbatim.
  - 4× tests RTL existants (`BilanNegativeStep`, `RefloatProjectsLine`, `SavingsProjectsDetailDrawer`, `SummaryStep`) — fixtures `SavingsProjectMeta` étendues d'un `pendingDelayFraction: 0` chacune.

  ### Décisions de design

  - **RPC toujours invoquée** même avec `project_snapshot_data = {}`. Sémantique : la RPC LOOP itère sur les projets actifs de l'owner et crédite `amount_saved += monthly` pour ceux où `refund=0`. Sauter l'appel quand le payload est vide priverait les projets de leur allocation mensuelle normale. La RPC retourne `{ updated_count: 0 }` si l'owner n'a aucun projet — coût d'un round-trip Postgres négligeable.
  - **Order ALLOWED step gates : pas de changement**. `executeCompleteRecap` accepte toujours `current_step ∈ ['final_recap']` ; aucune extension nécessaire — la nouvelle RPC est interne au orchestrateur.
  - **Preview côté serveur, pas client**. `summary.projectSnapshot` calculé dans `computeRecapSummary` (pure) — pas de recomputation côté FinalRecapStep. Garantit la cohérence si la RPC PG évolue (single-source-of-truth = sémantique miroir explicite).
  - **`SavingsProjectMeta.pendingDelayFraction` required (pas optional)**. Tous les consumers passent déjà par `buildSavingsProjectMeta` qui mappe depuis la DB, donc aucun risque de field manquant. Optional aurait forcé un fallback `?? 0` partout = bruit.
  - **Section "Projets" placée sous le bloc bilan (avant salary line)**. Logique narrative : (1) bilan + breakdown source → (2) impact projets → (3) info salaire si applicable.
  - **Liste shifts au lieu de "tous les refunds"**. Le user voit le détail uniquement pour les projets dont la deadline va effectivement bouger (≥ 1 mois). Les refunds qui consomment seulement la fraction résiduelle sont silencieusement absorbés dans `totalRefunded`. Réduit le bruit visuel.
  - **`projectsApplied: null` fail-soft pas critique**. Si la RPC fail, le user voit le wizard se terminer sans la section "Projets" qui aurait reflété la mutation — le re-fetch dashboard suivant exposera l'état réel (les projets non-crédités restent visibles avec leur `amount_saved` pré-finalize). Logged pour triage manuel.
  - **NO smoke browser dans ce closeout** : RTL + gated DB couvrent end-to-end. Validation visuelle manuelle laissée au user (commande `pnpm dev` + scénario seed-recap avec projets + déclencher finalize).

  ### Invariants bumpés / stables

  - **Routes API : 44 stable**.
  - **EXPECTED_RPCS : 25 stable** (la RPC `apply_recap_projects_snapshot` était déjà pinnée au sprint 01).
  - **Functions DB : 34 stable**.
  - **Lint baseline : 0 errors / 0 warnings** préservé.
  - **Tests non-gated : 745 → 758** (+13 : 6 calculations + 3 FinalRecapStep + 1 projects-meta + 3 actions-finalize mocks).
  - **Tests gated `SUPABASE_RECAP_TESTS=1` : 85 → 90** (+5 nouveau fichier `actions-finalize-projects.test.ts`).
  - **Build Next.js** : 44 routes, 0 régression.

  ### Validation

  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (758/223) ; `pnpm format:check` ✓.
  - `pnpm db:check-rpcs` ✓ (25) ; `pnpm db:check-types-fresh` ✓ (matches dev) ; `pnpm db:audit-functions` ✓.
  - `SUPABASE_RECAP_TESTS=1 pnpm test:run lib/recap/__tests__/actions-finalize-projects.test.ts` → 5/5 passing (4.9s).
  - `SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/complete/__tests__/route.integration.test.ts` → 10/10 passing (aucune régression sur la finalize existante).
  - **Drift contre prod attendue** (migrations Projets-Épargne pas encore push prod, prévu sprint 11).

  ### Hors scope sprint 10 (à venir)

  - Sprint 11 : Seeds dédiés projets (scénario CLI `scripts/seed-recap/project-deficit-refloat.mjs`) + push prod migrations Projets-Épargne (sprint 01 + 08 — `savings_projects` + `project_snapshot_data` column) + PR finalisation + verify final.
