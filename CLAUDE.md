# CLAUDE.md — Popoth

> Guide à charger en début de chaque session Claude Code sur ce repo. Garde-le à jour si une convention change.

## 1. Projet

**Popoth** : PWA francophone de gestion financière personnelle et en groupe. Domaines clés : budgets estimés, dépenses réelles, économies cumulées, tirelire commune, récap mensuel, transferts inter-budgets.

Prod hébergée sur Supabase (`jzmppreybwabaeycvasz`). Audit complet 2026-04 dans [docs/audit/](docs/audit/) (score 47/100 avant Sprint 0, ~51 après Sprint 0, ~58 après Sprint DB, ~62-65 après Sprint Refactor, ~70 après Sprint Hardening, ~73 après Sprint Polish). Carte du schéma post-Sprint Polish dans [docs/db/SCHEMA.md](docs/db/SCHEMA.md) (inclut désormais l'inventaire complet des triggers prod).

## 2. Stack

- **Next.js 16.1.6** App Router, Turbopack en build, **webpack en dev** (`pnpm dev` → `next dev --webpack`)
- **React 19.1.1**
- **TypeScript 5** strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` (imports type-only obligatoires)
- **Tailwind 3** + **shadcn/ui** (variant new-york)
- **Supabase** (`@supabase/supabase-js@^2.57.4`) — PostgreSQL + Auth
- **pnpm 9.15.5** (verrouillé via `packageManager`), Node ≥ 20
- **Vitest 4.1.5** pour les tests unitaires (Sprint 0 — environnement `node`)
- **eslint-config-next 15.0.0** (incompatible Next 16, ne pas upgrader avant Sprint 1)

## 3. Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | Serveur dev Next.js (webpack) |
| `pnpm build` | Build prod (Turbopack) |
| `pnpm start` | Serveur prod |
| `pnpm typecheck` | `tsc --noEmit` (BLOQUANT — `ignoreBuildErrors` retiré en C1) |
| `pnpm lint:check` | ESLint sans `--fix` |
| `pnpm lint` | ESLint avec `--fix` |
| `pnpm test` | Vitest watch |
| `pnpm test:run` | Vitest single run (CI) |
| `pnpm db:types` | Régénère `lib/database.types.ts` depuis le schéma prod (Sprint DB / D6) |
| `pnpm db:check-drift` | Compare prod ↔ baseline `20260101000000_remote_schema.sql`. Exit 0 = clean, 1 = drift (Sprint Refactor / R4) |
| `pnpm db:check-rpcs` | Vérifie via `pg_proc` que les 4 RPC C3 (`update_piggy_bank_amount`, `update_bank_balance`, `update_budget_cumulated_savings`, `transfer_from_piggy_to_budget`) existent en prod. Exit 0 = présentes, 1 = manquantes (Sprint Hardening / H4) |
| `pnpm db:check-functions` | Vérifie la présence des 4 fonctions trigger custom A2 (liste hardcodée). Exit 0 = présentes, 1 = manquantes (Sprint Audit-Triggers / A3) |
| `pnpm db:audit-functions` | **Audit générique** : liste TOUTES les `public.*` fonctions de `pg_proc`, vérifie que chacune est versionnée dans `supabase/migrations/`. Exit 0 = toutes versionnées, 1 = au moins une orpheline (Sprint Audit-Functions-v2 / B1). À lancer après chaque migration touchant une fonction PL/pgSQL. |
| `pnpm supabase ...` | Supabase CLI (lié à `jzmppreybwabaeycvasz`) |
| `node scripts/export-schema.mjs <out.sql>` | Snapshot du schéma prod via API Management (sans Docker) |
| `node scripts/apply-sql.mjs <file.sql>` | Applique un fichier SQL (write OU read-only SELECT) via API Management |
| `node scripts/apply-sql.mjs scripts/list-triggers.sql` | Inventaire trigger prod (Sprint Polish T5). Output JSON UTF-16 sur stdout — rediriger via `> file.json` puis lire (PowerShell encode en UTF-16 LE par défaut) |

Tests gated (env var requise pour s'exécuter, sinon `describe.skipIf` skippe) :
- `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` — couverture RPC concurrence (D9)
- `SUPABASE_RLS_TESTS=1 pnpm test:run` — isolation cross-user RLS (D4)
- `SUPABASE_API_TESTS=1 pnpm test:run` — régressions H1/H2/R2 (Sprint Polish T3) sur dashboard aggregates, expenses progress, available cash
- `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` — comportement des 4 fonctions trigger A2 (Sprint Audit-Functions-v2 / B2) — auto-create contributions sur JOIN, recalc sur UPDATE budget, cleanup sur DELETE group, touch `updated_at`

## 4. Structure du repo

```
app/                       # App Router (pages + API routes)
  api/
    debug/                 # 6 routes seed/reset (post Sprint Polish T2) — BLOQUÉES en prod via blockInProduction()
    finances/              # routes principales (dashboard, expenses, income)
    monthly-recap/         # workflow récap mensuel (process-step1 = god route, ne pas refactor)
    savings/transfer/      # transferts budget↔budget et budget↔tirelire
components/                # UI (shadcn/ui sous components/ui/)
contexts/AuthContext.tsx   # contexte auth client
hooks/                     # 18 hooks React (useFinancialData, useGroups, useProfile, ...)
lib/
  supabase-server.ts       # client serveur (service_role) — BYPASS RLS
  supabase-client.ts       # client browser (anon key) — soumis à RLS
  database.types.ts        # types Supabase générés (pnpm db:types) — Sprint DB D6
  database.ts              # augmente Database avec les 4 RPC C3 (service-role-only)
  session.ts               # JWT (jose) pour cookie session
  session-server.ts        # validateSessionToken() — utilisé dans toutes les routes API
  debug-guard.ts           # blockInProduction() pour /api/debug/*
  expense-allocation.ts    # calculateBreakdown + applyAllocation (lecture, RPC à l'écriture)
  financial-calculations.ts # GOD FILE 1075 LOC — chantier I4, ne pas refactorer
  financial-logger.ts      # logger custom (LogContext)
  database-snapshot.ts     # createFullDatabaseSnapshot — utilise SnapshotPayloadV2 (Sprint Polish T4)
  recap-snapshot.types.ts  # ✅ SnapshotPayload v1/v2 discriminated union + isSnapshotV2() (Sprint Polish T4)
  finance/                 # ✅ HELPERS RPC ATOMIQUES (Sprint 0 C3)
    context.ts             # ContextFilter type discriminé { profile_id } | { group_id } + asContextFilter()
    piggy-bank.ts          # updatePiggyBank, transferFromPiggyToBudget
    bank-balance.ts        # updateBankBalance
    budget-savings.ts      # updateBudgetCumulatedSavings
    __tests__/             # Sprint DB
      rpc-concurrency.test.ts  # gated SUPABASE_RPC_CONCURRENCY_TESTS=1
      rls-isolation.test.ts    # gated SUPABASE_RLS_TESTS=1
  __tests__/               # ✅ Sprint Polish T3
    api-regressions.test.ts  # gated SUPABASE_API_TESTS=1 — H1/H2/R2 regressions
scripts/                   # Sprint DB outils API Management (sans Docker)
  export-schema.mjs        # snapshot prod schema → SQL baseline (⚠️ filtre trigger buggy, cf. Sprint Audit-Triggers v6)
  apply-sql.mjs            # applique un .sql via API Management (drift recovery, ou SELECT lecture seule)
  check-drift.mjs          # backend de pnpm db:check-drift
  check-rpcs.mjs           # backend de pnpm db:check-rpcs
  list-triggers.sql        # ✅ Sprint Polish T5 — SELECT pg_trigger pour inventaire
supabase/
  config.toml              # CLI config (lié au projet distant)
  migrations/              # ✅ baseline + RLS + perf + dedup (Sprint DB) + dedup R3 + recursive policy R6 + overdraft H3
    20260101000000_remote_schema.sql           # baseline hand-curated (D5) — ⚠️ -- (no user triggers) due to filter bug v6
    20260506000000_create_finance_rpcs.sql     # 4 RPC C3 — NE PAS MODIFIER
    20260507000000_enable_rls_piggy_bank.sql   # D1
    20260507000001_fix_group_contributions_policy.sql  # D2
    20260507000002_fix_remaining_to_live_insert.sql    # D3
    20260508000000_add_piggy_bank_indexes.sql  # D7
    20260508000001_add_piggy_bank_constraints.sql  # D8
    20260509000000_dedupe_profiles_policies.sql    # D10
    20260510000000_dedupe_indexes_constraints.sql  # R3
    20260510000001_drop_recursive_profiles_policy.sql  # R6 — fix infinite-recursion sur profiles SELECT
    20260511000000_align_bank_balance_overdraft.sql    # H3 — RAISE EXCEPTION dans update_bank_balance
docs/audit/                # Audit complet codebase 2026-04
  00-executive-summary.md  # vue d'ensemble + score
  06-action-plan.md        # plan multi-sprint
  RLS-FINDINGS.md          # snapshot RLS pré-Sprint DB (les 3 failles sont closes)
  POST-MORTEM-C3-DRIFT.md  # post-mortem du drift schema_migrations ↔ pg_proc (R0)
  07-deep-dive-*.md        # playbooks par chantier
docs/db/                   # ✅ Sprint DB / D11 + inventaire triggers Sprint Polish T5
  SCHEMA.md                # carte des tables, RPC, indexes, FK, hot path, triggers (post T5)
prompts/                   # prompts Claude Code par chantier
  prompt-00-executive-summary.md     # Sprint 0 (livré)
  prompt-00-executive-summary-v2.md  # Sprint DB (livré)
  prompt-00-executive-summary-v3.md  # Sprint Refactor (livré)
  prompt-00-executive-summary-v4.md  # Sprint Hardening (livré)
  prompt-00-executive-summary-v5.md  # Sprint Polish (livré 2026-05-07)
  prompt-00-executive-summary-v6.md  # Sprint Audit-Triggers (à exécuter)
```

## 5. Architecture critique

- **2 clients Supabase** :
  - `supabase-server.ts` (service_role, bypass RLS) — utilisé par TOUTES les routes API. Les failles RLS ne s'exploitent PAS depuis ce client.
  - `supabase-client.ts` (anon key, soumis à RLS) — utilisé côté browser via les hooks. **C'est par ici que les failles RLS sont exploitables** (cf. RLS-FINDINGS.md).
- **Workflow recap mensuel** : `app/api/monthly-recap/{initialize,step1-data,process-step1,step2-data,balance,auto-balance,accumulate-piggy-bank,transfer,recover,refresh,resume,update-step,complete}/route.ts`. Le cœur algorithmique est dans `process-step1/route.ts` (>700 LOC) — **ne pas extraire** (chantier I5 séparé).
- **Allocation des dépenses** : ordre de priorité tirelire → économies budget → budget restant, codé dans [lib/expense-allocation.ts:calculateBreakdown](lib/expense-allocation.ts). L'écriture passe **toujours** par les helpers `lib/finance/*` (RPC atomiques).
- **Auth** : JWT custom signé via `jose` (pas Supabase Auth direct). Cookie `session` validé par `validateSessionToken(request)` dans chaque route API.
- **Globals partagés** dans `app/api/monthly-recap/complete/route.ts` (`global.carryoverUpdates`, etc.) — déclarés via `declare global` au top du fichier. Ne pas étendre ce pattern aux autres routes.

## 6. Conventions

### API
- Format réponse : **`{ data: T } | { error: string }`** sur toutes les routes.
- Statut auth invalide : `401` + `{ error: 'Session invalide' }`.
- Statut debug-route en prod : `404` (pas 403, pour ne pas révéler l'existence).
- Pattern obligatoire dans une route :
  ```ts
  export async function POST(request: NextRequest) {
    const blocked = blockInProduction()       // SI route /api/debug/*
    if (blocked) return blocked
    try {
      const sessionData = await validateSessionToken(request)
      if (!sessionData?.userId) return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
      // ...
    } catch (error) {
      console.error('...', error)
      return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
    }
  }
  ```

### TypeScript
- `verbatimModuleSyntax` actif → **`import type` obligatoire** pour les types.
- `noUncheckedIndexedAccess` actif → `arr[i]` est `T | undefined`. Toujours narrow avant d'utiliser.
- Erreurs catch : `error: unknown` par défaut → narrow via `error instanceof Error ? error.message : String(error)`.
- Préférer `as unknown as T` plutôt que `as any` lorsqu'un cast est inévitable.
- **Aucun nouveau `any`** dans le code Sprint 0+. Les ~57 `: any` existants sont à nettoyer progressivement (Sprint Polish T4 a retiré 2 dans recover/database-snapshot via `SnapshotPayload`).
- Pour les blobs JSONB côté DB (`Json` dans `lib/database.types.ts`) : définir un type discriminé applicatif et caster `as unknown as Json` au seul boundary insert. Pattern : [lib/recap-snapshot.types.ts](lib/recap-snapshot.types.ts).
- Compteur `as unknown as SupabaseClient` à 2 (les 2 god files I4/I5). **Ne pas en ajouter** — débugger le typage à la place. Sprint Polish T2 a vérifié qu'aucune autre route n'en a besoin.

### Naming
- DB : **snake_case** (`profile_id`, `cumulated_savings`, `bank_balances`).
- TS : **camelCase** (`profileId`, `cumulatedSavings`, `bankBalances`).
- Migrations Supabase : `<YYYYMMDDHHMMSS>_<verb>_<scope>.sql`.

### Git
- Branches feature depuis `main`. Branche actuelle : `cleanup` (Sprint 0).
- **Conventional Commits** : `fix:`, `feat:`, `chore:`, `docs:`, `perf:`, `test:`. Préfixer le scope quand pertinent : `fix(api/debug)`, `chore(supabase)`.
- **Un commit par item** dans les sprints multi-items (cf. Sprint 0 : 5 commits + 1 follow-up).
- **Toujours créer un nouveau commit**, jamais `--amend` un commit publié.
- **JAMAIS** `--no-verify`, `--no-gpg-sign`, ou `git push --force` sans demande explicite.

## 7. Sécurité — état des lieux

### ✅ Fait (Sprint 0)
- `typescript.ignoreBuildErrors` retiré (C1).
- Routes `/api/debug/*` (×20) bloquées en prod via `blockInProduction()` (C2).
- Pattern SELECT-then-UPDATE remplacé par 4 RPC atomiques sur `piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings` (C3, 14 sites migrés).
- Audit RLS exécuté + documenté (C4).
- README UTF-8 (C5).

### ✅ Fait (Sprint DB — livré 2026-05-07)
- D1 — RLS activée sur `piggy_bank` + policies owner-or-group-member.
- D2 — `group_contributions` policy ouverte remplacée par membre-de-groupe.
- D3 — `remaining_to_live_snapshots.INSERT` restreint à `service_role`.
- D4 — Tests d'isolation RLS gated (`SUPABASE_RLS_TESTS=1`).
- D5 — Schéma prod versionné en baseline backdaté (`20260101000000_remote_schema.sql`) via API Management (Docker absent).
- D6 — `lib/database.types.ts` généré + augmenté dans `lib/database.ts` avec les 4 RPC C3 service-role-only. Wirage `<Database>` aux clients livré au Sprint Refactor / R2.
- D7 — `piggy_bank` indexé (2 partial unique indexes par owner).
- D8 — `piggy_bank` contraint (amount ≥ 0, owner XOR).
- D9 — Tests concurrence RPC (4/4 verts, 100× parallèles convergent).
- D10 — Policy SELECT redondante sur `profiles` supprimée.
- D11 — [docs/db/SCHEMA.md](docs/db/SCHEMA.md) ajouté.

### ✅ Fait (Sprint Refactor — livré 2026-05-07)
- R0 — post-mortem du drift C3 documenté ([docs/audit/POST-MORTEM-C3-DRIFT.md](docs/audit/POST-MORTEM-C3-DRIFT.md)).
- R1 — 11 routes `app/api/debug/populate-*` cassées supprimées (~2 800 LOC).
- R2 — `createClient<Database>(...)` activé sur `lib/supabase-server.ts` + `lib/supabase-client.ts` + fixtures Vitest. **17 routes scope-cast** `as unknown as SupabaseClient` (dette H1 Sprint Hardening). Bug réel corrigé : `current_savings` → `cumulated_savings` dans `app/api/finances/expenses/progress/route.ts`.
- R3 — Migration `20260510000000_dedupe_indexes_constraints.sql` : 6 indexes, 1 FK, 3 CHECKs dupliqués droppés + le CHECK NULL-hole `budget_transfers_different_budgets`. Le baseline a aussi rattrapé D7/D8 (piggy_bank constraints/indexes) et D10 (policy profiles) qui n'avaient jamais été ré-exportés.
- R4 — `pnpm db:check-drift` ([scripts/check-drift.mjs](scripts/check-drift.mjs)) — compare prod ↔ baseline, exit 0 = clean, 1 = drift.
- R6 — Tests RLS D2 (group_contributions cross-membre) + D3 (remaining_to_live_snapshots INSERT rejet authenticated) implémentés. **Bug critique découvert** : la SELECT policy `Group members can see each other` sur `profiles` se référençait elle-même → `42P17 infinite recursion` sur toute lecture anon traversant `profiles`. Corrigé via `20260510000001_drop_recursive_profiles_policy.sql`.

### ✅ Fait (Sprint Hardening — livré 2026-05-07)
- H4 — `pnpm db:check-rpcs` ([scripts/check-rpcs.mjs](scripts/check-rpcs.mjs)) : vérifie via `pg_proc` la présence des 4 RPC C3 en prod. Comble le trou que `db:check-drift` ne couvre pas (les RPCs sont volontairement exclues du baseline).
- H2 — Retrait des reads sur `financial_snapshots`, table fantôme jamais créée (absente du schéma prod, absente du baseline, jamais dans l'historique git). Erreurs silencieusement avalées dans `lib/database-snapshot.ts` et `app/api/finances/dashboard/route.ts`. Le dashboard retournait toujours 0 pour `total_real_income` et `total_real_expenses` à cause de fallbacks morts sur cette table.
- H1 — Unwind des 17 scope-casts `as unknown as SupabaseClient` héritage de R2. **3 commits** : 6 singletons (bank-balance, budgets, incomes, groups/{search,contributions,[id]/members}), 3 aggregators (groups, profile, finances/dashboard), 7 routes recap. Compteur final : 5 occurrences (les 4 god/debug + R0 cleanup). **2 bugs réels corrigés** : (a) `calculate_available_cash` était une RPC fantôme dans dashboard (le résultat retombait toujours sur 0 avec `|| 0`), remplacée par `remainingToLiveData.availableBalance`. (b) `resume/route.ts` passait `profile.group_id` au lieu de `contextId` à `getGroupFinancialData`.
- H3 — Migration `20260511000000_align_bank_balance_overdraft.sql` : aligne `update_bank_balance` sur `update_piggy_bank_amount` en levant une exception explicite si `new_balance < 0` au lieu de laisser la CHECK constraint répondre. Test gated `bank_balances_balance_check` ajouté à `rpc-concurrency.test.ts`. **À appliquer manuellement** via `node scripts/apply-sql.mjs supabase/migrations/20260511000000_align_bank_balance_overdraft.sql` puis re-exporter le baseline.

### ✅ Fait (Sprint Polish — livré 2026-05-07)
- T2 — 3 debug routes (`quick-test`, `recap-data`, `test-balance`) supprimées (-1224 LOC). Compteur `as unknown as SupabaseClient` 5 → 2 (les 2 god files restants).
- T1 — `total_real_income` / `total_real_expenses` ne sont plus hardcodés à 0 dans [app/api/finances/dashboard/route.ts](app/api/finances/dashboard/route.ts). Branchés sur `remainingToLiveData.totalReal*` qui était déjà calculé par `getProfileFinancialData()` / `getGroupFinancialData()` mais ignoré.
- T4 — [lib/recap-snapshot.types.ts](lib/recap-snapshot.types.ts) : `SnapshotPayload = SnapshotPayloadV1 | SnapshotPayloadV2` discriminé sur `snapshot_version`, prédicat `isSnapshotV2()`. recover/route.ts ne caste plus `as any`. database-snapshot.ts caste `as unknown as Json` au seul boundary insert.
- T3 — [lib/__tests__/api-regressions.test.ts](lib/__tests__/api-regressions.test.ts) : 3 tests gated `SUPABASE_API_TESTS=1` couvrant les régressions H1/H2/R2 (cumulated_savings, total_real_*, availableBalance). Pattern dynamic-import + cleanup cascade calé sur `rpc-concurrency.test.ts`.
- T5 — [scripts/list-triggers.sql](scripts/list-triggers.sql) + section "Inventory" dans [docs/db/SCHEMA.md](docs/db/SCHEMA.md). **2 trouvailles** documentées non-fixées (Sprint Audit-Triggers v6) : (a) le filtre `LIKE 'public.%'` du baseline exporter ne matche jamais → 6 triggers `public.*` invisibles dans le baseline ; (b) 3 fonctions trigger non-versionnées en prod (`trigger_group_budget_change`, `cleanup_group_contributions`, `trigger_recalculate_contributions`).

### ✅ Fait (Sprint Audit-Triggers — livré 2026-05-07)
- A1 — Fix du filtre trigger dans [scripts/export-schema.mjs](scripts/export-schema.mjs) : JOIN explicite `pg_class`+`pg_namespace` (le `tgrelid::regclass::text LIKE 'public.%'` précédent ne matchait jamais quand `public` est dans le `search_path`). Baseline ré-exporté contient désormais les 6 `CREATE TRIGGER` `public.*`. `pnpm db:check-drift` détecte maintenant la suppression d'un trigger.
- A2 — Migration [20260512000000_capture_trigger_functions.sql](supabase/migrations/20260512000000_capture_trigger_functions.sql) : capture verbatim de **5 fonctions PL/pgSQL** non-versionnées (`update_updated_at_column`, `calculate_group_contributions`, `trigger_group_budget_change`, `cleanup_group_contributions`, `trigger_recalculate_contributions`). `calculate_group_contributions` (~80 LOC, core métier) découverte en cours de route via `PERFORM` depuis 2 des 3 triggers — capturée pour ne pas laisser un trou caché. Migration appliquée via `apply-sql.mjs` (idempotent `CREATE OR REPLACE`) + `supabase migration repair --status applied 20260512000000`. Pas de `db push` (les fonctions existent déjà en prod). Helper [scripts/dump-functions.sql](scripts/dump-functions.sql) committé pour audits futurs.
- A3 — `pnpm db:check-functions` ([scripts/check-trigger-functions.mjs](scripts/check-trigger-functions.mjs)) : pendant `db:check-rpcs` pour les 4 fonctions custom (exclut `update_updated_at_column` canonique pour éviter false positives). Comble le trou que `db:check-drift` ne couvre pas (le baseline ne capture pas les bodies de fonction).
- A4 — [.github/workflows/db-drift-check.yml](.github/workflows/db-drift-check.yml) étendu : `db:check-drift` + `db:check-rpcs` + `db:check-functions` weekly cron + on-demand.

### ⚠️ Drift C3 résolu
Le drift `supabase_migrations.schema_migrations` ↔ `pg_proc` (les 4 RPC C3 marquées appliquées sans exécution du SQL) est documenté dans [docs/audit/POST-MORTEM-C3-DRIFT.md](docs/audit/POST-MORTEM-C3-DRIFT.md). Le filet aujourd'hui :
- `pnpm db:check-drift` pour le drift table/colonne/policy/index.
- `pnpm db:check-rpcs` pour la présence des 4 RPC C3 dans `pg_proc` (livré Sprint Hardening / H4).
- `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` pour vérifier que les RPC fonctionnent réellement sous concurrence (gated).

Voir [docs/audit/RLS-FINDINGS.md](docs/audit/RLS-FINDINGS.md) (état pré-Sprint DB), [prompts/prompt-00-executive-summary-v5.md](prompts/prompt-00-executive-summary-v5.md) (Sprint Polish — livré), et [prompts/prompt-00-executive-summary-v6.md](prompts/prompt-00-executive-summary-v6.md) (Sprint Audit-Triggers — livré).

## 8. À FAIRE / À NE PAS FAIRE

### ✅ À faire
- Pour toute écriture sur `piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings` : **utiliser obligatoirement** les helpers `lib/finance/*`. Pas de SELECT-then-UPDATE direct.
- Pour toute nouvelle route `/api/debug/*` : importer + appeler `blockInProduction()` en première instruction.
- Pour tout consommateur de `recap_snapshots.snapshot_data` : utiliser les types [lib/recap-snapshot.types.ts](lib/recap-snapshot.types.ts) (`SnapshotPayload` + `isSnapshotV2()`). Pas de `as any`.
- Lire `RLS-FINDINGS.md` + [docs/db/SCHEMA.md](docs/db/SCHEMA.md) avant d'ajouter une nouvelle table, une nouvelle policy, ou un nouveau trigger.
- Lancer `pnpm typecheck && pnpm test:run` après chaque modif significative.
- Pour les requêtes hors de l'app (audit, migration, debug schéma) : préférer l'API Management `POST /v1/projects/{ref}/database/query` (sans Docker) plutôt que `psql` ou `db pull`. `scripts/export-schema.mjs` et `scripts/apply-sql.mjs` exposent ce pattern.
- Pour toute nouvelle RPC : `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` + `SET search_path = public`. **Suivre la migration de** `NOTIFY pgrst, 'reload schema';` pour forcer le rafraîchissement du cache PostgREST (sinon `.rpc()` lève "Could not find the function in the schema cache" — leçon Sprint DB).
- Pour toute nouvelle fonction trigger ou modification d'une existante : versionner dans une migration dédiée (pattern : [supabase/migrations/20260512000000_capture_trigger_functions.sql](supabase/migrations/20260512000000_capture_trigger_functions.sql), `CREATE OR REPLACE FUNCTION`). Le baseline n'inclut PAS les bodies de fonction — c'est volontaire (pattern C3) et `pnpm db:check-functions` tient le filet. Ajouter le nom de la nouvelle fonction à `EXPECTED_FUNCTIONS` dans [scripts/check-trigger-functions.mjs](scripts/check-trigger-functions.mjs) si elle est custom (pas Supabase canonique).
- **Après toute migration touchant une fonction PL/pgSQL** (création, modification, suppression) : lancer `pnpm db:audit-functions` (Sprint Audit-Functions-v2 / B1). C'est l'audit générique qui liste TOUTES les `public.*` fonctions de `pg_proc` et confirme que chacune a un `CREATE FUNCTION` quelque part dans `supabase/migrations/`. Catches le cas A2 redux : une fonction load-bearing en prod sans trace dans le repo. **Pas dans le cron weekly** (plus lourd que `db:check-functions`) — à la main après chaque migration touchant une fonction.
- **Pour capturer rétroactivement une fonction PL/pgSQL qui existe déjà en prod** (cas Sprint Audit-Triggers / A2) : workflow strict, **NE PAS** faire `supabase db push` (collision sur la fonction existante). Pattern :
  1. Dump le body via [scripts/dump-functions.sql](scripts/dump-functions.sql) (étendre la liste si besoin) → `node scripts/apply-sql.mjs scripts/dump-functions.sql > tmp\\functions.json`.
  2. Coller le `def` (déjà sous forme `CREATE OR REPLACE FUNCTION` en PG 14+, vérifier) dans une migration `<TS>_capture_*.sql`. Préserver verbatim (LANGUAGE, SECURITY, SET search_path) — ne PAS ajouter `REVOKE/GRANT` boilerplate sur des fonctions trigger-only.
  3. `node scripts/apply-sql.mjs supabase/migrations/<TS>_capture_*.sql` (idempotent grâce à `CREATE OR REPLACE`).
  4. `pnpm supabase migration repair --status applied <TS>` (sinon prochain `db push` retentera = drift C3 redux).
  5. `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql` puis `pnpm db:check-drift` → exit 0.
- Push gate prod : `pnpm supabase db push --dry-run` → STOP confirmation utilisateur → `db push` → re-audit Management API → commit.
- Régénérer les types après changement de schéma : `pnpm db:types` (puis ajuster `lib/database.ts` si nouvelles RPC service-role-only).
- Après chaque migration non-triviale : lancer `pnpm db:check-drift`. Si exit 1, re-exporter le baseline via `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql` et committer (sinon le détecteur reste rouge et on retombe dans la trap C3).

### ❌ À ne pas faire
- ❌ **Ne pas refactorer** [lib/financial-calculations.ts](lib/financial-calculations.ts) (chantier I4 séparé).
- ❌ **Ne pas refactorer** l'algo `process-step1` (chantier I5 séparé) — uniquement remplacer les paires SELECT-then-UPDATE par RPC.
- ❌ **Ne pas modifier** [supabase/migrations/20260506000000_create_finance_rpcs.sql](supabase/migrations/20260506000000_create_finance_rpcs.sql). Pour corriger une RPC : `CREATE OR REPLACE` dans une nouvelle migration.
- ❌ **Pas de `any`** dans le nouveau code. Préférer type guards.
- ❌ **Pas de console.log** ajouté (1331 existants à nettoyer dans un futur chantier).
- ❌ **Ne pas mocker la DB** dans les tests d'intégration — utiliser Supabase local ou staging.
- ❌ **Ne pas commiter** de secret. `supabase/.gitignore` exclut `.temp/` et `.env.local`.
- ❌ **Ne pas upgrader** `eslint-config-next` 15→16 maintenant (Sprint 1 séparé).
- ❌ **Ne pas réactiver** `typescript.ignoreBuildErrors`.
- ❌ **Ne pas écrire** de docs `.md` sans demande explicite (sauf RLS-FINDINGS, CLAUDE.md, prompts/ qui sont demandés).

## 9. Tests

- Framework : **Vitest** (`vitest.config.ts` à la racine, env `node`, alias `@/` → racine, charge `.env.local` automatiquement via parser inline depuis Sprint DB).
- Convention : tests à côté du code, suffixe `.test.ts`. Exemples : `lib/debug-guard.test.ts`, `lib/finance/__tests__/rpc-concurrency.test.ts`.
- Pour tester `process.env` : `vi.stubEnv('NODE_ENV', 'production')` + `vi.unstubAllEnvs()` (NODE_ENV est readonly avec les types Next).
- Tests d'intégration DB (Sprint DB / D9) : `lib/finance/__tests__/rpc-concurrency.test.ts` couvre 4 scénarios — 100×updatePiggyBank, drainage à zéro, transferFromPiggyToBudget, alternance ±1. Gated `SUPABASE_RPC_CONCURRENCY_TESTS=1`.
- Tests régression API (Sprint Polish / T3) : `lib/__tests__/api-regressions.test.ts` couvre 3 bugs surfacés en H1/H2/R2 (cumulated_savings round-trip, total_real_*, availableBalance). Gated `SUPABASE_API_TESTS=1`.
- Tests comportement trigger (Sprint Audit-Functions-v2 / B2) : [lib/__tests__/trigger-behavior.test.ts](lib/__tests__/trigger-behavior.test.ts) couvre les 4 fonctions trigger custom A2 — `trigger_recalculate_contributions` (auto-create on JOIN), `trigger_group_budget_change` (recalc on UPDATE), `cleanup_group_contributions` (cascade DELETE), `update_updated_at_column` (touch). Gated `SUPABASE_TRIGGER_TESTS=1`. Catches le cas où une `CREATE OR REPLACE FUNCTION ... AS 'BEGIN RETURN NEW; END;'` accidentelle ferait passer `db:check-functions` au vert tout en cassant la chaîne trigger → fonction → INSERT.
- **Pattern import dynamique pour gated tests** : si un test importe `lib/finance/*` ou `lib/financial-calculations.ts` (qui transitivement charge `lib/supabase-server.ts` créant un client à l'eval du module), faire l'`await import('@/lib/...')` à l'intérieur de `beforeAll` pour que le module ne se charge PAS quand le suite est skipped sans env vars. Pattern visible dans `rpc-concurrency.test.ts` et `api-regressions.test.ts`.
- **chunked(...)** helper dans `rpc-concurrency.test.ts` : batch les appels parallèles en groupes de 10 pour rester sous le pool undici default per-origin de Node fetch.
- **Cleanup en cascade obligatoire** dans `afterAll` : tables FK → profiles sans `ON DELETE CASCADE` doivent être nettoyées explicitement avant `auth.admin.deleteUser`. Pattern dans `api-regressions.test.ts:afterAll`. Sans ça, prod accumule des comptes test orphelins.

## 10. Variables d'environnement

`.env.local` (gitignored) doit contenir :
```
NEXT_PUBLIC_SUPABASE_URL=https://jzmppreybwabaeycvasz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<...>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>     # utilisé par lib/supabase-server.ts
JWT_SECRET_KEY=<...>                 # utilisé par lib/session.ts
```

Pour les opérations CLI Supabase qui requièrent l'access token + DB password :
```
SUPABASE_ACCESS_TOKEN=sbp_...        # https://supabase.com/dashboard/account/tokens
SUPABASE_DB_PASSWORD=...             # Project Settings > Database > Reset password si oublié
```
Ces deux derniers sont à passer en variables inline (`SUPABASE_ACCESS_TOKEN=... pnpm supabase ...`) ou persistés au niveau User env (`[Environment]::SetEnvironmentVariable(...)`), **jamais** committés dans un fichier.

> 🚨 **Règle absolue (sécurité)** : Claude **ne doit JAMAIS lire la valeur** de `SUPABASE_ACCESS_TOKEN` ni `SUPABASE_DB_PASSWORD` (ni de tout autre secret du `.env.local`).
>
> - ❌ **Interdit** : `Write-Output $env:SUPABASE_ACCESS_TOKEN`, `echo $env:SUPABASE_DB_PASSWORD`, `Get-Content .env.local`, ou toute commande qui rend la valeur visible dans le transcript.
> - ✅ **Autorisé** : test de présence binaire (`if ($env:SUPABASE_ACCESS_TOKEN) { "OK" } else { "MISSING" }`) — ne révèle pas la valeur.
> - ✅ **Autorisé** : laisser les scripts (`apply-sql.mjs`, `export-schema.mjs`, `check-rpcs.mjs`) lire `process.env.SUPABASE_ACCESS_TOKEN` en interne — la valeur ne transite pas par stdout/stderr.
> - **Si une commande échoue avec "TOKEN_MISSING"** : demander à l'utilisateur de le set lui-même via `[Environment]::SetEnvironmentVariable(...)` puis redémarrer Claude Code. **Ne jamais** lui demander de coller le secret dans le chat.

## 11. Roadmap (à jour 2026-05-07)

- ✅ **Sprint 0** (`cleanup` branch) : C1–C5 + follow-up RLS audit (livré)
- ✅ **Sprint DB** ([prompt-00-executive-summary-v2.md](prompts/prompt-00-executive-summary-v2.md)) : D1–D11 livré 2026-05-07, 5 commits (`39e56f8 → 55d1606`), score ~58/100
- ✅ **Sprint Refactor** ([prompt-00-executive-summary-v3.md](prompts/prompt-00-executive-summary-v3.md)) : R0 post-mortem + R1 routes debug + R2 wirage `<Database>` (avec scope-cast à dérouler en H1) + R3 dedup schéma + R4 drift detection + R6 tests RLS D2/D3 + drop policy récursive profiles. R5 (overdraft) reporté en H3. Livré 2026-05-07, 6 commits (`5efacfe → ab58db2`), score estimé ~62-65/100
- ✅ **Sprint Hardening** ([prompt-00-executive-summary-v4.md](prompts/prompt-00-executive-summary-v4.md)) : H1 unwind 17 scope-casts (5 restants tous god/debug) + H2 ghost table `financial_snapshots` + H3 overdraft `bank_balances` (RAISE EXCEPTION dans la RPC) + H4 `pnpm db:check-rpcs` + H5 GH Actions cron drift + H6 trigger forensics. **3 bugs réels surfacés et fixés** : `current_savings`/`cumulated_savings` (R2), RPC fantôme `calculate_available_cash` dans dashboard, `total_real_income`/`total_real_expenses` qui retombent toujours sur 0 (T1 Sprint Polish corrigera ce dernier). Livré 2026-05-07, 9 commits (`858b243 → 5d65922`), score estimé ~70/100
- ✅ **Sprint Polish** ([prompt-00-executive-summary-v5.md](prompts/prompt-00-executive-summary-v5.md)) : T1 dashboard aggregates fix + T2 delete 3 debug routes + T3 regression tests gated `SUPABASE_API_TESTS=1` + T4 `SnapshotPayload` discriminé + T5 trigger inventory + 2 trouvailles documentées. Livré 2026-05-07, 6 commits (`be6af8e → c54fb7f`), score estimé ~73/100
- ✅ **Sprint Audit-Triggers** ([prompt-00-executive-summary-v6.md](prompts/prompt-00-executive-summary-v6.md)) : A1 fix filtre baseline trigger + A2 capture des **5** fonctions PL/pgSQL non-versionnées (les 3 du prompt + `update_updated_at_column` canonique + `calculate_group_contributions` découverte en cours via `PERFORM`) + A3 `pnpm db:check-functions` (pin 4 custom) + A4 CI extension. Livré 2026-05-07, 6 commits (`f747e98 → ...`), score estimé ~75/100
- ⏭️ **Sprint 1** : Prettier + Husky + CI + upgrade `eslint-config-next` 15→16
- ⏭️ **Chantier I4** : refactor `lib/financial-calculations.ts` (god file 1075 LOC)
- ⏭️ **Chantier I5** : extraction logique métier de `app/api/monthly-recap/process-step1/route.ts`
- ⏭️ **Chantier console.log cleanup** : 1331 occurrences à remplacer par `financial-logger`
- ⏭️ **Chantier Zod rollout** : validation runtime des inputs API (cf. `docs/audit/07-deep-dive-zod-rollout.md`)
