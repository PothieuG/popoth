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

---

- ✅ **Sprint 03 — Intégration RAV** (livré 2026-05-26, commit `39ab19b` sur branche `feature/projets-epargne`).

  ### Périmètre

  Wirer le `monthly_allocation` des projets dans l'orchestrateur `_loadFinancialData` côté perso ET groupe, de sorte que le RAV diminue de la somme des allocations. Le projet se comporte comme un budget virtuel : `totalEstimatedBudgets = sum(estimated_budgets.estimated_amount) + sum(savings_projects.monthly_allocation)`. **Pas** de nouveau terme dans la formule canonique RAV — la signature et le contenu de `calculateRemainingToLiveProfile/Group` restent intacts (le projet entre par le terme `estimatedBudgets`). Métadonnées présentationnelles exposées via `FinancialData.meta` pour l'UI (sprints 04, 07).

  ### Modules livrés (1 nouveau + 5 modifiés)
  - [`lib/finance/projects-meta.ts`](../../lib/finance/projects-meta.ts) (88 LOC) — 3 helpers purs (pas d'I/O, pas de logger) :
    - `monthsBetween(from: Date, to: string): number` — mois calendaires entiers entre date courante locale et ISO `YYYY-MM-DD`. Floor (sémantique miroir `apply_recap_projects_snapshot` : 1 allocation/mois calendaire → fractions tail droppées). Retourne 0 si deadline passée OU `to` invalide.
    - `buildSavingsProjectMeta(row, today?)` — maps snake_case → `SavingsProjectMeta` camelCase. `today` injectable pour tests, défaut `new Date()`. `monthsRemaining` dérivé via `monthsBetween`.
    - `computeDeadlineFromDuration(durationMonths, from?)` — ISO `YYYY-MM-DD` de la deadline N mois après `from`. **Clamp end-of-month** : Jan 31 + 1 mois → Feb 28 (pas Mar 3 via overflow JS). Sera consommé par la modal create sprint 05 (déduction deadline à partir d'une durée saisie). UTC throughout pour TZ-stability.

  **Modifs** :
  - [`lib/finance/types.ts`](../../lib/finance/types.ts) — Ajout `SavingsProjectMeta` interface + extension `FinancialData.meta` : `totalMonthlyProjects: number` + `savingsProjects: SavingsProjectMeta[]` (toujours présents quand `meta` l'est, valeurs par défaut 0/[]). Comment sur `totalEstimatedBudgets` mis à jour pour refléter la sémantique "budgets + projets".
  - [`lib/finance/financial-data.ts`](../../lib/finance/financial-data.ts) — Étape 3.bis ajoutée (SELECT `savings_projects` sur `owner` + agrégation `monthly_allocation`). `totalEstimatedBudgets` recoit `+ totalMonthlyProjects`. Construction `savingsProjectsMeta[]` via `buildSavingsProjectMeta`. Meta retournée inclut désormais `totalMonthlyProjects` + `savingsProjects` (perso + groupe). Fallback catch idem.
  - [`lib/finance/constants.ts`](../../lib/finance/constants.ts) — `EMPTY_FINANCIAL_DATA.meta` étendue (`totalMonthlyProjects: 0, savingsProjects: []`).
  - [`lib/api/finance/summary.ts`](../../lib/api/finance/summary.ts) — Fallback 200 (erreur calc → UI-safe zeros) étendu avec les 2 mêmes clés.
  - [`lib/finance/__tests__/financial-data.test.ts`](../../lib/finance/__tests__/financial-data.test.ts) — 3 goldens existants (GOLDEN_PROFILE, GOLDEN_GROUP, PROFILE_EMPTY_SHAPE/GROUP_EMPTY_SHAPE case 5) étendus avec `totalMonthlyProjects: 0, savingsProjects: []` pour matcher le nouveau shape (sinon `toEqual` casse).

  ### Tests livrés
  - [`lib/finance/__tests__/projects-meta.test.ts`](../../lib/finance/__tests__/projects-meta.test.ts) (8 cas non-gated) :
    - `monthsBetween` × 4 : mois exact (3), fractionnaire (2 floor), passé (0), cross-year (5).
    - `computeDeadlineFromDuration` × 3 : first-of-month (1→1), end-of-month clamp (Jan 31 + 1 mois → Feb 28), cross-year (Nov 15 + 6 → May 15).
    - `buildSavingsProjectMeta` × 1 : maps snake → camel + injectable `today`.
  - [`lib/finance/__tests__/financial-data-with-projects.test.ts`](../../lib/finance/__tests__/financial-data-with-projects.test.ts) (4 cas gated `SUPABASE_FINANCE_TESTS=1`) :
    1. **profile + 2 projects 100€** : baseline RAV → INSERT 2 projets → `totalEstimatedBudgets` += 200, `remainingToLive` -= 200, `meta.totalMonthlyProjects` = 200, `meta.savingsProjects.length` = 2.
    2. **group + 1 project 50€** : idem côté groupe (fixture single-member 2000€, trigger contribution).
    3. **projet supprimé** : INSERT puis DELETE → `totalMonthlyProjects` retombe à 0, `savingsProjects = []`, RAV remonte de la valeur exacte.
    4. **aucun projet** : invariant `meta.savingsProjects = []` + `totalMonthlyProjects = 0`.

  Pattern miroir `financial-data.test.ts` : dynamic import dans `beforeAll` (skip clean sans env vars), fixtures FK-safe `afterAll` (DELETE `savings_projects` + `group_contributions` + `profiles.update group_id=null` + DELETE groups + deleteUser).

  ### Décisions de design
  - **`totalEstimatedBudgets` agrège budgets + projets** (vs nouveau terme dans la formule RAV) : décision validée par le plan ("traité comme un budget classique"). Avantages : (a) signature `calculateRemainingToLiveProfile/Group` inchangée → 0 cascade dans les 5 sites consumers (api/finance/summary, recap calc, etc.) ; (b) le refine `makeBudgetClientSchema` du sprint 02 reçoit automatiquement le nouveau total via `useFinancialData().totalEstimatedBudgets` (cf. "Hors scope" du plan) ; (c) sémantique "marge dispo = revenus - tout ce qui est engagé mensuellement" naturelle.
  - **`meta.totalMonthlyProjects` exposé séparément** (en plus de l'agrégat) : les UI qui veulent **distinguer** budgets et projets (drawer recap sprint 07, onglet planificateur sprint 04) peuvent extraire la part projets sans recalculer côté client. Coût mémoire négligeable, gain de clarté significatif.
  - **`meta.savingsProjects[]` toujours présent** (vs conditional spread comme `groupSalaryTotal`) : `groupSalaryTotal` est sémantiquement absent en perso (pas applicable), donc spread conditionnel. `savingsProjects` est applicable aux 2 contextes, juste vide quand 0 projet — donc requis quand `meta` l'est, avec `[]` par défaut. Plus prévisible pour les consumers TS (pas besoin de `?? []`).
  - **`monthsBetween` vs `monthsUntilDeadline` existant** (`lib/schemas/projects.ts`) : 2 signatures coexistent. `monthsUntilDeadline(today: Date, deadline: Date)` consommé par `makeProjectClientSchema` refine 2 (form input, 2 Dates locales). `monthsBetween(from: Date, to: string)` consommé par `buildSavingsProjectMeta` (orchestrateur lit la colonne `date` ISO). Même règle floor, pas de duplication sémantique — c'est juste l'adaptation au format d'input. Refactor partagé hors-scope ici (low value, low risk de drift).
  - **`computeDeadlineFromDuration` UTC throughout** : helper qui produit un ISO `YYYY-MM-DD` doit être TZ-stable. Lecture `getUTCFullYear/Month/Date`, build `Date.UTC(...)`, `toISOString().split('T')[0]`. Cost : un caller browser CET à 23h passant `new Date()` peut être off-by-1 jour (UTC est déjà le lendemain) — acceptable pour un défaut de modal (l'utilisateur re-pick dans le datepicker).
  - **Clamp end-of-month vs overflow JS** : `new Date(2026, 1, 31)` wrap à Mar 3. Pour un "deadline 1 mois après le 31 janvier", l'utilisateur attend Feb 28. Le clamp explicite (`Math.min(baseDay, lastDayOfTargetMonth)`) est plus prévisible que de documenter l'overflow.

  ### Bug pré-existant détecté (NON causé par sprint 03)

  Pendant le run gated SUPABASE_FINANCE_TESTS=1, **2 tests existants** de `financial-data.test.ts` échouent : **case 1 (profile golden math)** et **case 6 (saveRavToDatabase persist)**. Diff observé : `totalRealExpenses` 230 → 830 (+600), `remainingToLive` 1970 → 1370 (-600). Vérifié par stash : les MÊMES 2 tests échouent SANS mes changements. Origine : le trigger `sync_contribution_real_expense` (Feature Contribution-au-groupe 2026-05-28) injecte une row `real_expenses` `is_exceptional=true, estimated_budget_id=null, amount=600` sur le profile au moment du link `profiles.group_id = testGroupId` (= contribution snapshot du single-member group). Cette row n'était pas modélisée dans la golden math du test au moment de son écriture (Sprint Refactor-I4 follow-up + Sprint 16 V3) et le test n'a probablement pas été re-roulé depuis l'arrivée du trigger.

  **Décision** : NE PAS fixer dans ce sprint (hors scope strict). Tracker pour un sprint dédié "Fix-Golden-Math-Contribution-Cascade" qui ajustera GOLDEN_PROFILE.remainingToLive de 1970 → 1370 (et exceptionalExpenses 80 → 680, totalRealExpenses 230 → 830) + ajoutera un cas test couvrant la cascade trigger → profile.exceptional. Les tests qui passent (case 2 GOLDEN_GROUP, case 3 no-data, case 4 no-data, case 5 empty UUIDs, sprint 16 readonly, sprint 15 carry-over) NE sont PAS affectés car ils ne lient pas le profile testUserId au group avant le calcul perso, OU bien le groupe est leur cible primaire.

  ### Invariants bumpés
  - **Tests non-gated passants** : 672 → 680 (+8 cas `projects-meta.test.ts`).
  - **Tests gated skipped** (sans env vars) : 207 → 211 (+4 cas `financial-data-with-projects.test.ts`).
  - **Routes API** : 43 inchangé (aucune route ajoutée — pure intégration interne).
  - **EXPECTED_RPCS** : 25 inchangé.
  - **Functions DB versionnées** : 34/34 inchangé.
  - **Lint baseline** : 0/0 préservée.

  ### Validation (toutes contre dev `ddehmjucyfgyppfkbddr`)
  - `pnpm typecheck` ✓
  - `pnpm vitest run lib/finance/__tests__/projects-meta.test.ts` ✓ (8/8, 190ms)
  - `SUPABASE_FINANCE_TESTS=1 pnpm vitest run lib/finance/__tests__/financial-data-with-projects.test.ts` ✓ (4/4, 6.86s)
  - `pnpm test:run` ✓ (680 passed | 211 skipped)
  - `pnpm lint:check` ✓ (0/0)
  - `SUPABASE_PROJECT_REF=ddehmjucyfgyppfkbddr pnpm verify` ✓ (10/10 gates, typecheck + format:check + test:run + check:md-size + 6 db:\*)

  ### Workflow particularités
  - **Stash investigation** : pour confirmer que les 2 régressions GOLDEN_PROFILE étaient pré-existantes (et non causées par sprint 03), `git stash push` des fichiers tracked → `SUPABASE_FINANCE_TESTS=1 pnpm vitest run lib/finance/__tests__/financial-data.test.ts` → mêmes 2 échecs → `git stash pop`. Pattern utile à mémoriser pour disambiguer regression de pré-existant.
  - **Pré-existant non-lié laissé tel quel** : idem sprint 02 — `.claude/history/roadmap-detailed-{24,27}-*.md`, `.claude/plans/{01,02}-*.md` (formatting prettier), `components/monthly-recap/{CompleteMonthStep,...}.{tsx,test.tsx}`, `scripts/seed-recap/random-profile.mjs`, `scripts/start-recap.mjs` (untracked) sont des modifs antérieures. Commit sprint 03 strictement focused sur ses 8 fichiers tracked.

  ### Hors scope sprint 03 (à venir)
  - Sprint 04 : nouvel onglet "Projet" dans le planificateur, liste avec cercle de progression — consume `useFinancialData().meta.savingsProjects` directement (pas de nouveau fetch).
  - Sprint 05-06 : modals create/edit/delete — utilisent `computeDeadlineFromDuration` pour pré-remplir le champ deadline à partir d'une durée user.
  - Sprint 07 : drawer recap — affiche les projets actifs avec progression, alimenté par `meta.savingsProjects`.
  - Sprint 08-10 : refloat dans Bilan négatif + wiring `apply_recap_projects_snapshot` au sprint 10.
  - Sprint 11 : seeds + push prod + PR.

---

- ✅ **Sprint 04 — UI 3ème onglet "Projets" dans PlanningDrawer** (livré 2026-05-26, commit `5255fa5` sur branche `feature/projets-epargne`).

  ### Périmètre

  3ème onglet "Projets" (violet) au `PlanningDrawer` : liste avec cercle de progression SVG, nom, deadline fr-FR, mois restants, `amount_saved / target_amount`. Modifier/Supprimer câblés à `logger.info` stubs (modals sprint 05, confirmation suppression sprint 06). **0 modif backend / RAV / push prod**.

  ### Modules livrés (1 nouveau + 4 modifiés)
  - [`components/dashboard/ProjectListItem.tsx`](../../components/dashboard/ProjectListItem.tsx) (161 LOC) — cercle SVG 44 px (anneau purple-100 + arc purple-600 clampé 0–100, `% atteint` aria-label). À droite : nom truncate, échéance fr-FR + mois restants, `amount_saved` (purple-700) `/ target_amount` (gray-500) 0 décimales. DropdownMenu Modifier/Supprimer (icônes verbatim mirror Budget row).
  - [`components/dashboard/PlanningDrawer.tsx`](../../components/dashboard/PlanningDrawer.tsx) — `TabType` étendu `'projets'`, 3ème bouton tab (purple-700, icône sparkles), wire `useProjects(context)` + `refreshProjects` dans `useEffect(isOpen)`, bloc erreur fusionné, tab content (header + total mensuel discret purple-50/50 + empty state + liste `data-testid="projects-list"`), 3 handlers stubs `handle{Add,Edit,Delete}ProjectStub` → `logger.info`.
  - [`lib/finance/projects-meta.ts`](../../lib/finance/projects-meta.ts) — `formatDeadline(iso)` → `JJ/MM/AAAA` (parse `T00:00:00Z` UTC pour éviter TZ drift, fallback string brute si parse fail) + `formatMonthsRemaining(n)` → "N mois restants" / "1 mois restant" / "Échéance dépassée".
  - [`components/__tests__/a11y-audit.test.tsx`](../../components/__tests__/a11y-audit.test.tsx) — mock `@tanstack/react-query` étendu avec `useMutation` + `useQueryClient` (PlanningDrawer pull maintenant `useProjects` indirect).

  ### Tests livrés (15 cas non-gated)
  - [`ProjectListItem.test.tsx`](../../components/dashboard/__tests__/ProjectListItem.test.tsx) (6 cas) : happy render (nom + 58% + deadline `01/05/2029` + montants), Modifier→onEdit, Supprimer→onDelete, over-funded clampé 100% visuel + ratio préservé, "Échéance dépassée" past, 0% guard `target_amount=0`.
  - [`PlanningDrawer.test.tsx`](../../components/dashboard/__tests__/PlanningDrawer.test.tsx) (3 cas projets) : empty state, list render + total mensuel, Esc focus-trap regression-guard.
  - [`projects-meta.test.ts`](../../lib/finance/__tests__/projects-meta.test.ts) (6 cas helpers) : `formatDeadline` happy + zero-pad + fallback ; `formatMonthsRemaining` pluriel/singulier/overdue.

  ### Décisions de design
  - **Stubs `logger.info` (vs `alert()`)** : `no-console` lint refuse `console.log` direct ; `alert()` invasif PWA mobile + casse focus-trap Radix ; `logger.info` gated via `LOG_LEVEL` env donc invisible prod.
  - **Cercle SVG inline (vs réutilisation `BudgetProgressIndicator`)** : Budget indicator est barre horizontale, pas de pattern circulaire existant → inline 40 LOC, 2 `<circle>` (track + arc) avec `transition-[stroke-dashoffset]`. Réévaluer extraction si 2e usage émerge.
  - **Violet** : palette "économies/cumulated_savings" — pas vert (revenus) ni orange (budgets). Sémantique "épargne dédiée à un objectif" proche tirelire.
  - **Montant 0 décimales** (`4 084 €` vs `4 084,00 €`) : miroir `lib/contribution-calculator.ts::formatCurrency` (dashboard/contribution) vs `lib/format-currency.ts::formatEuro` (recap où le centime compte). Précision absolue exposée dans modal sprint 05.
  - **Pas de `vi.useFakeTimers()`** dans ProjectListItem test : userEvent dépend de timers réels (sinon timeout 5s sur click→pointerdown→pointerup). Assertion "X mois restants" déléguée à `projects-meta.test.ts` (unit).
  - **`useQueryClient` mock partial** : pattern existant mockait juste `useQuery`. Étendre le mock partial (ajouter exports manquants) plus simple qu'un partial-import `vi.mock(import('@tanstack/react-query'), async (importOriginal) => ...)` qui demanderait un `QueryClientProvider` wrapper.

  ### Invariants bumpés
  - **Tests non-gated passants** : 680 → 695 (+15 : 6 ProjectListItem + 3 PlanningDrawer projets + 6 projects-meta helpers).
  - Lint baseline 0/0 préservée. Tests gated, routes API, EXPECTED_RPCS, fn DB versionnées inchangés.

  ### Validation
  - `pnpm typecheck` ✓ ; `pnpm lint:check` ✓ ; `pnpm test:run` ✓ (695/211 skipped, ~11s) ; `pnpm format:check` ✓ sur les 7 fichiers touchés.
  - Vérif visuelle DevTools mobile **non effectuée côté CLI** — à valider par le user en `pnpm dev` avant push prod sprint 11.

  ### Hors scope sprint 04 (à venir)
  - Sprint 05 : modal `AddProjectDialog` / `EditProjectDialog` — 2 modes saisie (total OU mensuel), `makeProjectClientSchema` refines RAV ≥ 0 + cohérence durée/target, `computeDeadlineFromDuration` pré-remplit deadline.
  - Sprint 06 : modal confirmation suppression (message crédit tirelire via `delete_savings_project_to_piggy`).
  - Sprints 07-11 : drawer recap, refloat backend/UI, finalize wiring, seeds + push prod + PR.

> **Suite — sprints 05+ dans [Part 30](roadmap-detailed-30-projets-epargne-modals.md)** (split préemptif 2026-05-26, Part 29 saturée à 37k+ avant sprint 05 closeout).
