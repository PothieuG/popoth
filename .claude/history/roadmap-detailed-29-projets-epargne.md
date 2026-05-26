# Roadmap détaillée — Part 29 : Projets d'épargne (feature 11 sprints)

> Append-only chronologique pour la nouvelle feature majeure **Projets d'épargne** (spec dans [`.claude/plans/00-Readme.md`](../plans/00-Readme.md), plan 11 sprints dans `.claude/plans/01..11-*.md`). Part précédente : [Part 28](roadmap-detailed-28-auto-cascade-piggy.md) (Auto-Cascade-Piggy + Traceability).
>
> Contexte produit : un projet permet de définir un objectif d'épargne sur une durée donnée (ex. "Voyage Japon 7000€ sur 36 mois → 195€/mois"). Le `monthly_allocation` se comporte comme un budget virtuel — il pèse sur le RAV, peut être renfloué pour combler un déficit au recap, et le `amount_saved` cumulé est restitué à la tirelire en cas de suppression.

---

- ✅ **Sprint 01 — Foundation DB** (livré 2026-05-26, commit `97eceee` sur branche `feature/projets-epargne`).

  ### Périmètre

  Foundation DB uniquement : 1 table + 4 RPCs atomiques + RLS + indexes + trigger + 2 policies. 0 handler API, 0 hook, 0 UI, 0 test gated (sprints 02-11 suivants).

  ### Branche base — décision

  Branchée depuis `monthly_recap`, **pas depuis `cleanup`** comme le suggérait le sprint. Raison : `cleanup` n'a pas encore les sprints V3 (`monthly_recaps` créée au sprint 04 V3 sur branche `monthly_recap`), et la nouvelle RPC `apply_recap_projects_snapshot` lit `monthly_recaps.profile_id|group_id`. Brancher depuis `cleanup` aurait empêché la compilation et l'audit local. Note rétroactive : la branche merge devra rebaser `monthly_recap` → `cleanup` avant le merge final feature (sprint 11).

  ### Nouvelle table — [`savings_projects`](../../supabase/migrations/20260601000000_create_savings_projects.sql)

  Migration `20260601000000_create_savings_projects.sql`. Colonnes :

  | Colonne                  | Type          | Notes                                                                                           |
  | ------------------------ | ------------- | ----------------------------------------------------------------------------------------------- |
  | `id`                     | uuid PK       | `gen_random_uuid()`                                                                             |
  | `profile_id`             | uuid FK       | CASCADE delete vers `profiles(id)`, owner-exclusive avec `group_id`                             |
  | `group_id`               | uuid FK       | CASCADE delete vers `groups(id)`                                                                |
  | `name`                   | text          | 2 CHECK : not-empty trim + length ≥ 2                                                           |
  | `target_amount`          | numeric(12,2) | CHECK > 0                                                                                       |
  | `monthly_allocation`     | numeric(12,2) | CHECK > 0                                                                                       |
  | `deadline_date`          | date          | not null                                                                                        |
  | `amount_saved`           | numeric(12,2) | DEFAULT 0, CHECK ≥ 0                                                                            |
  | `pending_delay_fraction` | numeric(6,4)  | DEFAULT 0, CHECK ∈ [0, 1) — carry-over fractionnaire des refloats partiels (cf. RPC apply)      |
  | `created_at`             | timestamptz   | `now()`                                                                                         |
  | `updated_at`             | timestamptz   | `now()` + trigger `update_savings_projects_updated_at` (réutilise `update_updated_at_column()`) |

  **CHECK owner-exclusive** : `((profile_id IS NOT NULL AND group_id IS NULL) OR (profile_id IS NULL AND group_id IS NOT NULL))` — verbatim mirror du pattern `estimated_budgets_owner_exclusive_check`.

  **Indexes partiels par owner** (mirror estimated_budgets) :
  - `idx_savings_projects_profile_id ON (profile_id) WHERE profile_id IS NOT NULL`
  - `idx_savings_projects_group_id ON (group_id) WHERE group_id IS NOT NULL`

  **RLS** : 2 policies `FOR ALL` (mirror `estimated_budgets`, **pas** 4 séparées SELECT/INSERT/UPDATE/DELETE comme suggéré au sprint) :
  - `"Group members can manage group savings projects"` — `(group_id IN (SELECT profiles.group_id WHERE profiles.id = auth.uid()))`
  - `"Users can manage their own savings projects"` — `(profile_id = auth.uid())`

  ### 4 RPCs atomiques

  Conventions : `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role`, `NOTIFY pgrst, 'reload schema'` (1 seule fois à la fin du fichier).
  1. **`create_savings_project(p_name, p_target, p_monthly, p_deadline, p_profile_id, p_group_id) RETURNS json`** — INSERT + RETURNING row + `row_to_json`. Validation owner-exclusive.

  2. **`update_savings_project(p_id, p_name, p_target, p_monthly, p_deadline, p_profile_id, p_group_id) RETURNS json`** — UPDATE atomique (single-statement, pas de `SELECT FOR UPDATE` séparé — UPDATE acquiert lui-même le lock). Ownership check via clause WHERE composée. **Ne touche PAS** `amount_saved` ni `pending_delay_fraction` (mutés exclusivement par les 2 RPCs suivantes).

  3. **`delete_savings_project_to_piggy(p_id, p_profile_id, p_group_id) RETURNS json`** — miroir verbatim de `delete_budget_with_savings_transfer` (20260520120000). Lock + read `amount_saved` → UPSERT vers `piggy_bank` via partial unique indexes inference (`ON CONFLICT (profile_id) WHERE (...)` / `ON CONFLICT (group_id) WHERE (...)`) → DELETE projet. Return `{ transferred_amount, piggy_amount }`. Aucune FK cascade à craindre (pas de table tierce référençant `savings_projects` encore).

  4. **`apply_recap_projects_snapshot(p_recap_id uuid, p_allocations json) RETURNS json`** — sera appelée par `finalize_recap_apply_snapshot` au sprint 10 (pas encore wirée). Sémantique :
     - Résout owner via `SELECT profile_id, group_id FROM monthly_recaps WHERE id = p_recap_id` (RAISE si invalide).
     - Boucle `FOR UPDATE` sur **TOUS les projets de l'owner** (pas seulement les keys de `p_allocations` — décision explicite vs sprint 10 task 2 qui demandait une "migration de correction"). Cela couvre le cas "pas de refloat" où `amount_saved += monthly_allocation` pour chaque projet.
     - Pour chaque projet :
       - `refund := COALESCE(p_allocations->>project_id, 0)` ; validation `refund ∈ [0, monthly_allocation]` (RAISE sinon).
       - `frac_added := refund / monthly_allocation` ∈ [0, 1]
       - `new_pending := pending_delay_fraction + frac_added` ∈ [0, 2)
       - `months_to_shift := FLOOR(new_pending)::integer` (0 ou 1)
       - `UPDATE` : `amount_saved += (monthly_allocation - refund)` ; `pending_delay_fraction = new_pending - months_to_shift` ∈ [0, 1) ; `deadline_date = CASE WHEN months_to_shift >= 1 THEN (deadline + make_interval(months => months_to_shift))::date ELSE deadline_date END`.
     - Return `{ updated_count, total_refunded }`.
     - Cas vérifiés mentalement :
       - `refund = 0` → save complet, pas de shift, fraction inchangée
       - `refund = monthly` → 0 sauvé, +1 mois deadline (frac=1, months_shift=1), fraction préservée
       - `refund = monthly/2` 4 mois consécutifs → mois 4 cumul 2.0 → shift+1, fraction = 0
     - Foreign keys dans `p_allocations` (projets non-owner) silently ignorés par construction (LOOP walk owner-scoped).

  ### Decision matérialisée — `pending_delay_fraction` (sémantique fractionnaire)

  Plutôt que d'arrondir au mois entier le décalage de deadline en cas de refloat partiel (perte d'info + drift cumulatif), on stocke la fraction résiduelle `numeric(6,4)`. 4 décimales suffisent (drift sur 100 mois ≤ 0.1 jour). Le `FLOOR` au moment du UPDATE garantit que la deadline ne shift que quand le cumul franchit un mois entier. CHECK `< 1` empêche tout overflow.

  ### Invariants bumpés
  - `EXPECTED_RPCS` 21 → 25 ([scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs) : entrées ajoutées sous commentaire `// Sprint 01 Projets d'épargne — Foundation DB (2026-06-01)`)
  - Functions DB versionnées 30 → 34 (audit-functions OK)
  - Baseline `20260101000000_remote_schema.sql` re-exporté depuis dev (capture table + RLS + indexes + trigger + constraints) — +75/-7 lignes
  - `lib/database.types.ts` régénéré depuis dev (`Database['public']['Tables']['savings_projects']` présent) — +90/-7 lignes

  ### Validation (toutes contre dev `ddehmjucyfgyppfkbddr`)
  - `pnpm db:check-drift` ✓ (0 drift dev ↔ baseline)
  - `pnpm db:check-rpcs` ✓ (25/25 RPCs pinnées)
  - `pnpm db:audit-functions` ✓ (34/34 versionnées, aucun drift)
  - `pnpm db:check-types-fresh` ✓ (lib/database.types.ts matche live dev)
  - `pnpm typecheck` ✓
  - `pnpm lint:check` ✓ (baseline 0/0 préservée)

  ### Workflow particularités
  - **Pas de `migration repair`** : dev `ddehmjucyfgyppfkbddr` n'a pas de table `supabase_migrations.schema_migrations` (le workflow dev = apply-sql.mjs only). Tentative `pnpm supabase migration repair --status applied --project-ref` a échoué (`--project-ref` pas accepté par `migration repair`, seul `--linked` ou `--db-url`). Conclusion : sur dev, l'application via Management API suffit, pas de tracking à faire.
  - **`pnpm db:types` hardcodé sur prod** (`--project-id jzmppreybwabaeycvasz`). Override via `cmd /c "pnpm exec supabase gen types typescript --project-id ddehmjucyfgyppfkbddr --schema public > lib\database.types.ts"` (cmd plutôt que PowerShell pour éviter l'encoding UTF-16 du `>` PS 5.1).
  - **Prod différée** : push prod programmé au sprint 11 du plan feature (`.claude/plans/11-polishing-seeds-push.md`). Migration vit sur dev seulement jusque-là.

  ### Hors scope sprint 01 (à venir)
  - Sprint 02 : Zod schemas, helpers `lib/finance/projects.ts`, routes API CRUD, hook `useProjects`, tests gated (DB owner-check + atomicité)
  - Sprint 03 : intégration RAV — `monthly_allocation` traité comme budget virtuel dans `_loadFinancialData`
  - Sprint 04 : nouvel onglet "Projet" dans le planificateur, liste avec cercle de progression
  - Sprint 05-06 : modals create/edit/delete (modal confirmation explique le crédit tirelire)
  - Sprint 07 : drawer recap montre les projets actifs
  - Sprint 08 : nouvelle colonne `monthly_recaps.project_snapshot_data` + endpoint `POST /api/monthly-recap/refloat-from-projects`
  - Sprint 09 : ligne UI cascade entre savings et budgets dans BilanNegativeStep
  - Sprint 10 : wirage `apply_recap_projects_snapshot` dans `executeCompleteRecap` + FinalRecapStep section Projets
  - Sprint 11 : seed scenario `project-deficit-refloat.mjs`, push prod, PR

---

- ✅ **Sprint 02 — Backend wiring (schemas + helpers + API + hook)** (livré 2026-05-26, commit `93cdf61` sur branche `feature/projets-epargne`).

  ### Périmètre

  Wirer la table `savings_projects` (sprint 01) à l'app : Zod schemas + factory client, 4 helpers TS atomic, 4 endpoints REST sous `/api/finance/projects`, hook TanStack Query `useProjects`, étendre `invalidateFinancialRefreshes` à 9 keys, 4 tests gated `SUPABASE_FINANCE_TESTS=1`. **0 UI** (sprint 04+), **0 modif RAV** (sprint 03), **0 push prod** (sprint 11).

  ### Modules livrés (5 nouveaux + 3 modifiés)
  - [`lib/schemas/projects.ts`](../../lib/schemas/projects.ts) (108 LOC) — `createProjectBodySchema` / `updateProjectBodySchema` (camelCase : `name`, `targetAmount`, `monthlyAllocation`, `deadlineDate`) + factory client `makeProjectClientSchema(opts)` avec **2 refines** :
    1. **RAV ≥ 0** : `newAllocatedTotal = currentAllocatedTotal − currentProjectAllocation + d.monthlyAllocation ≤ totalEstimatedIncome`. Delta-math idiom miroir `makeBudgetClientSchema` (edit-in-place ne double-compte pas).
    2. **Cohérence durée/target** : `monthlyAllocation × monthsUntilDeadline ≥ targetAmount − amountSaved`. Implicitement enforce deadline future (months ≤ 0 ⇒ refine fail sauf si `amountSaved ≥ targetAmount`).
    - Helper exporté `monthsUntilDeadline(today, deadline) : number` — floor des mois calendaires (les fragments < 1 mois sont droppés car non-actionnables : les allocations sont créditées à la finalisation du recap = 1× par mois).
  - [`lib/finance/projects.ts`](../../lib/finance/projects.ts) (109 LOC) — 4 wrappers atomic, pattern miroir [`piggy-bank.ts`](../../lib/finance/piggy-bank.ts) :
    - `createSavingsProject(filter, args)` → RPC `create_savings_project` → `SavingsProjectRow`
    - `updateSavingsProject(filter, args)` → RPC `update_savings_project` → `SavingsProjectRow` (préserve `amount_saved` + `pending_delay_fraction`)
    - `deleteSavingsProjectToPiggy(filter, projectId)` → RPC `delete_savings_project_to_piggy` → `{ transferred_amount, piggy_amount }`
    - `listSavingsProjects(filter)` → SELECT direct (pas une RPC, ordering `created_at DESC`, scope via `eq('profile_id', ...)` ou `eq('group_id', ...)` selon le filter résolu)
    - **NOT exposé au barrel `lib/finance/index.ts`** — convention C3 : helpers atomic restent en sub-module import direct (`@/lib/finance/projects`), cf. [piggy-bank.ts](../../lib/finance/piggy-bank.ts) précédent.
  - [`lib/api/finance/projects.ts`](../../lib/api/finance/projects.ts) (210 LOC) — 4 handlers via `withAuthAndProfile` :
    - **GET** `/api/finance/projects?group=true|false` → liste perso ou groupe. `estimatedListQuerySchema` (mirror budgets/estimated).
    - **POST** `/api/finance/projects?context=profile|group` → create. Context portéside-querystring miroir POST `/api/finance/budgets`. `parseBody(req, createProjectBodySchema)` + `handleBadRequest`. 400 si `context=group` sans `profile.group_id`. Réponse 201 `{ project }`.
    - **PUT** `/api/finance/projects/[id]` → update. Ownership lookup pre-RPC (SELECT `.or(profile_id.eq.userId,group_id.eq.profile.group_id)`) → 404 si non possédé → résout `filter = asContextFilter({ profile_id, group_id })` depuis la row → call helper. Pattern miroir budgets PUT.
    - **DELETE** `/api/finance/projects/[id]` → delete. Idem PUT pour ownership. Réponse `{ message, transferredAmount, piggyAmount }` (snackbar UI sprint 04+).
    - Path-param `[id]` validé via `uuidSchema.parse(id)` (depuis `routeContext.params` await).
  - [`app/api/finance/projects/route.ts`](../../app/api/finance/projects/route.ts) (1 LOC, re-export GET+POST) + [`app/api/finance/projects/[id]/route.ts`](../../app/api/finance/projects/[id]/route.ts) (1 LOC, re-export PUT+DELETE).
  - [`hooks/useProjects.ts`](../../hooks/useProjects.ts) (200 LOC) — useQuery `['projects', context ?? null]` + 3 mutations `addProject` / `updateProject` / `deleteProject` avec `setQueryData` optimistic + `invalidateFinancialRefreshes(queryClient)` onSuccess. Expose `totalMonthlyAllocations` (sum) pour les UI de marge dispo (sprint 04+). Pattern miroir [`useBudgets.ts`](../../hooks/useBudgets.ts) verbatim (même shape Return, même handling d'erreur via `queryError` last-wins).

  **Modifs** :
  - [`lib/query-client.ts`](../../lib/query-client.ts) — `invalidateFinancialRefreshes` étendu : **8 keys → 9 keys** (`['projects']` ajouté). Le pattern garantit que toute mutation budget/income/expense rafraîchit la liste des projets (la marge dispo change).
  - [`lib/schemas/index.ts`](../../lib/schemas/index.ts) — `export * from './projects'` ajouté.
  - [`lib/__tests__/query-client.test.ts`](../../lib/__tests__/query-client.test.ts) — pin `8 keys` → `9 keys`, ajout `expect(spy).toHaveBeenNthCalledWith(9, { queryKey: ['projects'] })`.

  ### Tests gated (`SUPABASE_FINANCE_TESTS=1`)

  [`lib/finance/__tests__/projects.test.ts`](../../lib/finance/__tests__/projects.test.ts) (235 LOC) — 4 cas, miroir `delete-budget-with-savings-transfer.test.ts` pour le pattern beforeAll/afterAll FK-safe :
  1. **create → list** : `createSavingsProject` retourne la row complète avec defaults (`amount_saved=0`, `pending_delay_fraction=0`) ; `listSavingsProjects` retrouve la row par id.
  2. **update** : `updateSavingsProject` change name/target/monthly/deadline mais **préserve `amount_saved` + `pending_delay_fraction`** (seedés en pré-test via direct UPDATE bypassant la RPC). Pin de l'invariant "ne touche pas ces 2 colonnes" du sprint 01.
  3. **delete → piggy crédité** : seed `amount_saved=50` + piggy initial `10` → `deleteSavingsProjectToPiggy` renvoie `{ transferred_amount: 50, piggy_amount: 60 }` ; SELECT piggy_bank confirme `60` ; project absent de la list.
  4. **ownership cross-user → forbidden** : 2 users A et B. A crée un projet. B tente `updateSavingsProject({ profile_id: B }, { id: A_project, ... })` puis `deleteSavingsProjectToPiggy({ profile_id: B }, A_project)` → **les 2 RAISE** `"not found or not owned by the given context"`. Le projet A reste intact.

  Cleanup : `afterAll` supprime `savings_projects` + `piggy_bank` + auth users par user. FK CASCADE depuis `profiles` couvre les autres orphelins.

  ### Invariants bumpés
  - **Routes API** : 41 → 43 (+2 : `/api/finance/projects` GET+POST = 1 route, `/api/finance/projects/[id]` PUT+DELETE = 1 route — Next.js compte par path).
  - **Tests gated skipped** (sans env vars) : 203 → 207 (+4).
  - **Tests non-gated passants** : 672 maintenu (le test query-client mis à jour reste 1 test).
  - **`invalidateFinancialRefreshes` keys** : 8 → 9 (`['projects']` 9e key).
  - **EXPECTED_RPCS** : 25 inchangé (helpers consomment les 4 RPCs existantes du sprint 01).
  - **Functions DB versionnées** : 34/34 inchangé.

  ### Validation (toutes contre dev `ddehmjucyfgyppfkbddr`)
  - `pnpm typecheck` ✓
  - `pnpm lint:check` ✓ (baseline 0/0 préservée)
  - `pnpm test:run` ✓ (672 passants + 207 skipped)
  - `pnpm vitest run lib/finance/__tests__/projects.test.ts` avec `SUPABASE_FINANCE_TESTS=1` ✓ (4/4 nouveaux, 3.9s)
  - `pnpm verify` ✓ (typecheck + format + tests + 6 db:\* checks fail-fast, ~40s)
  - `pnpm build` ✓ (43 routes inventoriées, 0 warning)

  ### Décisions de design
  - **Route file structure** : malgré le wording du plan (`parseQuery(req, deleteByIdQuerySchema)` pour DELETE), j'ai choisi le **path-param `[id]`** (pas le `?id=` querystring) pour PUT et DELETE. Justification : (a) le plan localise les routes sous `app/api/finance/projects/[id]/route.ts` — c'est le pattern Next.js canonique de path-param ; (b) RESTful idiomatique ; (c) miroir `app/api/groups/[id]/route.ts` existant. La validation du path-param se fait via `uuidSchema.parse(id)` (extraction depuis `routeContext.params`). Le wording du plan reste utile comme convention pour le `deleteByIdQuerySchema` primitive (qui n'est pas utilisée ici).
  - **Test path** : placé sous `lib/finance/__tests__/projects.test.ts` (à côté du code testé) plutôt que `lib/api/finance/__tests__/projects-rpc.test.ts` (suggéré au plan). Justification : les tests appellent les **helpers** (`lib/finance/projects.ts`), pas les handlers — la convention du repo est de co-localiser les tests avec le module sous test (cf. `delete-budget-with-savings-transfer.test.ts`, `financial-data.test.ts`). Vitest auto-discover par `**/*.test.ts` donc le path n'affecte pas la découverte.
  - **`listSavingsProjects` SELECT direct (pas RPC)** : aucune mutation sensible → un SELECT à travers le service-role client (RLS-bypass) suffit. Pas besoin d'ajouter une 5e RPC. Le scoping owner est garanti par le `eq()` côté TS.
  - **Body camelCase** : matche les autres `createBudgetBodySchema` v1 — le handler mappe vers snake_case avant l'appel RPC. (Note : `createEstimatedBudgetBodySchema` est en snake_case car le handler écrit verbatim dans la table, pattern v2 hors-scope ici.)
  - **`monthsUntilDeadline` arrondi floor** : un demi-mois résiduel ne peut pas accueillir une allocation mensuelle (créditée à la finalize du recap = 1× par mois calendaire). Le floor évite la sur-estimation de la capacité d'épargne dans le refine de cohérence.

  ### Workflow particularités
  - **Pré-existant non-lié laissé tel quel** : `.claude/history/roadmap-detailed-{24,27}-*.md`, `.claude/plans/{01,02,03}-*.md` (formatting prettier), `components/monthly-recap/{CompleteMonthStep,...}.{tsx,test.tsx}`, `scripts/seed-recap/random-profile.mjs`, `scripts/start-recap.mjs` (untracked) sont des modifs antérieures à ce sprint et restent dans le working tree (non-stagées). Commit sprint 02 strictement focused sur ses 10 fichiers.
  - **Drift baseline ↔ prod attendu** : `pnpm verify` sans `$env:SUPABASE_PROJECT_REF=dev` rouge sur `db:check-drift` car la migration sprint 01 vit sur dev seulement. Toujours préfixer `$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'` pour les commandes db:\* sur cette branche jusqu'au push prod (sprint 11).
  - **Hook size-policy 39 500** : le PostToolUse hook a bloqué 4× pendant la rédaction de cette closeout — leçon : pour les additions denses dans `operational-rules.md` / `structure-repo.md` (déjà en zone d'alerte 38-39.5k), écrire ultra-compact dès le 1er draft pour éviter le ping-pong trim/retest.

  ### Hors scope sprint 02 (à venir)
  - Sprint 03 : intégration RAV — `monthly_allocation` agrégé dans `totalEstimatedBudgets` côté `_loadFinancialData` (perso + groupe), pas de nouveau terme dans la formule canonique RAV. Réutilise `calculateRemainingToLiveProfile/Group` tel quel.
  - Sprint 04+ : UI (onglet "Projet" + cercle de progression + modals + drawer recap + cascade Bilan négatif), puis wiring `apply_recap_projects_snapshot` au sprint 10, puis push prod + PR au sprint 11.
