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

  ### Hors scope sprint 10 (livré sprint 11 ci-dessous)
  - Seeds dédiés projets + push prod migrations Projets-Épargne + PR finalisation + verify final.

---

- ✅ **Sprint 11 — Seed CLI cascade projets + push prod migrations + closeout PR** (livré 2026-05-26 sur `feature/projets-epargne`).

  ### Périmètre

  Sprint final de la feature Projets-Épargne. **Aucune modification code applicatif / DB schema** — uniquement (a) un nouveau scénario CLI `scripts/seed-recap/project-deficit-refloat.mjs` qui seede un état exerçant les 4 étages de la cascade `BilanNegativeStep` (piggy → savings → projets → budgets), (b) push prod des 2 migrations Projets-Épargne (sprint 01 `20260601000000_create_savings_projects.sql` + sprint 08 `20260602000000_add_project_snapshot_to_monthly_recaps.sql`) après alignement baseline ↔ prod, (c) update `CLAUDE.md` §11 roadmap pointer Part 31 (1)→(2) + total sprints 136→137, (d) update `.claude/reference/structure-repo.md` avec les nouvelles surfaces Projets, (e) PR ouverte sur `feature/projets-epargne` vers `cleanup`.

  ### Modules livrés (1 nouveau seed + 3 docs)
  - [scripts/seed-recap/project-deficit-refloat.mjs](../../scripts/seed-recap/project-deficit-refloat.mjs) (~110 LOC) — Scénario perso (USER_A). Setup : salaire 1500€ + piggy 100€ + bank 2000€ + 1 budget Courses (estim 200€ / saved 50€) + 1 dépense réelle 900€ sur Courses (déficit 700€) + 2 projets actifs (Japon target 7000€ monthly 200€ saved 1200€ deadline 2027-12-01 ; Voiture target 5000€ monthly 150€ saved 600€ deadline 2027-06-01). Cleanup local manuel de `savings_projects` avant insert (la fonction `cleanupCurrentMonth` de `_lib.mjs` n'a pas été étendue — la table n'existait pas à sa création, et touche tous les scénarios → out-of-scope sprint 11). Math du déficit calibrée pour cover exact = 100 + 50 + 350 + 200 = 700€ (1 cover par étage de la cascade, aucun shortfall, aucun étage saturé). `printPostSeedInstructions` documente la cascade attendue + le SQL post-finalize à vérifier (amount_saved += monthly-refund, pending_delay_fraction shift, project_snapshot_data persisté).
  - [CLAUDE.md](../../CLAUDE.md) §11 — `Part 31 finalize (1)` → `(2)`, total `136 sprints` → `137 sprints`, état global `PÉ 01-10 livrés (push prod sprint 11)` → `PÉ 01-11 livrés (seed PÉ + push prod sprint 11)`. Sous le cap 39.5k (39498 chars).
  - [.claude/reference/structure-repo.md](../reference/structure-repo.md) — ajout des nouvelles surfaces livrées sprints 02-09 qui n'étaient pas encore inventoriées : `components/dashboard/{AddProjectDialog,EditProjectDialog,ProjectListItem}.tsx`, `components/monthly-recap/RefloatProjectsLine.tsx`, `lib/api/finance/projects.ts`, `lib/schemas/projects.ts`, `app/api/finance/projects/{route,[id]/route}.ts`, `scripts/seed-recap/project-deficit-refloat.mjs`. `lib/api/finance/` bumpé `12 modules` → `13 modules`. Le bullet `lib/finance/projects.ts` existait déjà (sprint 02 closeout) ; idem pour `hooks/useProjects.ts` (sprint 05) et `components/monthly-recap/SavingsProjectsDetailDrawer.tsx` (sprint 07).
  - Part 31 cette entrée sprint 11 (vous y êtes).

  ### Push prod

  Push prod gate (workflow [git-workflow.md §7](../conventions/git-workflow.md)) :
  1. `SUPABASE_PROJECT_REF` unset (= défaut prod `jzmppreybwabaeycvasz`).
  2. `pnpm supabase db push --dry-run` → 2 migrations à appliquer (sprint 01 + sprint 08).
  3. STOP + validation user.
  4. `pnpm supabase db push` → applied.
  5. `pnpm db:check-rpcs` ✓ (25) ; `pnpm db:audit-functions` ✓ (34) ; `pnpm db:check-types-fresh` ✓ (types matchent prod post-push).
  6. Re-export baseline `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql` → `pnpm db:check-drift` exit 0.

  ### Décisions de design
  - **Cleanup `savings_projects` inline dans le seed plutôt qu'extension de `cleanupCurrentMonth`** — l'helper de `_lib.mjs` est consommé par 27+ scénarios qui n'utilisent pas les projets, donc l'étendre est out-of-scope sprint 11 (et reste safe car `savings_projects.profile_id ON DELETE CASCADE` quand le profil est supprimé). Le scénario fait son DELETE local idempotent avant INSERT, ce qui suffit pour le re-run.
  - **Pas de `seedRecapRow`** dans le scénario : on laisse le wizard démarrer depuis l'écran "Bienvenue" pour exercer le full flow (start → complete_month → summary → manage_bilan → cascade 4 étages → salary_update → final_recap). Cohérent avec `random-profile.mjs` (qui seed le state mais pas la row recap). Les scénarios `resume-at-*` sont les seuls à pré-seed un step mid-flow.
  - **Math `bilan = -700€` choisie pour cover exact piggy+savings+projets+budgets** : 100 + 50 + 350 + 200 = 700. Chaque étage de la cascade affiche un bouton "Utiliser X€" et passe en done state ; le 4e étage (budgets snapshot) ferme exactement le déficit avant le step `salary_update`. Si on avait choisi un déficit qui satura un étage (>700€) → snapshot shortfall → confusion test. Si on avait choisi <700€ → un étage skipped → ne teste pas tous les écrans.
  - **Deadlines 2027-12 + 2027-06** (12+ mois loin) : laisse de la marge pour que le `monthsBetween(today, deadline)` ne dégénère pas en `"Échéance dépassée"` pendant les semaines suivant le seed. Si tu re-runs le scénario en 2028 → updater les dates inline.
  - **`pending_delay_fraction: 0` explicite** dans les INSERT : la colonne a un `DEFAULT 0` mais le typage TS via `Database['public']['Tables']['savings_projects']['Insert']` exige le field — l'omission donnerait un type error si on importait le type, et même sans, l'expliciter rend l'état initial visible dans le seed (utile au triage si la cascade se comporte mal).

  ### Invariants stables (aucun bump sprint 11)
  - **Routes API : 44 stable** (pas de nouvelle route, juste un seed `.mjs` hors typecheck).
  - **EXPECTED_RPCS : 25 stable** (toutes pinnées depuis sprint 01).
  - **Functions DB versionnées : 34/34 stable**.
  - **Lint baseline : 0 errors / 0 warnings** préservé.
  - **Tests non-gated : 758 stable** (pas de nouveau test ; le seed est dev-only, hors vitest).
  - **Tests gated `SUPABASE_RECAP_TESTS=1` : 90 stable**.
  - **Build Next.js** : 44 routes, 0 régression.
  - **Drift dev/prod résolu post-push** : baseline ↔ prod aligned, `pnpm db:check-drift` exit 0 contre prod.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ (0/0) ; `pnpm test:run` ✓ (758/223) ; `pnpm format:check` ✓ ; `pnpm check:md-size` ✓.
  - `node scripts/seed-recap/project-deficit-refloat.mjs` exit 0 sur dev. Re-lecture DB confirme 2 rows `savings_projects` + 1 row `estimated_budgets` + 1 row `real_expenses` + piggy=100 + salary=1500.
  - Push prod : `pnpm supabase db push` → 2 migrations applied. `pnpm db:check-rpcs` ✓ contre prod (25) ; `pnpm db:check-types-fresh` ✓ ; baseline re-exportée + `pnpm db:check-drift` exit 0.
  - **Smoke browser manuel par le user** (cf. acceptance criteria §11 sprint plan) : création/édition/suppression projet ; recap perso bilan positif (projets affichés sans refloat) ; recap perso bilan négatif via seed `project-deficit-refloat` (cascade complète + finalize → `amount_saved` + `deadline_date` mis à jour côté DB).

  ### Hors scope sprint 11 (= aucun à venir)
  - Aucun. La feature Projets-Épargne est livrée bout-en-bout : DB schema + RPCs + handlers API + hooks + UI (planificateur + modals + drawer + cascade recap) + seeds CLI + push prod + PR.
