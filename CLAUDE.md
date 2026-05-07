# CLAUDE.md — Popoth

> Guide à charger en début de chaque session Claude Code sur ce repo. Garde-le à jour si une convention change.

## 1. Projet

**Popoth** : PWA francophone de gestion financière personnelle et en groupe. Domaines clés : budgets estimés, dépenses réelles, économies cumulées, tirelire commune, récap mensuel, transferts inter-budgets.

Prod hébergée sur Supabase (`jzmppreybwabaeycvasz`). Audit complet 2026-04 dans [docs/audit/](docs/audit/) (score 47/100 avant Sprint 0, ~51 après Sprint 0, ~58 après Sprint DB). Carte du schéma post-Sprint DB dans [docs/db/SCHEMA.md](docs/db/SCHEMA.md).

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
| `pnpm supabase ...` | Supabase CLI (lié à `jzmppreybwabaeycvasz`) |
| `node scripts/export-schema.mjs <out.sql>` | Snapshot du schéma prod via API Management (sans Docker) |
| `node scripts/apply-sql.mjs <file.sql>` | Applique un fichier SQL via API Management (drift recovery) |

Tests gated (env var requise pour s'exécuter, sinon `describe.skipIf` skippe) :
- `SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run` — couverture RPC concurrence (D9)
- `SUPABASE_RLS_TESTS=1 pnpm test:run` — isolation cross-user RLS (D4)

## 4. Structure du repo

```
app/                       # App Router (pages + API routes)
  api/
    debug/                 # 20 routes de seed/reset — BLOQUÉES en prod via blockInProduction()
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
  finance/                 # ✅ HELPERS RPC ATOMIQUES (Sprint 0 C3)
    context.ts             # ContextFilter type discriminé { profile_id } | { group_id } + asContextFilter()
    piggy-bank.ts          # updatePiggyBank, transferFromPiggyToBudget
    bank-balance.ts        # updateBankBalance
    budget-savings.ts      # updateBudgetCumulatedSavings
    __tests__/             # Sprint DB
      rpc-concurrency.test.ts  # gated SUPABASE_RPC_CONCURRENCY_TESTS=1
      rls-isolation.test.ts    # gated SUPABASE_RLS_TESTS=1
scripts/                   # Sprint DB outils API Management (sans Docker)
  export-schema.mjs        # snapshot prod schema → SQL baseline
  apply-sql.mjs            # applique un .sql via API Management (drift recovery)
supabase/
  config.toml              # CLI config (lié au projet distant)
  migrations/              # ✅ baseline + RLS + perf + dedup (Sprint DB)
    20260101000000_remote_schema.sql           # baseline hand-curated (D5)
    20260506000000_create_finance_rpcs.sql     # 4 RPC C3 — NE PAS MODIFIER
    20260507000000_enable_rls_piggy_bank.sql   # D1
    20260507000001_fix_group_contributions_policy.sql  # D2
    20260507000002_fix_remaining_to_live_insert.sql    # D3
    20260508000000_add_piggy_bank_indexes.sql  # D7
    20260508000001_add_piggy_bank_constraints.sql  # D8
    20260509000000_dedupe_profiles_policies.sql    # D10
docs/audit/                # Audit complet codebase 2026-04
  00-executive-summary.md  # vue d'ensemble + score
  06-action-plan.md        # plan multi-sprint
  RLS-FINDINGS.md          # snapshot RLS pré-Sprint DB (les 3 failles sont closes)
  07-deep-dive-*.md        # playbooks par chantier
docs/db/                   # ✅ Sprint DB / D11
  SCHEMA.md                # carte des tables, RPC, indexes, FK, hot path
prompts/                   # prompts Claude Code par chantier
  prompt-00-executive-summary.md     # Sprint 0 (livré)
  prompt-00-executive-summary-v2.md  # Sprint DB (livré 2026-05-07)
  prompt-00-executive-summary-v3.md  # Sprint Refactor (à exécuter)
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
- **Aucun nouveau `any`** dans le code Sprint 0+. Les ~57 `: any` existants sont à nettoyer progressivement.

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
- D6 — `lib/database.types.ts` généré + augmenté dans `lib/database.ts` avec les 4 RPC C3 service-role-only. Wirage `<Database>` aux clients **différé** (Sprint Refactor v3) à cause de ~105 erreurs TS pré-existantes dans les routes `app/api/debug/populate-*`.
- D7 — `piggy_bank` indexé (2 partial unique indexes par owner).
- D8 — `piggy_bank` contraint (amount ≥ 0, owner XOR).
- D9 — Tests concurrence RPC (4/4 verts, 100× parallèles convergent).
- D10 — Policy SELECT redondante sur `profiles` supprimée.
- D11 — [docs/db/SCHEMA.md](docs/db/SCHEMA.md) ajouté.

### ⚠️ Drift découvert pendant Sprint DB
- `supabase_migrations.schema_migrations` listait `20260506000000_create_finance_rpcs.sql` comme appliquée **sans que le SQL ait jamais été exécuté en prod** : les 4 RPC C3 étaient absentes de `pg_proc`. Recouvrement via `node scripts/apply-sql.mjs supabase/migrations/20260506000000_create_finance_rpcs.sql` + `NOTIFY pgrst, 'reload schema'`. Origine du drift inconnue → cible **R0** du Sprint Refactor.

Voir [docs/audit/RLS-FINDINGS.md](docs/audit/RLS-FINDINGS.md) (état pré-Sprint DB) et [prompts/prompt-00-executive-summary-v3.md](prompts/prompt-00-executive-summary-v3.md) (Sprint Refactor — angles morts post-Sprint DB).

## 8. À FAIRE / À NE PAS FAIRE

### ✅ À faire
- Pour toute écriture sur `piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings` : **utiliser obligatoirement** les helpers `lib/finance/*`. Pas de SELECT-then-UPDATE direct.
- Pour toute nouvelle route `/api/debug/*` : importer + appeler `blockInProduction()` en première instruction.
- Lire `RLS-FINDINGS.md` + [docs/db/SCHEMA.md](docs/db/SCHEMA.md) avant d'ajouter une nouvelle table ou une nouvelle policy.
- Lancer `pnpm typecheck && pnpm test:run` après chaque modif significative.
- Pour les requêtes hors de l'app (audit, migration, debug schéma) : préférer l'API Management `POST /v1/projects/{ref}/database/query` (sans Docker) plutôt que `psql` ou `db pull`. `scripts/export-schema.mjs` et `scripts/apply-sql.mjs` exposent ce pattern.
- Pour toute nouvelle RPC : `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` + `SET search_path = public`. **Suivre la migration de** `NOTIFY pgrst, 'reload schema';` pour forcer le rafraîchissement du cache PostgREST (sinon `.rpc()` lève "Could not find the function in the schema cache" — leçon Sprint DB).
- Push gate prod : `pnpm supabase db push --dry-run` → STOP confirmation utilisateur → `db push` → re-audit Management API → commit.
- Régénérer les types après changement de schéma : `pnpm db:types` (puis ajuster `lib/database.ts` si nouvelles RPC service-role-only).

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
- **Pattern import dynamique pour gated tests** : si un test importe `lib/finance/*` (qui transitivement charge `lib/supabase-server.ts` créant un client à l'eval du module), faire l'`await import('@/lib/finance/...')` à l'intérieur de `beforeAll` pour que le module ne se charge PAS quand le suite est skipped sans env vars. Pattern visible dans `rpc-concurrency.test.ts`.
- **chunked(...)** helper dans `rpc-concurrency.test.ts` : batch les appels parallèles en groupes de 10 pour rester sous le pool undici default per-origin de Node fetch.

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
Ces deux derniers sont à passer en variables inline (`SUPABASE_ACCESS_TOKEN=... pnpm supabase ...`), **jamais** persisté dans un fichier committé.

## 11. Roadmap (à jour 2026-05-07)

- ✅ **Sprint 0** (`cleanup` branch) : C1–C5 + follow-up RLS audit (livré)
- ✅ **Sprint DB** ([prompt-00-executive-summary-v2.md](prompts/prompt-00-executive-summary-v2.md)) : D1–D11 livré 2026-05-07, 5 commits (`39e56f8 → 55d1606`), score ~58/100
- ⏭️ **Sprint Refactor** ([prompt-00-executive-summary-v3.md](prompts/prompt-00-executive-summary-v3.md)) : R0 post-mortem drift C3 + R1 routes debug cassées + R2 wirage `<Database>` + R3 dedup schéma + R4 drift detection + R5 contrainte `bank_balances.balance` + R6 tests RLS isolation D2/D3
- ⏭️ **Sprint 1** : Prettier + Husky + CI + upgrade `eslint-config-next` 15→16
- ⏭️ **Chantier I4** : refactor `lib/financial-calculations.ts` (god file 1075 LOC)
- ⏭️ **Chantier I5** : extraction logique métier de `app/api/monthly-recap/process-step1/route.ts`
- ⏭️ **Chantier console.log cleanup** : 1331 occurrences à remplacer par `financial-logger`
- ⏭️ **Chantier Zod rollout** : validation runtime des inputs API (cf. `docs/audit/07-deep-dive-zod-rollout.md`)
