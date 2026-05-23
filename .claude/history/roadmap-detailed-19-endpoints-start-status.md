# Roadmap détaillé — Part 19 : Endpoints-START-STATUS-V3 → …

> Chronologie des sprints livrés à partir de 2026-05-25 (suite de [roadmap-detailed-18-modal-enter-block.md](roadmap-detailed-18-modal-enter-block.md)). Split préemptif pour rester sous le cap 39.5k chars/fichier — la Part 18 plafonnait à ~39k post-Calculations-V3, ajouter sprint 05 verbatim aurait franchi la limite.

## Sprints

- ✅ **Sprint Endpoints-START-STATUS-V3** (sprint 05/17 Monthly Recap V3, livré 2026-05-25, commits `7c6572d feat` + `cde85e6 docs`). Première surface réseau du wizard recap — RPC atomique de claim-lock + 2 endpoints + restauration du gating proxy.

  **Constat pré-sprint** : Sprints 01-04 ont posé schéma DB + lib TS pure (state machine, check-status, lock, calculations cents-precise). 0 endpoint réseau. 0 gating proxy (sprint 01 Clean-Slate avait stripé l'ancien recap V1+V2 du proxy). Le but du sprint : poser la première surface réseau (start + status) + helper read-only loadRecapSummary + restaurer un gating proxy ciblé sur les 2 dashboards.

  **Architecture installée** :

  **(1) RPC `start_monthly_recap`** ([supabase/migrations/20260525000000_create_recap_start_rpc.sql](../../supabase/migrations/20260525000000_create_recap_start_rpc.sql), SECURITY DEFINER + SET search_path = public + REVOKE PUBLIC + GRANT service_role + NOTIFY pgrst). Résout en 1 transaction les 4 cas du flow claim :
  - `INSERT INTO monthly_recaps ... ON CONFLICT DO NOTHING RETURNING * INTO v_recap` → si `v_recap.id IS NOT NULL` → result='created'.
  - Sinon `SELECT * INTO v_recap` pour la ligne existante (sur la base des partial unique indexes profile/group + month + year). Si `v_recap.completed_at IS NOT NULL` → 'completed'. Si `started_by_profile_id IS NULL OR = caller` → UPDATE re-claim (`COALESCE(started_at, now())` → idempotent) → 'resumed'. Sinon → 'locked_by_other'.
  - Mutual-exclusivity guard `p_profile_id XOR p_group_id` (RAISE EXCEPTION) — miroir de la contrainte CHECK `monthly_recaps_owner_exclusive_check`.
  - Param ordering required-first (`p_month, p_year, p_started_by_profile_id`) puis defaults (`p_profile_id uuid DEFAULT NULL, p_group_id uuid DEFAULT NULL`). Postgres exige cet ordre quand on mixe avec/sans default ; Supabase codegen marque alors les 2 derniers `?: string` côté TS (cf. trade-off ci-dessous).
  - `DROP FUNCTION IF EXISTS start_monthly_recap(uuid, uuid, smallint, smallint, uuid)` en tête de la migration : idempotence pour les itérations sur le draft (le 1er draft sans DEFAULT NULL utilisait une signature différente — sans le DROP, Postgres aurait conservé les 2 overloads).
  - EXPECTED_RPCS 13 → **14** dans [scripts/check-rpcs.mjs](../../scripts/check-rpcs.mjs).

  **(2) Helper pure read `lib/recap/load-summary.ts`** (115 LOC, 0 écriture) : `loadRecapSummary({ context, profileId, groupId })` async. Promise.all 5 lectures parallèles :
  - `getProfileFinancialData(profileId)` / `getGroupFinancialData(groupId!)` (réutilise lib/finance — fait l'agrégat RAV existant calc-rtl + persistence side-effect).
  - `SELECT id, name, estimated_amount, cumulated_savings FROM estimated_budgets WHERE [owner] = $1` — liste budgets pour le tableau per-budget du summary.
  - `SELECT estimated_budget_id, amount_from_budget FROM real_expenses WHERE [owner] = $1 AND applied_to_balance_at IS NOT NULL AND is_carried_over = false AND expense_date >= [monthStart] AND expense_date < [nextMonthStart]` — spent par budget, **sémantique calendaire validée user** (option AskUserQuestion B : "date de la dépense", pas "date d'application au solde"). Agrégat sur `amount_from_budget` pour exclure les portions piggy/savings (miroir invariant `EditTransactionModal.calculateRealSpentAmount`).
  - `SELECT amount FROM piggy_bank WHERE [owner] = $1 .maybeSingle()` fallback 0 (règle CLAUDE.md "Tables owner-row hybrides" — fresh account sans row → PGRST116 si `.single()`).
  - `SELECT balance FROM bank_balances WHERE [owner] = $1 .maybeSingle()` fallback 0.

  Puis compose `computeRecapSummary` (sprint 04) avec mapping `ravEstime = totalEstimatedIncome - totalEstimatedBudgets` (formule "if everything went as planned") et `ravEffectif = remainingToLive` (calc-rtl actuel). Aggreg spent par budgetId via `Map<string, number>` (cents accum). Pure read.

  **(3) `POST /api/monthly-recap/start/route.ts`** : `withAuthAndProfile` + `parseBody(startRecapBodySchema)` → 400 immédiat si context='group' && !profile.group_id. Calcule month/year via `new Date().getMonth() + 1` / `getFullYear()`. Invoke `supabaseServer.rpc('start_monthly_recap', { p_month, p_year, p_started_by_profile_id: userId, p_profile_id?, p_group_id? })`. Dispatch sur `data.result` :
  - `'locked_by_other'` → 409 `{ error: 'locked_by_other', startedBy: <uuid> }`.
  - `'completed'` → 410 `{ error: 'already_completed', recapId: <uuid> }`.
  - `'created' | 'resumed'` → `loadRecapSummary` + 200 `{ data: { recap, summary } }`.

  Catch : `handleBadRequest(error)` d'abord (400 Zod fail) ; sinon `logger.error` + 500 'Erreur interne' / 500 'Erreur claim lock' (RPC error).

  **(4) `GET /api/monthly-recap/status/route.ts`** : `withAuthAndProfile` + `parseQuery(statusQuerySchema)` (sync). `await checkRecapStatus(userId, context)` (peut throw `RecapStatusError`). Si `status.kind === 'in_progress'` → `loadRecapSummary` + 200 `{ data: { status, summary } }`. Sinon 200 `{ data: { status, summary: null } }` (no_recap / completed / locked_by_other ne portent pas de summary). Catch discriminé : `RecapStatusError.code === 'PROFILE_NOT_FOUND'` → 404 ; `'NO_GROUP'` → 400 ; `BadRequestError` → 400 'Query invalide' ; sinon `logger.error` + 500.

  **(5) Re-wire `proxy.ts`** (94 LOC ajoutées) : import `checkRecapStatus`, `RecapStatusError`, `isRecapBlocking`. Constants :

  ```
  RECAP_GATED_ROUTES = { '/dashboard': 'profile', '/group-dashboard': 'group' }
  RECAP_SPECIAL_ROUTE = '/monthly-recap'
  RECAP_COOKIE_PREFIX = 'recap-ok'
  RECAP_COOKIE_TTL_S = 300
  ```

  2 nouveaux blocs gating (après le isAuthRoute redirect existant) :
  - **Special route /monthly-recap (auth only)** : lit `?context=` (default 'profile' via helper `parseRecapContextQuery`), `checkRecapStatus(userId, queryContext)`, si `status.kind === 'completed'` → redirect /dashboard (block re-entry). Sinon `NextResponse.next()` (la page rend wizard ou lock screen selon kind).
  - **Gated routes /dashboard et /group-dashboard (auth only)** : lookup `gatedContext` via map. **Cookie check first** — `recap-ok-{ctx}-{YYYY}-{MM}` présent → `NextResponse.next()` sans hit DB. Sinon `checkRecapStatus` → si `isRecapBlocking(status)` → `NextResponse.redirect(/monthly-recap?context={ctx})`. Si `status.kind === 'completed'` → set cookie `{ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 300 }` + `NextResponse.next()`.

  `RecapStatusError` catch gracieux pour `NO_GROUP` / `PROFILE_NOT_FOUND` (laisser passer, la page gère). **Scope dashboards-only validé user** (option AskUserQuestion A) — `/profile` et `/dev` restent libres pour permettre fix de compte ou debug avant de fermer le récap.

  **Tests** : 2 fichiers gated `SUPABASE_RECAP_TESTS=1` (mock `withAuthAndProfile` pour injecter userId+profile, le RPC + tables writes hit real Supabase via `SUPABASE_PROJECT_REF=dev`).
  - `app/api/monthly-recap/start/__tests__/route.integration.test.ts` (7 cas) : profile created → ligne créée avec started_by=userId / profile resumed (`started_at` preserved via COALESCE) / profile orphan re-claimed (started_by_profile_id NULL → caller) / group created (group_id set, profile_id null) / group locked_by_other 409 + `{ startedBy: <other> }` / profile completed 410 + `{ recapId }` / context=group sans group_id → 400 'Pas de groupe'.
  - `app/api/monthly-recap/status/__tests__/route.integration.test.ts` (6 cas) : no_recap+summary=null / in_progress+summary populated avec budgets array / completed+summary=null / locked_by_other+startedByName='Bob Bbbb' / NO_GROUP → 400 / missing query → 400 'Query invalide'.

  Tests passants : 424 non-gated **inchangés** (sprint 05 n'ajoute que du gated). 88 → **101** gated skipped (sans env vars). `pnpm verify` exit 0 sur dev (`$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'`).

  **Files livrés (commit 7c6572d feat, 1085 insertions)** :
  - **Nouveaux** (6) : `supabase/migrations/20260525000000_create_recap_start_rpc.sql`, `lib/recap/load-summary.ts`, `app/api/monthly-recap/start/route.ts`, `app/api/monthly-recap/start/__tests__/route.integration.test.ts`, `app/api/monthly-recap/status/route.ts`, `app/api/monthly-recap/status/__tests__/route.integration.test.ts`.
  - **Modifiés** (4) : `proxy.ts` (+94 LOC gating), `scripts/check-rpcs.mjs` (EXPECTED_RPCS 13→14), `lib/recap/index.ts` (+loadRecapSummary re-export), `lib/database.types.ts` (regen post-migration via dev project, +start_monthly_recap signature dans Functions registry).
  - **Commit `cde85e6 docs(claude)` (14 insertions)** : CLAUDE.md §5/§5.5/§9/§11 + structure-repo.md.

  **Trade-off / leçons apprises** :
  - **`DEFAULT NULL` sur params PG → marque TS `?:` via Supabase codegen**. Le 1er draft de la migration était `(p_profile_id uuid, p_group_id uuid, p_month, p_year, p_started_by)` sans defaults. Supabase codegen marquait `p_profile_id: string` (required, pas optional). Avec le pattern `resolveContextIds`-style (passer `undefined` pour le param non-actif côté TS), le type checker refusait. **Fix** : ajouter `DEFAULT NULL` sur les 2 owner params + réordonner (required-first, default-second — Postgres exige cet ordre). Codegen marque alors `p_profile_id?: string` + supabase-js omits undefined keys au JSON payload → PG uses DEFAULT NULL. **Pattern miroir des autres composite RPCs** (`transfer_savings_between_budgets`, `add_expense_with_breakdown`, etc. — tous ont `p_profile_id uuid DEFAULT NULL, p_group_id uuid DEFAULT NULL`). À appliquer pour tout nouveau RPC contextuel.

  - **`DROP IF EXISTS` old signature pour idempotence de migration**. Changer l'ordre des params change la signature PG (`start_monthly_recap(uuid,uuid,smallint,smallint,uuid)` vs `(smallint,smallint,uuid,uuid,uuid)`). Sur ré-application de la migration draft-en-iteration, le `DROP IF EXISTS` sur l'ancien signature évite de laisser 2 overloads orphelins (Postgres treat them as different functions — Supabase Management API qui re-apply le draft retomberait sur la mauvaise overload).

  - **Sémantique calendaire validée user pour `spentThisMonth`**. 2 options évaluées via AskUserQuestion : (a) cash-flow `applied_to_balance_at` month — aligne avec ce que la banque a vu le mois ; (b) calendar `expense_date` month — aligne avec ce qui s'est passé sur le calendrier. User a tranché Option B ("je veux savoir ce que j'ai dépensé en mai"). Filtre installé : `applied_to_balance_at IS NOT NULL AND is_carried_over = false AND expense_date IN [month_start, next_month_start)`. Différence d'avec dashboard : le dashboard utilise le RAV qui agrège tout — pas de notion mensuelle calendaire dans `getProfileFinancialData`. Le recap est le 1er site à filtrer par mois calendaire.

  - **Cookie cache 5min httpOnly validé user**. 2 options évaluées via AskUserQuestion : (a) cache 5min ; (b) check à chaque nav (~5-10ms latence). User a tranché Option A. Pas de stale state risk car un récap `completed` ne se "dé-complète" pas du même mois. Cookie temporel `recap-ok-{ctx}-{YYYY}-{MM}` se rotate au changement de mois (nouveau cookie name → le précédent expire ou devient orphelin sans effet — proxy ne le lit jamais). Cookie httpOnly = lecture serveur seulement, pas exposé au client JS.

  - **Scope proxy dashboards-only validé user**. 2 options évaluées via AskUserQuestion : (a) dashboards uniquement ; (b) tous les protected routes. User a tranché Option A. `/profile` reste libre pour permettre au user de fix son `group_id` avant d'aborder un récap groupe. `/dev` reste libre (dev tools). La spec sprint 09 prévoit `/dev/scenarios` qui devra explicitement bypass — déjà OK avec ce scope.

  - **Mock `withAuthAndProfile` pour tests gated route**. Pattern : `vi.mock('@/lib/api/with-auth', () => ({ withAuthAndProfile: (h) => async (req) => h(req, { userId: mockedAuth.userId, profile: { id, group_id, first_name, last_name } }), withAuth: ... }))`. Le reste hit real Supabase via SUPABASE_PROJECT_REF=dev. Cleanup cascade dans `afterAll` : delete monthly_recaps + groups + profiles.update(group_id: null) + auth.admin.deleteUser. Pattern reproductible pour tous les futurs sprints recap (06/07/08).

  - **Format ISO timestamp dans tests**. `new Date('2026-05-20T10:00:00.000Z').toISOString()` produit `2026-05-20T10:00:00.000Z`. Postgres retourne `2026-05-20T10:00:00+00:00`. Dates équivalentes mais strings différentes (UTC `Z` suffix vs `+00:00` offset). **Comparer via `.getTime()` plutôt que `===` string**. Régression-guardé par le test "started_at preserved" qui aurait failed sur la première run sinon.

  - **`db:types` regen depuis dev via override `--project-id`**. `pnpm db:types` est hardcodé à prod (`jzmppreybwabaeycvasz`). Pour active V3 dev iteration, override : `pnpm supabase gen types typescript --project-id ddehmjucyfgyppfkbddr --schema public > lib/database.types.ts` via **Bash** (PowerShell `>` redirect produit UTF-16 sur Windows 5.1 — fichier illisible). Sur Bash, output propre 961 lignes UTF-8 + LF. Quand prod sera sync'd (db push), `pnpm db:types` regular fonctionnera. La régénération inclut start_monthly_recap dans `Database['public']['Functions']`.

  - **PowerShell stderr redirect dans fichier de types**. `pnpm supabase gen types ... 2>&1 > file.ts` capture stderr dans le fichier. La sortie stderr de Supabase CLI inclut un warning de version update ("A new version of Supabase CLI is available...") + un hint claude-code-plugin. Ces 3 lignes en fin de fichier deviennent du code TS invalide → erreur typecheck. Fix : truncate après la dernière `} as const` via `sed -i '962,$d'`. À long terme, soit re-générer via Bash (pas le souci), soit redirect stderr ailleurs.

  **Pattern à retenir** :
  - **RPC composite avec discriminant `result` string** : `RETURNS json` + `json_build_object('result', '<kind>', '<other_field>', <value>)`. Côté TS, narrow via tagged union : `interface RpcResult { result: 'created'|'resumed'|'completed'|'locked_by_other'; recap: {...} }`. Le caller dispatch sur `result` avant de toucher au reste du payload. Évite les cascades de try/catch pour discriminer les cas.

  - **Cookie cache pour proxy hot-path**. Pour tout check DB nécessaire à chaque nav qui peut être skippé après un état stable, poser un cookie httpOnly maxAge=300s avec key contextuelle (incluant time slice e.g. YYYY-MM). Évite le hit DB sans complexité de redis/edge-cache. Anti-stale : le cookie key includes le time slice, so it rotates naturally avec le passage du temps.

  - **Mock auth wrapper + real Supabase dans tests gated**. Pattern propre pour tester une route handler avec auth-protected logic sans JWT real : mock le wrapper en module-level `vi.mock` qui appelle directement le handler avec un context fabriqué. Le reste (RPC, DB, side-effects) est laissé intact. Test moins fragile qu'un vrai login + cookie flow, et permet d'isoler les cas d'auth (gérés par le wrapper) du business logic.

  - **Param ordering Postgres required-first puis defaults**. Quand un RPC mixe params NOT NULL et DEFAULT NULL, **ordre obligatoire** : required d'abord, defaults ensuite. Sinon `ERROR: input parameters after one with a default value must also have defaults`. Si la signature publique demande l'inverse pour des raisons d'ergonomie d'appel, soit accepter le compromis (les call sites passent moins d'undefined explicites avec defaults en dernier), soit ne pas mixer (tout-NOT-NULL ou tout-DEFAULT). Codegen Supabase reflète l'ordre PG, donc côté TS l'ordre des params dans le JSON payload est libre.

- ✅ **Sprint Endpoints-Positive-Flow-V3** (sprint 06/17 Monthly Recap V3, livré 2026-05-25). 2 endpoints du flow positif 4.A (bilan ≥ 0) + 2 helpers métier + 15 tests gated. Aucune nouvelle RPC PG — réutilisation des composites atomiques existantes `transfer_budget_to_piggy_bank` (sprint 0/C3 / Atomicity-Savings) et `update_budget_cumulated_savings` (sprint 0/C3).

  **Architecture installée** :

  **(1) Helper `lib/recap/active-recap.ts`** (53 LOC) : `getActiveRecap({ context, userId, profile, now? })` → `MonthlyRecapRow | null`. SELECT `*` FROM monthly_recaps filtré sur owner column + month + year + `.is('completed_at', null)` + `.maybeSingle()` (pattern obligatoire "tables owner-row hybrides"). `now` injectable pour tests déterministes. Retourne `null` si pas de row, si `completed_at != null` (filtré), si `context='group'` mais `profile.group_id == null`, ou si SELECT errore (loggé). Type `MonthlyRecapRow` exporté = `Database['public']['Tables']['monthly_recaps']['Row']`. Placé hors d'`actions-positive.ts` car réutilisable cross-sprint (07 négatif, 08 final/complete, 09 snapshot).

  **(2) Helper `lib/recap/actions-positive.ts`** (123 LOC) : 2 fonctions métier qui isolent la boucle fail-soft + l'avancement state machine.
  - `executeTransferSurplusesToPiggy({ context, filter, profileId, groupId, budgetIds })` → `{ outcome: { transferred, failed }, summary }`. Pattern : `loadRecapSummary` AVANT (filtrer cibles), boucle for sur `summary.budgets.filter(b => selected.has(b.budgetId) && b.surplus > 0)`, par budget try `transferBudgetToPiggyBank(filter, { fromBudgetId, amount: surplus })` → push transferred ; catch → push failed + `logger.error`. `loadRecapSummary` APRÈS (le summary frais permet à l'UI d'afficher les surplus restants pour le bouton "Transformer le reste"). 2 calls `loadRecapSummary` acceptable (~100ms chacun). N'avance PAS `current_step` (le user peut chainer avec /transform-remaining ; l'avancement est fait par cet endpoint).
  - `executeTransformRemainingToSavings({ context, recap, profileId, groupId })` → `{ transformed, failed, nextStep: 'salary_update' | null }`. Pattern : `loadRecapSummary`, boucle for sur `surplus > 0`, par budget try `updateBudgetCumulatedSavings(budgetId, surplus)` (delta positif = ajout). UPDATE `monthly_recaps.current_step = 'salary_update'` conditionnel : SI `transformed.length > 0 OR targets.length === 0` (no-op safe avance, full-failure ne avance pas — laisse retry possible). `nextStep` du return = `'salary_update'` ou `null` selon. Si UPDATE échoue, log + `nextStep = null` (degenerate fail-soft).

  Discriminated union `TransformOutcome.nextStep: 'salary_update' | null` permet à l'UI de décider du routing post-action : non-null → navigate to salary screen ; null → display retry button.

  **(3) `POST /api/monthly-recap/transfer-surpluses-to-piggy/route.ts`** (76 LOC) : `withAuthAndProfile` + `parseBody(transferSurplusesBodySchema)` (schema existant sprint 03 : `{ context, budgetIds: array.min(1) }`). 3-level validation pré-exécution : body Zod (400) → `context='group' && !profile.group_id` (400 'Pas de groupe') → `getActiveRecap` null (404 'no_active_recap') → `started_by_profile_id !== userId` (403 'not_initiator') → `current_step ∉ ['summary','manage_bilan']` (409 'invalid_step' + `currentStep` echoed). Filter construit via narrow if/else (TS strict ContextFilter discriminé). Body retourné : `{ data: { transferred, failed, summary } }` (summary fresh post-transferts). 200 peut contenir `failed[]` non-empty (design fail-soft).

  **(4) `POST /api/monthly-recap/transform-remaining-surpluses-to-savings/route.ts`** (66 LOC) : symétrique au précédent mais `parseBody(transformRemainingBodySchema)` (schema nouveau : `{ context }` seul). Body retourné : `{ data: { transformed, failed, nextStep } }`. Pas de summary dans la réponse (l'UI navigue à l'écran suivant via `nextStep`).

  **(5) Schema `transformRemainingBodySchema` ajouté** ([lib/schemas/recap.ts](../../lib/schemas/recap.ts), 5 LOC) : `z.object({ context: contextSchema })`. Inséré entre `transferSurplusesBodySchema` (existant) et `refloatFromPiggyBodySchema` pour préserver l'ordre du flow positif → négatif → snapshot → salaries.

  **Tests** (15 cas gated `SUPABASE_RECAP_TESTS=1`) :
  - `transfer-surpluses-to-piggy/__tests__/route.integration.test.ts` : 9 cas — happy 3 budgets (sum 300€, piggy + 300, all cumulated_savings = 0), partial selection 1/3 (only id1 transferred), budget surplus=0 in budgetIds (filter pré-RPC, no-op), recap completed_at set (404 — getActiveRecap exclut), no recap row (404), group context other initiator (403), current_step='salary_update' (409 + echo), body vide (400 Zod), budgetIds=[] (400 Zod min(1)).
  - `transform-remaining-surpluses-to-savings/__tests__/route.integration.test.ts` : 6 cas — happy 3 surplus (cumulated_savings += surplus chacun, current_step → 'salary_update', nextStep='salary_update'), no remaining surplus (transformed=[], current_step avance quand même, no-op safe), step déjà 'salary_update' (409), no recap (404), other initiator (403), body vide (400 Zod).

  Cleanup cascade dans `afterEach` (pas `afterAll`) pour isolation stricte test-à-test : delete `monthly_recaps` + `real_expenses` + `estimated_budgets` + `piggy_bank` par owner. Fixtures user/group réutilisées (`beforeAll` + `afterAll` final). `seedRecap` / `seedBudget` typés via `Database['public']['Tables']['<table>']['Insert']` + narrow if/else explicit pour les owner keys (cf. CLAUDE.md typescript.md "computed keys dynamic"). Stamp randomisé `Date.now()` pour éviter collisions cross-run.

  **Files livrés (commit feat, ~620 LOC)** :
  - **Nouveaux** (6) : `lib/recap/active-recap.ts`, `lib/recap/actions-positive.ts`, `app/api/monthly-recap/transfer-surpluses-to-piggy/route.ts` + `__tests__/route.integration.test.ts`, `app/api/monthly-recap/transform-remaining-surpluses-to-savings/route.ts` + `__tests__/route.integration.test.ts`.
  - **Modifiés** (1) : `lib/schemas/recap.ts` (+9 LOC `transformRemainingBodySchema` + type).
  - **Aucune migration SQL** — réutilisation pure des RPCs existantes.

  **Trade-off / leçons apprises** :
  - **`transfer_budget_to_piggy_bank` debits `cumulated_savings`, pas `estimated_amount - spent`**. La sémantique de la RPC (sprint 0/C3 / Atomicity-Savings) est `update_budget_cumulated_savings(budgetId, -amount) + UPSERT piggy_bank.amount += amount`. Donc transférer la `surplus` (= `max(0, estimated - spent)`) via cette RPC ne fonctionne que si `cumulated_savings >= surplus` côté DB. Pour le workflow recap V3 c'est OK : on assume que les économies cumulées du budget couvrent au moins le surplus du mois (semantically le surplus appartient au pool savings du budget). Le user-flow réel : le user choisit quels surplus pousser vers piggy (action 1) — les autres restent dans cumulated_savings (action 2 ajoute le surplus à cumulated_savings via delta positif). **Test fixtures DOIVENT seeder `cumulated_savings >= surplus`** sinon la RPC raise et `failed[]` se remplit. C'est régression-guardé par les tests happy path.

  - **Loop fail-soft + 200 with detail (vs 500)**. Choix design (AskUserQuestion clarification) : si un transfert échoue mid-loop, on continue avec les autres et on rapporte les failures dans `failed[]`. 200 OK avec `failed: [{ budgetId, reason }]` non-empty. Permet à l'UI d'afficher partial success + retry seulement les failed. Alternative 500 globale aurait perdu le détail des succès. Alternative abort-on-first-failure aurait laissé du state half-processed sans signal explicite.

  - **`current_step` advance conditionnel sur full-failure**. Le helper `executeTransformRemainingToSavings` n'avance la state machine QUE si `transformed.length > 0 OR targets.length === 0`. Cas spéciaux : (a) `targets=0` → no-op safe, avance quand même (rien à retry) ; (b) `targets>0 && transformed=0 && failed.length>0` → full-failure réel, NE PAS avancer, le user retry. Le `nextStep` du return = `null` dans ce dernier cas → UI affiche retry. Régression-guardé par le test "no remaining surplus" (Cas a, avance malgré transformed=[]).

  - **`MonthlyRecapRow` extrait via `Database['public']['Tables']['monthly_recaps']['Row']`** plutôt que via `lib/recap/types.ts`. Pattern miroir CLAUDE.md typescript.md "Supabase Insert/Update payloads" mais étendu aux Row pour les helpers qui retournent une raw row. Évite de re-déclarer `MonthlyRecapRow` interface (risque de drift avec database.types.ts à chaque regen). Exporté depuis `active-recap.ts` pour que `actions-positive.ts` l'importe sans dépendre directement de `database.types.ts`.

  - **`getActiveRecap` placé hors `actions-positive.ts`** (cf. clarification user) : sprint 07 (refloats négatifs) + sprint 08 (complete/finalize) + sprint 09 (snapshot save) vont tous le réutiliser. La sémantique "récap actif pour le mois courant" est cross-flow, donc `lib/recap/active-recap.ts` dédié plutôt que sprint-specific. Évite le refactor inverse (sprint 07 important `actions-positive` pour un helper non-positif).

  - **Pas de double-click mutex**. La race window entre `loadRecapSummary` et la boucle de transferts (autre device, autre tab) est mitigée par : (a) la RPC `transfer_budget_to_piggy_bank` re-lit `cumulated_savings` en transaction → raise si surplus consommé entretemps → le budget va dans `failed[]` ; (b) côté UI, disabler le bouton pendant la requête (pattern Sprint Modal-Forms-Block-Enter-Submit). Acceptable pour ce flow (le user qui clique 2x rapidement attend juste plus longtemps qu'il y ait 0 surplus à transférer).

  - **Computed keys `[ownerKey]: ownerId` cassent TS strict Insert types**. Premier draft des `seedRecap`/`seedBudget` helpers utilisait `{ [ownerKey]: ownerId, ... }` avec `ownerKey: 'profile_id'|'group_id'`. TS rejette : "string index signatures are incompatible: 'string | number | null' is not assignable to 'never'". Pattern correct (déjà documenté CLAUDE.md typescript.md "computed keys dynamic") : narrow if/else explicit + typer `payload: TablesInsert<'monthly_recaps'>` ; spread base. À appliquer partout dans les test fixtures.

  **Pattern à retenir** :
  - **`getActiveRecap` partagé cross-sprint pour wizard recap stateful endpoints**. Tout endpoint qui mute le state recap pour un mois donné DOIT précéder de `getActiveRecap` + validation `started_by_profile_id === userId` + validation `current_step` whitelist + 4xx précis. Sprint 07/08/09 vont reproduire ce 4-step contract.

  - **Boucle fail-soft over atomic-per-row helpers**. Quand on a N items à muter et que chaque mutation est atomique séparément (RPC unique-tx), la boucle for try/catch + accumulator `failed[]` + 200 avec detail est le pattern propre. Pas besoin d'une wrapper-RPC multi-row (coûteuse à écrire, fragile à la signature). L'idempotence est garantie par les guards in-RPC (re-read row → no-op si rien à faire).

  - **Helper exécution séparé de la route**. Routes deviennent thin (parseBody + 3 validations + délégation). La logique métier (boucles, calculs, UPDATE state) vit dans `lib/recap/actions-*.ts` — testable en pure unit-test si on mocke supabaseServer, et réutilisable cross-routes si besoin. Anti-pattern : tout dans la route → tests gated obligatoires pour couvrir la logique métier.
