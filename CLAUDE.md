# CLAUDE.md — Popoth

> Index opérationnel chargé en début de chaque session Claude Code sur ce repo. Garde-le à jour si une convention change.

## ⚠️ Règle critique de maintenance

Ce fichier ne doit **JAMAIS dépasser 40 KB**.

- **Avant toute modification** : vérifier la taille avec `wc -c CLAUDE.md`
- **Si l'ajout fait dépasser 38 KB** : créer/étendre un sous-fichier dans `.claude/` au lieu d'inliner
- **Si une refactorisation est nécessaire** : avertir l'utilisateur **AVANT** de modifier
- **Cible** : 35–40 KB. **Plafond absolu** : 40 KB.

**Architecture documentaire** (référence `@.claude/<path>` navigable depuis Claude Code) :

- `CLAUDE.md` (ce fichier) — index opérationnel + instructions critiques actives
- [@.claude/history/](.claude/history/) — score-evolution, sprint-history-security, roadmap-detailed (94 sprints verbatim)
- [@.claude/reference/structure-repo.md](.claude/reference/structure-repo.md) — inventaire fichiers annoté
- [@.claude/conventions/](.claude/conventions/) — patterns détaillés (zod-patterns, typescript, logs-cleanup, git-workflow, operational-rules)
- [@.claude/guardrails/size-policy.md](.claude/guardrails/size-policy.md) — politique 40 KB

## 1. Projet

**Popoth** : PWA francophone de gestion financière personnelle et en groupe. Domaines clés : budgets estimés, dépenses réelles, économies cumulées, tirelire commune, récap mensuel, transferts inter-budgets.

Prod hébergée sur Supabase (`jzmppreybwabaeycvasz`). **Score audit estimé : ~100/100** (baseline 47/100 audit 2026-04). Pour l'évolution détaillée du score sprint par sprint, voir [@.claude/history/score-evolution.md](.claude/history/score-evolution.md).

## 2. Stack

- **Next.js 16.2.6** App Router, Turbopack en build, **webpack en dev** (`pnpm dev` → `next dev --webpack`)
- **React 19.1.1** + **TanStack Query 5.100.9** pour le data-fetching (provider mounted dans [app/layout.tsx](app/layout.tsx) ; tous les hooks fetcher migrés au Sprint 1.5)
- **TypeScript 5** strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` (imports type-only obligatoires)
- **Tailwind 4** (CSS-first config dans [app/globals.css](app/globals.css) `@theme {}` block, plus de `tailwind.config.ts` ; `@tailwindcss/postcss` + `tw-animate-css` pour animations Radix Dialog/Drawer)
- **shadcn/ui** (variant new-york) + **Radix UI Dialog** pour modals (Sprint Zod-Rollout v8 — 12 surfaces avec focus trap natif)
- **Supabase** (`@supabase/supabase-js@^2.105.4`) — PostgreSQL + Auth
- **pnpm 9.15.5** (verrouillé via `packageManager` + `engines.pnpm >=9.0.0`), Node ≥ 20.10.0 (`engines.node` + [.nvmrc](.nvmrc) pinned `20` LTS major)
- **Vitest 4.1.5** pour tests unitaires + RTL (jsdom 25 + @testing-library) — `test.projects` split env=node `*.test.ts` / env=jsdom `*.test.tsx`
- **Zod 4.4.3** pour validation API + client forms (`parseBody`/`parseQuery` + `react-hook-form` + `zodResolver`)
- **eslint-config-next 16.2.6** + **eslint 9.39.4** (flat configs natifs, pas de FlatCompat). Voir [eslint.config.mjs](eslint.config.mjs).

## 3. Commandes

| Commande                                   | Effet                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                 | Serveur dev Next.js (webpack)                                                                                                             |
| `pnpm build`                               | Build prod (Turbopack)                                                                                                                    |
| `pnpm start`                               | Serveur prod                                                                                                                              |
| `pnpm typecheck`                           | `tsc --noEmit` (BLOQUANT en CI)                                                                                                           |
| `pnpm lint:check`                          | ESLint sans `--fix` — **BLOQUANT** depuis Sprint Lint-Baseline-Cleanup. Baseline `0 errors / 0 warnings` (post-Lot 6).                    |
| `pnpm lint` / `pnpm lint:fix`              | ESLint avec `--fix` (alias)                                                                                                               |
| `pnpm format`                              | Prettier `--write` (idempotent, à éviter dans une PR feature)                                                                             |
| `pnpm format:check`                        | Prettier `--check` — **BLOQUANT** en CI                                                                                                   |
| `pnpm ci`                                  | `typecheck + lint:check + format:check + test:run + build` (invoquer via `pnpm run ci`, pas `pnpm ci`)                                    |
| `pnpm test` / `pnpm test:run`              | Vitest watch / single run                                                                                                                 |
| `pnpm test:coverage`                       | Vitest avec coverage v8 (ad-hoc, pas un gate)                                                                                             |
| `pnpm db:types`                            | Régénère `lib/database.types.ts` (sans redirection — le script écrit lui-même). Utilise `--project-id` (fonctionne sans `supabase link`). |
| `pnpm db:check-drift`                      | Compare prod ↔ baseline. Exit 0 = clean, 1 = drift                                                                                        |
| `pnpm db:check-rpcs`                       | Vérifie présence des **10 RPCs pinnées** dans `pg_proc`                                                                                   |
| `pnpm db:check-functions`                  | Vérifie présence des 4 fonctions trigger custom                                                                                           |
| `pnpm db:check-types-fresh`                | Vérifie que `database.types.ts` matche prod                                                                                               |
| `pnpm db:audit-functions`                  | Audit générique `pg_proc` ↔ migrations (lance après chaque migration touchant une fonction PL/pgSQL)                                      |
| `pnpm db:audit-objects`                    | Audit générique étendu (functions, types, enums, domains, operators)                                                                      |
| `pnpm verify`                              | **Sanity sweep** : `typecheck + test:run + 6 db:* checks` fail-fast. ~36s en local. À lancer après chaque sprint.                         |
| `pnpm supabase ...`                        | Supabase CLI (lié à `jzmppreybwabaeycvasz`)                                                                                               |
| `node scripts/export-schema.mjs <out.sql>` | Snapshot du schéma prod via API Management (sans Docker)                                                                                  |
| `node scripts/apply-sql.mjs <file.sql>`    | Applique un fichier SQL via API Management                                                                                                |

### Hooks Git (Husky)

3 hooks installés :

- **pre-commit** ([.husky/pre-commit](.husky/pre-commit)) — `pnpm lint-staged` (prettier `--write` + eslint `--fix` sur fichiers staged)
- **pre-push** ([.husky/pre-push](.husky/pre-push)) — `pnpm lint:check && pnpm typecheck` fail-fast
- **commit-msg** ([.husky/commit-msg](.husky/commit-msg)) — `pnpm exec commitlint --edit "$1"` (config dans [commitlint.config.js](commitlint.config.js))

Bypass d'urgence `git commit --no-verify` possible **mais à éviter** (cf. §8 ❌). Si hooks ne firent pas après fresh clone : `pnpm exec husky` manuellement.

**Détails workflows Husky + capture-then-drop + DROP + push gate + Dependabot triage** → [@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md).

### Tests gated (env var requise, sinon `describe.skipIf` skip)

- `SUPABASE_RPC_CONCURRENCY_TESTS=1` — concurrence RPC (rpc-concurrency, transfer-with-savings, add-expense-with-breakdown, transfer-savings, transfer-piggy-to-budget-with-insert)
- `SUPABASE_RLS_TESTS=1` — isolation cross-user RLS
- `SUPABASE_API_TESTS=1` — régressions H1/H2/R2 + withAuth wrapper (12 cas)
- `SUPABASE_TRIGGER_TESTS=1` — 4 fonctions trigger A2 + FK ON DELETE SET NULL
- `SUPABASE_FINANCE_TESTS=1` — round-trip `_loadFinancialData` profile+group (6 cas)
- `SUPABASE_RECAP_TESTS=1` — caractérisation routes process-step1 + complete + auto-balance + recover (21 cas répartis)

## 4. Structure du repo

L'inventaire complet annoté (app/, components/, hooks/, lib/, supabase/, scripts/) est dans [@.claude/reference/structure-repo.md](.claude/reference/structure-repo.md). À tenir à jour quand un module est ajouté/supprimé/déplacé.

**Sommaire haut-niveau** :

- `app/` — App Router (pages + API routes)
- `components/` — UI (shadcn/ui sous `components/ui/`), incluant `<DecimalFormInput>`, `<ModalCloseX>`, `DRAWER_CONTENT_CLASSES`
- `contexts/` — `AuthContext` (split en `AuthUserContext` + `AuthActionsContext`)
- `hooks/` — 20 hooks React (TanStack Query majoritairement)
- `lib/` — modules backend
  - `lib/api/` — `parseBody`/`parseQuery`/`withAuth`/`withAuthAndProfile` + handlers `lib/api/finance/` (12 modules)
  - `lib/finance/` — modules atomiques RPC + helpers (Sprint Refactor-I4, 8 modules)
  - `lib/recap/` — algorithmes recap + persist extraits des god-files (Sprints Refactor-I5/I6/Auto-Balance/Recover)
  - `lib/schemas/` — schemas Zod par domaine + barrel `index.ts`
  - `lib/openapi/` — registry + generate (Sprint OpenAPI)
  - `lib/logger.ts` — logger central level-aware
- `supabase/migrations/` — baseline + RLS + RPCs (1 fichier par feature)
- `scripts/` — outils API Management (export-schema, apply-sql, check-drift, check-rpcs, audit-\*)
- `doc2/` — documentation migrée (api/README, db/SCHEMA)

## 5. Architecture critique

- **2 clients Supabase** :
  - `lib/supabase-server.ts` (service_role, **bypass RLS**) — utilisé par TOUTES les routes API. Les failles RLS ne s'exploitent PAS depuis ce client.
  - `lib/supabase-client.ts` (anon key, **soumis à RLS**) — utilisé côté browser via les hooks. C'est par ici que les failles RLS sont exploitables (cf. [doc2/audit/RLS-FINDINGS.md](doc2/audit/RLS-FINDINGS.md)).
- **Workflow recap mensuel** : `app/api/monthly-recap/{initialize,step1-data,process-step1,step2-data,balance,auto-balance,accumulate-piggy-bank,transfer,recover,refresh,resume,update-step,complete}/route.ts`. **4/4 god-files stateful extraits** vers `lib/recap/{<route>-{algorithm,persist,types}.ts}` (Sprints Refactor-I5, I6, Auto-Balance, Recover). Les routes restent thin handlers (45-168 LOC) wrappés par `withAuthAndProfile`. La route `balance` reste en god-file (déférée — Sprint Balance-Atomicity-Eval a confirmé 0 pattern reversed, pas de gain à extraire).
- **Allocation des dépenses** : ordre de priorité **budget restant → savings (cascade UNIQUEMENT si overflow) → piggy JAMAIS auto-débitée** (Sprint P4-P5-P6 strict default). Toggle P5 (`useSavingsToggle: true`) inverse au profit des savings (opt-in user-driven). `calculateBreakdown` dans le module pur [lib/expense-breakdown.ts](lib/expense-breakdown.ts) (séparé de `expense-allocation.ts` pour éviter le bundling de service_role key côté client). L'écriture passe **toujours** par les helpers `lib/finance/*` (RPC atomiques).
- **Auth** : JWT custom signé via `jose` (pas Supabase Auth direct). Cookie `session` validé par `validateSessionToken(request)` dans chaque route API, encapsulé dans `withAuth` / `withAuthAndProfile` (Sprint Refactor-Architecture v3-v5).
- **Globals partagés** : **éliminés** (Sprint Refactor-I6). Le pattern `declare global` n'existe plus dans aucune route. Les 4 globals de `complete/route.ts` sont devenus des champs explicites sur `ProcessCompleteDecision`.
- **Distinction calculs finance** : [lib/contribution-calculator.ts](lib/contribution-calculator.ts) (budget-allocation, salary-proportional split, pure-sync, consumer = `ProfileSettingsCard.tsx`) ≠ [lib/finance/income-compensation.ts](lib/finance/income-compensation.ts) (income aggregation, async + Supabase, alimente le RAV via `_loadFinancialData`). Les noms sont voisins mais orthogonaux.
- **`budget_transfers.monthly_recap_id` nullable best-effort** : seule la route manuelle [app/api/monthly-recap/transfer/route.ts](app/api/monthly-recap/transfer/route.ts) la set (depuis le body). Les 5 paths automatiques laissent NULL (step1-persist 2.3.1+2.4.2 via RPC, auto-balance, balance, complete). **0 applicative consumer** lit/filtre/JOIN cette colonne (vérifié 2026-05-11). Pas de plumbing prévu tant qu'un consumer ne surface pas.

## 5.5 Invariants actuels

À tenir à jour à chaque sprint touchant ces invariants.

| Invariant                                 | Valeur                    | Source / Vérification                                                                  |
| ----------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `EXPECTED_RPCS`                           | **10**                    | [scripts/check-rpcs.mjs](scripts/check-rpcs.mjs)                                       |
| Counter `as unknown as SupabaseClient`    | **0**                     | `Grep "as unknown as SupabaseClient"` cross-codebase                                   |
| Counter `: any` (hors auto-generated)     | **0**                     | `pnpm lint:check` no-explicit-any                                                      |
| Counter `declare global`                  | **0**                     | `Grep "declare global"` cross-codebase                                                 |
| Lint baseline                             | **0 errors / 0 warnings** | `pnpm lint:check`                                                                      |
| Tests non-gated passants                  | **485**                   | `pnpm test:run`                                                                        |
| Tests gated skipped (sans env vars)       | **89**                    | idem                                                                                   |
| Routes API                                | **54**                    | `pnpm build`                                                                           |
| Functions DB versionnées                  | **15/15**                 | `pnpm db:audit-functions`                                                              |
| God-files monthly-recap stateful extraits | **4/4**                   | process-step1 (I5) / complete (I6) / auto-balance / recover                            |
| Tables v2 NON-restaurées par `recover`    | **5**                     | profiles / groups / group_contributions / monthly_recaps / remaining_to_live_snapshots |
| Score audit estimé                        | **~100**                  | Voir [@.claude/history/score-evolution.md](.claude/history/score-evolution.md)         |

## 6. Conventions

### API

- Format réponse : **`{ data: T } | { error: string }`** sur toutes les routes
- Auth invalide : `401` + `{ error: 'Session invalide' }`
- Debug-route en prod : `404` (pas 403, pour ne pas révéler l'existence)
- Pattern obligatoire :

  ```ts
  export async function POST(request: NextRequest) {
    const blocked = blockInProduction() // SI route /api/debug/*
    if (blocked) return blocked
    try {
      const sessionData = await validateSessionToken(request)
      if (!sessionData?.userId)
        return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
      // ...
    } catch (error) {
      return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
    }
  }
  ```

- Pour les handlers non-debug, préférer le wrapper `withAuth(handler)` / `withAuthAndProfile(handler)` depuis [lib/api/with-auth.ts](lib/api/with-auth.ts) (34 modules wrappés). `withAuthAndProfile` fetch `select('id, group_id, first_name, last_name')` et passe `{ userId, profile }` au callback. Pour routes dynamiques : `withAuth<RouteParams>(async (req, ctx, routeContext) => { const { id } = await routeContext.params })`.
- **Hors scope wrapper** : `app/api/debug/**` (blockInProduction wrap d'abord), `app/api/auth/**` (créent la session).

### Validation Zod

Le repo utilise Zod pour valider 100% des bodies API et form clients via `parseBody`/`parseQuery` + `react-hook-form` + `zodResolver`. **Patterns A–H standardisés** dans [@.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md).

**Pour ajouter une route** : déclarer schema dans `lib/schemas/<domain>.ts` + brancher via `parseBody(request, schema)` + `handleBadRequest(error)` au top du catch (avant le 500 fallback). Pas de validation manuelle subséquente.

```ts
import { parseBody, handleBadRequest } from '@/lib/api/parse-body'
import { someSchema } from '@/lib/schemas/<domain>'

export const POST = withAuthAndProfile(async (request, { profile }) => {
  try {
    const body = await parseBody(request, someSchema) // typé + validé
    // ...
  } catch (error) {
    const handled = handleBadRequest(error)
    if (handled) return handled
    return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

**Pour les forms client** : pattern dual-type `useForm<FormInput, undefined, FormOutput>` (Pattern A) avec `<DecimalFormInput>` composant réutilisable pour décimaux fr-FR (comma→dot). Voir [@.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md) pour les 8 patterns standardisés et la liste des routes/forms migrés par sprint.

**Primitives partagés** dans [lib/schemas/common.ts](lib/schemas/common.ts) : `contextSchema`, `uuidSchema`, `moneySchema`, `nonNegativeMoneySchema`, `isoDateSchema`, `moneyFormSchema`, `periodSchema` (P1). Query schemas : `contextOnlyQuerySchema`, `estimatedListQuerySchema`, `deleteByIdQuerySchema`, `summaryQuerySchema`, `progressQuerySchema`.

### TypeScript

- `verbatimModuleSyntax` actif → **`import type` obligatoire**
- `noUncheckedIndexedAccess` actif → `arr[i]` est `T | undefined`, toujours narrow
- Catches : `error: unknown` + narrow ; préférer `} catch {` (sans binding) si la valeur n'est pas utilisée
- Préférer `as unknown as T` plutôt que `as any`
- Pour Supabase Insert/Update payloads : utiliser `Database['public']['Tables']['<table>']['Insert' | 'Update']`. Pour computed keys dynamic `[ownerField]: contextId`, narrow if/else explicit (cf. Sprint Supabase-Strict-Types)
- **Invariants** : 0 `: any`, 0 `as unknown as SupabaseClient`, 0 `declare global` (cf. §5.5)

Détails et patterns complets → [@.claude/conventions/typescript.md](.claude/conventions/typescript.md).

### ESLint suppressions (justified disable pattern)

Format : `// eslint-disable-next-line <rule> -- <raison explicite>` (double-tiret + raison). Exemples installés :

- `react-hooks/exhaustive-deps` sur fetchers mount-only ou context-change-only
- `@next/next/no-img-element` sur [components/ui/UserAvatar.tsx](components/ui/UserAvatar.tsx) (Supabase Storage remote hosts)
- `react-hooks/set-state-in-effect` — compteur 0 depuis Sprint 2-followup-v3 (migration `useState` → `useReducer` dans `AuthContext`)

**Ne PAS** utiliser `// eslint-disable-next-line` sans raison. **Ne PAS** utiliser `// eslint-disable` (sans `-next-line`) au top du fichier.

### Format / Prettier

Config [.prettierrc.json](.prettierrc.json) : `semi: false`, `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: 'always'`, `endOfLine: 'lf'`, plugin `prettier-plugin-tailwindcss`.
Ignore [.prettierignore](.prettierignore) : `node_modules`, `.next`, `lib/database.types.ts` (auto-gen), `next-env.d.ts` (auto-gen).

**Ne PAS lancer** `pnpm format` (= `prettier --write .`) dans une PR feature — diff mécanique massif. `lint-staged` formate les fichiers staged au commit automatiquement.

### Logs

Logger central : [lib/logger.ts](lib/logger.ts). 4 niveaux `error/warn/info/debug`. Gated via `LOG_LEVEL` env (défaut `warn` prod / `debug` dev). Strip prod automatique via SWC `compiler.removeConsole` (exclude `error`/`warn`).

ESLint global `'no-console': ['error', { allow: ['warn', 'error'] }]` (Sprint Cleanup-I8 / Lot 6, activé 2026-05-14). Tout nouveau `console.log` fait sortir la PR rouge.

**Règle d'or de triage** pour tout `console.*` :

- **(a)** outer catch-all `console.error('Error in METHOD /api/...:', error)` → **DROP** (Next.js capture la stack côté Vercel)
- **(b)** DB error inline qui discrimine une branche → **KEEP+migrate** `logger.error` (grep-able si bug futur)
- **(c)** erreur silencieusement avalée (return 200 ou fallback) → **KEEP+migrate**
- **(d)** cleanup-attempt critique → **KEEP+migrate**

Pour le code que tu écris : préfère `logger.debug/info`. `console.warn`/`console.error` directs allow-listés ad-hoc mais préférer `logger.warn`/`logger.error`.

Détails Lot 1-6 history + per-file overrides → [@.claude/conventions/logs-cleanup.md](.claude/conventions/logs-cleanup.md).

### Naming

- DB : **snake_case** (`profile_id`, `cumulated_savings`, `bank_balances`)
- TS : **camelCase** (`profileId`, `cumulatedSavings`)
- Migrations : `<YYYYMMDDHHMMSS>_<verb>_<scope>.sql`

### Git

- **Default branch GitHub : `cleanup`** (Sprint Hygiene-CI / E3). `main` reste figé.
- Branches feature depuis `cleanup`
- **Conventional Commits** enforced via `commit-msg` hook (Sprint Commitlint chantier 24) : 11 types allowlist (`feat`, `fix`, `chore`, `docs`, `perf`, `test`, `refactor`, `style`, `revert`, `build`, `ci`). Config relaxée : `subject-case` OFF, `header-max-length 100`, `body-max-line-length` OFF.
- **Un commit par item** dans les sprints multi-items
- **Toujours créer un nouveau commit**, jamais `--amend` un commit publié
- **JAMAIS** `--no-verify`, `--no-gpg-sign`, ou `git push --force` sans demande explicite

Détails capture-then-drop + DROP workflow + push gate + Dependabot triage → [@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md).

## 7. Sécurité — état des lieux

L'historique détaillé des sprints sécurité (Sprint 0 → Sprint Refactor-Architecture, 15 sprints livrés 2026-05-06/07/08) est dans [@.claude/history/sprint-history-security.md](.claude/history/sprint-history-security.md). État résumé :

- ✅ **Sprint 0** : `typescript.ignoreBuildErrors` retiré (C1), 20 routes debug bloquées `blockInProduction()` (C2), 4 RPC atomiques piggy/bank/savings/transfer-from-piggy (C3), audit RLS (C4)
- ✅ **Sprint DB** (D1-D11) : RLS activée sur `piggy_bank`, policies group_contributions / remaining_to_live_snapshots fixées, schéma baseline versionné, types générés, indexes/constraints piggy, tests RPC concurrence, dedupe profiles policies
- ✅ **Sprint Refactor** : 11 routes debug dead supprimées (R1), `createClient<Database>` wirage (R2), dedupe indexes/constraints (R3), `pnpm db:check-drift` (R4), tests RLS D2/D3 + fix policy récursive (R6)
- ✅ **Sprint Hardening** : H1 unwind 17 scope-casts (3 vrais bugs surfacés), H2 ghost table dropped, H3 overdraft bank_balance, H4 `pnpm db:check-rpcs`
- ✅ **Sprint Polish, Audit-Triggers, Audit-Functions-v2, Cleanup-Legacy, Polish-CI, Hygiene-CI, Code-CI, DX-Verify, Stabilize-Deps** : suite de consolidations CI/db-audit/dependabot

**Drift C3 résolu** : `supabase_migrations.schema_migrations` ↔ `pg_proc` (les 4 RPC C3 marquées appliquées sans exécution du SQL). Filet aujourd'hui = `pnpm db:check-drift` + `db:check-rpcs` + `db:check-types-fresh` + tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1`. Post-mortem dans [doc2/audit/POST-MORTEM-C3-DRIFT.md](doc2/audit/POST-MORTEM-C3-DRIFT.md).

## 8. À FAIRE / À NE PAS FAIRE

### ✅ À faire

- **Tout nouveau body POST/PATCH/PUT** : déclarer schema dans `lib/schemas/<domain>.ts` + brancher via `parseBody(request, schema)` + `handleBadRequest(error)` (cf. §6 Validation Zod). Pas de validation manuelle. Préférer `z.discriminatedUnion` / `z.union + type guard` / `.refine`.
- **Tout transfert/écriture sur colonnes sensibles** (`piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings`) : **utiliser obligatoirement** les helpers `lib/finance/*` (10 composite RPCs atomiques). Pas de SELECT-then-UPDATE direct. Pas d'appels séparés `updatePiggyBank` + `updateBudgetCumulatedSavings` + `INSERT` — utiliser le composite adapté : smart-allocation → `addExpenseWithBreakdown` ; cross-budget cascade → `addExpenseWithCrossBudgetCascade` ; savings budget↔budget OU budget→piggy → `transferSavingsBetweenBudgets` / `transferBudgetToPiggyBank` ; piggy→budget avec audit-trail → `transferPiggyToBudgetWithInsert` ; recap step 2.4.2 → `transferWithSavingsDebit`. Tableau complet → [@.claude/conventions/operational-rules.md](.claude/conventions/operational-rules.md) §4.
- **Calcul breakdown côté client** : importer `calculateBreakdown` depuis [lib/expense-breakdown.ts](lib/expense-breakdown.ts) (module pur), **PAS** depuis `expense-allocation.ts` (importe `supabase-server` avec service_role key, leak côté client).
- **Composant qui consomme l'auth** : `useAuthUser()` (state) / `useAuthActions()` (handlers) / hooks composés `useRequireGuest()` / `useLogin()` / `useLogoutAndRedirect()`. **Pas de `useAuth()` aggregator** (supprimé Sprint 2-followup-v5).
- **Magic numbers** (TTL, intervalle, tolérance) : déclarer dans [lib/constants/](lib/constants/) (`auth.ts` / `finance.ts`) avant d'utiliser.
- **Nouvelle route API finance** : créer handler dans `lib/api/finance/<route>.ts` + `route.ts` qui ré-exporte.
- **Nouveau handler API** : utiliser `withAuth(handler)` / `withAuthAndProfile(handler)` (cf. §6 API).
- **Middleware / Edge runtime** : ne JAMAIS faire de `fetch` self-call HTTP vers une route locale. Extraire en lib pure + importer directement (pattern [lib/recap/check-status.ts](lib/recap/check-status.ts)). Vérifier imports transitifs Edge-safe.
- **Fetch composant** : utiliser **TanStack Query** (`useQuery`/`useMutation`). Pour cross-domain invalidation : importer `invalidateFinancialRefreshes` depuis [@/lib/query-client](lib/query-client.ts) + l'invoquer depuis `onSuccess`. Pour mutations qui changent `profile.group_id` : invalider AUSSI `['profile']` + `['groups']`.
- **Modal forms qui mirror un prop dans le state local** : pattern `key={editing.id}` + `useState(() => ...editing.foo)` lazy init + parent conditional render `{isOpen && editing && <Modal key={editing.id} ... />}` (Sprint 1.5 standard).
- **Hook qui mirror un calcul `useMemo` dans un `useState`** : c'est de la duplication. Le `useMemo` est la source de vérité, retourner-le directement.
- **Reducer / state machine `useReducer`** : extraire reducer + types dans un module dédié sans `'use client'` (pattern [contexts/auth-reducer.ts](contexts/auth-reducer.ts)) pour testabilité pure-unit.
- **Context value alimenté par `useReducer`** : wrapper la value prop en `useMemo` avec deps slice-by-slice (pattern Sprint 2-followup-v4).
- **Nouvelle route `/api/debug/*`** : importer + appeler `blockInProduction()` en première instruction.
- **Consommateur de `recap_snapshots.snapshot_data`** : utiliser les types [lib/recap-snapshot.types.ts](lib/recap-snapshot.types.ts) (`SnapshotPayload` + `isSnapshotV2()`). Pas de `as any`.
- **Form client (a11y v5+v6)** : `aria-describedby` + `id` sur l'erreur avec id-prefix par form ; `role="alert"` sur le serverError ; `onInvalidSubmit` qui appelle `form.setFocus(Object.keys(errors)[0])` ; pour close X svg-only, `type="button"` + `aria-label="Fermer"` + `aria-hidden="true"` sur le `<svg>`.
- **Modal Radix-migré** : close X via `<ModalCloseX onClose={handleClose} variant="circle"|"ghost" disabled={...} />` (Sprint v10). Nouveau drawer fullscreen → `DRAWER_CONTENT_CLASSES` (Sprint v9). Test focus-trap regression-guard → helper `expectEscClose()` (Sprint v10).
- **DB ops** : Nouvelle RPC = `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` + `SET search_path = public` + `NOTIFY pgrst, 'reload schema';`. Nouvelle fonction trigger = migration dédiée + ajouter à `EXPECTED_FUNCTIONS` si custom. Après migration fonction → `pnpm db:audit-functions`. Après migration CREATE TYPE/DOMAIN/OPERATOR → `pnpm db:audit-objects`. DROP objet → workflow capture-then-drop strict ([@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md) §6). Capture rétroactive fonction prod → workflow strict, **NE PAS** `supabase db push` ([@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md) §5).
- **Push gate prod** : `pnpm supabase db push --dry-run` → STOP confirmation → `db push` → re-audit → commit. Régénérer types : `pnpm db:types` (sans redirection) + `pnpm db:check-types-fresh`. Après migration non-triviale : `pnpm db:check-drift` ; si exit 1, re-exporter baseline + commit (sinon trap C3).
- **PR Dependabot mergée** : `git pull` + `pnpm install` + `pnpm verify` + `pnpm dev` smoke. Fix-forward (`pnpm update <pkg>@<version>` + `revert: re-pin`) plutôt que `git revert -m 1`. Cf. [@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md) §9.

**Précédents Path B closed-by-deletion (7 cas), god-files extractions (4/4), cleanup-attempts CRITIQUES préservés, chronologie sprint patterns** → [@.claude/conventions/operational-rules.md](.claude/conventions/operational-rules.md).

### ❌ À ne pas faire

**Architecture / modals**

- ❌ **Modal/drawer en raw** `<div className="fixed inset-0 ...">` — utiliser `<Dialog>` + `<DialogContent>` Radix (Sprint v8). Pas de raw button + SVG `M6 18L18 6M6 6l12 12` pour close X — utiliser `<ModalCloseX>` (Sprint v10).
- ❌ **`await request.json()` direct** sans `parseBody` dans les routes Zod-migrated. Pas de `if (typeof X !== 'number' || X <= 0)` après parseBody.
- ❌ **Réintroduire `lib/financial-calculations.ts`** — splitté en 8 modules sous [lib/finance/](lib/finance/) au Sprint Refactor-I4.
- ❌ **Réintroduire les exports supprimés Sprint Dead-Code-Purge** : `resetPassword`/`updatePassword`, `calculateMinimumSalary`/`calculateMaximumGroupBudget`, 3 routes `app/api/debug/{remaining-to-live,financial,group-financial}`. Si besoin futur, recréer ad-hoc.

**God-files monthly-recap (4/4 extraits)**

- ❌ **Logique métier dans `process-step1`/`complete`/`auto-balance`/`recover` route.ts** — thin handlers ≤80 LOC. Tout ajout passe par `lib/recap/<route>-{algorithm,persist,types}.ts`.
- ❌ **`declare global`** dans aucune route (0 occurrence post-Refactor-I6).
- ❌ **Pattern SELECT-then-UPDATE sur `cumulated_savings`** dans `complete/route.ts` — utiliser `updateBudgetCumulatedSavings` RPC atomique.

**Sémantique RAV / breakdown**

- ❌ **Réintroduire `cumulated_savings` dans la formule RAV**. Formule canonique : `totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits`. `totalSavings` exposé séparément.
- ❌ **Dépendre de `estimated_budgets.monthly_surplus_deficit`** comme source du terme `budgetDeficits` — calculé **on-the-fly** via `calculateBudgetDeficit(estimatedAmount, spentThisMonth)`.
- ❌ **Pattern cascade-aggressive piggy→savings→budget dans `calculateBreakdown`**. P4 strict default = budget priorité 1, savings cascade UNIQUEMENT si overflow, **piggy JAMAIS auto-débitée**. Toggle P5 inverse opt-in user-driven.
- ❌ **Wizard single-step `AddTransactionModal`** — le wizard 2-step est requis pour P6.

**Patterns DB non-atomiques (consolidation par composite RPCs)**

- ❌ **Appels directs `updatePiggyBank` + `updateBudgetCumulatedSavings` + `INSERT real_expenses`** séparément en smart-allocation — utiliser `addExpenseWithBreakdown` (Sprint Atomicity-Expenses).
- ❌ **2 RPCs séquentielles + manual rollback** dans `savings/transfer/route.ts` — utiliser `transferSavingsBetweenBudgets` / `transferBudgetToPiggyBank` (Sprint Atomicity-Savings). `handlePiggyBankAction` supprimé Sprint v2 (0 consumer) — ne pas réintroduire sans use case.
- ❌ **Pattern reversed `for(savingsUpdates) updateBudgetCumulatedSavings → INSERT batched`** dans `auto-balance` — utiliser `transferWithSavingsDebit` per-pair (Sprint Auto-Balance-Atomic).
- ❌ **Pattern reversed `updatePiggyBank(aggregate) + INSERT batched (from_budget_id=NULL)`** — utiliser `transferPiggyToBudgetWithInsert` per-pair (Sprint Phase-B).
- ❌ **Retry automatique POST `/api/monthly-recap/process-step1`** sur 5xx — la route n'est pas idempotente. Frontend doit disable bouton pendant submission.

**Recover route — invariants stricts**

- ❌ **`bank_balance: boolean | number` mismatch dans `RecoveryResults`** — paths V1 ET V2 doivent assigner `true` strict (NEVER `data.length`, NEVER `Boolean(x)`).
- ❌ **Ajouter `profiles`/`groups`/`group_contributions`/`monthly_recaps`/`remaining_to_live_snapshots` dans `RestorableTable`** — sprint dédié `Recover-V2-Complete-Restoration` requis.
- ❌ **Consumer qui FILTER/JOIN sur `budget_transfers.monthly_recap_id`** sans d'abord plumber `recapId` à travers les 5 paths automatiques (cf. §5).

**Tests gated monthly-recap**

- ❌ **Supposer dans un test gated que `bank_balances.current_remaining_to_live` reste à la valeur seedée pendant `loadCompleteSnapshot`** — step 2 `getProfileFinancialData` écrase via `saveRavToDatabase` avant step 6 re-read. Tracer la séquence end-to-end avant d'asserter (cas Sprint Complete-CAS3-TestFix).

**Forbidden absolus**

- ❌ **Modifier** [supabase/migrations/20260506000000_create_finance_rpcs.sql](supabase/migrations/20260506000000_create_finance_rpcs.sql) — pour corriger une RPC, `CREATE OR REPLACE` dans nouvelle migration.
- ❌ **`any`** dans le nouveau code. **`console.log` ajouté** — utiliser `logger.debug/info`. **Mocker la DB** dans tests d'intégration.
- ❌ **Commiter** de secret. `.env.local` + `.claude/settings.local.json` gitignored.
- ❌ **Réactiver** `typescript.ignoreBuildErrors`. **Upgrader `eslint-config-next` 15→16** (déjà fait, ignore rule `>=16.0.0` en place).
- ❌ **Écrire des docs `.md`** sans demande explicite (sauf CLAUDE.md, RLS-FINDINGS, sous-fichiers `.claude/`).
- ❌ **Écrire la phrase littérale `eslint-disable-next-line`** dans un commentaire qui n'est PAS un disable directive — ESLint la parse comme rule "directive.". Reformuler.
- ❌ **Ajouter un trigger / handler-side cleanup pour FK** avant d'avoir vérifié si la FK a déjà `ON DELETE SET NULL` / `ON DELETE CASCADE` (cas Sprint 2-followup-v3 trigger redondant).

**Précédents détaillés (Path B, god-files, cleanup-attempts CRITIQUES, ❌ patterns complets)** → [@.claude/conventions/operational-rules.md](.claude/conventions/operational-rules.md).

## 9. Tests

- Framework : **Vitest 4.1.5** (`vitest.config.ts` à la racine, alias `@/` → racine, charge `.env.local` automatiquement). **`test.projects` split** : `unit` env=node pour `*.test.ts` (pure-unit + mocked + gated DB) + `client` env=jsdom pour `*.test.tsx` (RTL forms) avec `setupFiles: ['./vitest.setup.ts']`. Le split évite la régression perf x23 d'un env=jsdom flat.
- **Convention** : tests à côté du code, suffixe `.test.ts` ou `.test.tsx`. Pattern dossier `__tests__/`.
- **CI auto-run** depuis Sprint Code-CI / F1 : [.github/workflows/code-checks.yml](.github/workflows/code-checks.yml) lance `pnpm typecheck` + `pnpm test:run` sur tout PR. Étendu Sprint Stabilize-Deps / S2 à `push: branches: [cleanup]` (validation post-merge).

### Tests gated DB (env var requise — cf. §3)

- **rpc-concurrency** (`SUPABASE_RPC_CONCURRENCY_TESTS=1`) : 4 cas + extensions par sprint (transfer-with-savings 4 cas, add-expense-with-breakdown 6 cas, transfer-savings 8 cas, transfer-piggy-to-budget-with-insert 4 cas) — pinent atomicité sous 100× concurrence
- **rls-isolation** (`SUPABASE_RLS_TESTS=1`) : isolation cross-user
- **api-regressions** (`SUPABASE_API_TESTS=1`) : H1/H2/R2 (cumulated*savings round-trip, total_real*\*, availableBalance) + recover strict boolean A/B/C + withAuth wrapper 12 cas
- **trigger-behavior** (`SUPABASE_TRIGGER_TESTS=1`) : 4 fonctions trigger A2 + FK ON DELETE SET NULL
- **financial-data** (`SUPABASE_FINANCE_TESTS=1`) : 6 cas profile/group golden math + round-trip `bank_balances.current_remaining_to_live`
- **route.integration recap** (`SUPABASE_RECAP_TESTS=1`) : caractérisation byte-identique des 4 routes extraites (process-step1 6 cas + complete 5 cas + auto-balance 5 cas + recover 5 cas)

### Tests non-gated par module

- **lib/recap/** : step1-algorithm 28 cas + step1-persist 8 mocked / complete-algorithm 32 + complete-persist 18 / auto-balance-algorithm 37 + auto-balance-persist 17 / recover-algorithm 21 + recover-persist 16
- **lib/finance/** : calc-rtl 19 + snapshots 5
- **lib/schemas/** : 11 fichiers (common, budget, income, expense-real, expense-add, savings, bank-balance, profile, auth, recap, recap-complete, groups) couvrent refine/discriminatedUnion/dispatch
- **lib/api/** : parse-body 9 cas
- **lib/api/finance/** : expenses-add-with-logic 5 cas (incl. PIN ATOMIC CONTRACT)
- **app/api/savings/transfer/** : 4 cas PIN ATOMIC CONTRACT (Sprint Atomicity-Savings)
- **lib/**tests**/** : auth-reducer 14 + query-client + logger 11 + contribution-calculator 8
- **components/**tests**/** : a11y-audit 19 cas (7 axe-core + 12 focus-trap regression-guards via `expectEscClose` helper)
- **components/ui/**tests**/** : DecimalFormInput 8 + ModalCloseX 4
- **RTL forms** : 64+ cas répartis sur 15 fichiers `*.test.tsx` (auth + dashboard + profile + groups + transactions + EditBalance)

### Patterns techniques

- **Pattern import dynamique pour gated tests** : `await import('@/lib/...')` à l'intérieur de `beforeAll` pour que le module ne se charge PAS quand le suite est skipped sans env vars.
- **chunked helper** dans `rpc-concurrency.test.ts` : batch les appels parallèles en groupes de 10 (pool undici default per-origin de Node fetch).
- **Cleanup en cascade obligatoire** dans `afterAll` : tables FK → profiles sans `ON DELETE CASCADE` doivent être nettoyées explicitement avant `auth.admin.deleteUser`. Sans ça, prod accumule des comptes test orphelins.
- **Tests RTL** : mock-per-site inline `vi.mock('@/lib/supabase-client'|'@/hooks/useX', ...)`. UUIDs valides obligatoires dans fixtures FK (uuidSchema.nullable() rejette silencieusement `'b-1'`). CustomDropdown mocké en `<select>`.
- **a11y regression-guards** : `expect(input).toHaveAttribute('aria-describedby', 'X')` + `expect(input).toHaveFocus()` (Sprint v6 Axe 3) ; `expect(results.violations).toEqual([])` direct (pivot vitest 4.x, jest-axe matcher incompatible).

### Sanity sweep

`pnpm verify` (Sprint DX-Verify / G1) enchaîne `typecheck` + `test:run` + les 6 `db:*` checks avec fail-fast. ~36s en local. Skip-friendly : tests gated sans env vars skip et `verify` continue.

Détails patterns Zod-côté-client (Pattern A-H, useRavValidation séparation, factory refines, etc.) → [@.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md).

## 10. Variables d'environnement

`.env.local` (gitignored) doit contenir :

```
NEXT_PUBLIC_SUPABASE_URL=https://jzmppreybwabaeycvasz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<...>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>     # utilisé par lib/supabase-server.ts
JWT_SECRET_KEY=<...>                 # utilisé par lib/session.ts
LOG_LEVEL=debug                      # optionnel — error|warn|info|debug, défaut warn en prod / debug en dev
```

Pour les opérations CLI Supabase :

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

## 11. Roadmap — index 10 derniers sprints

**Pour l'historique détaillé verbatim des 94 sprints livrés**, voir [@.claude/history/roadmap-detailed.md](.claude/history/roadmap-detailed.md). Pour l'évolution du score, [@.claude/history/score-evolution.md](.claude/history/score-evolution.md). Pour l'historique sécurité Sprint 0 → Refactor-Architecture, [@.claude/history/sprint-history-security.md](.claude/history/sprint-history-security.md).

- ✅ **Sprint Refactor-Recover** (2026-05-16) — god file `recover/route.ts` 385 → 168 LOC splitté en `lib/recap/recover-{algorithm,persist,types}.ts`. 37 algo + 16 mocked + 5 caract gated. **4/4 god-files monthly-recap stateful extraits**.
- ✅ **Sprint Refactor-Auto-Balance** (2026-05-16) — god file `auto-balance/route.ts` 533 → 56 LOC splitté. 37 algo + 17 mocked + 5 caract gated.
- ✅ **Sprint Balance-Atomicity-Eval** (2026-05-16) — closeout : `balance/route.ts` déjà atomique by design (0 reversed pattern).
- ✅ **Sprint Complete-CAS3-TestFix** (2026-05-15) — fix test gated CAS 3 (assertion `expensesAfter length 0` impossible post-I6 ; reformulée en pin 1 exceptional row via Block 4).
- ✅ **Sprint Commitlint** (chantier 24, 2026-05-15) — `@commitlint/cli@21` + hook `.husky/commit-msg`. Convention Conventional Commits enforced.
- ✅ **Sprint P8-P9-Menu-Groupe-Cleanup** + **P7-Authz-Solde-Groupe** (2026-05-15) — UI groupe cleanup + 403 serveur-side créateur-only.
- ✅ **Sprint Auto-Balance-Atomic + Phase-B** (2026-05-15) — nouvelle composite RPC `transfer_piggy_to_budget_with_insert` ferme bug latent reversed patterns A+B. `EXPECTED_RPCS` 9 → 10.
- ✅ **Sprint OpenAPI-Schema-To-Docs** (R10, 2026-05-15) — `/api/docs` + `/api/docs/openapi.json` générés depuis schemas Zod. 36 paths / 63 ops.
- ✅ **Sprint P1-Switch-Hebdo-Quotidien** (2026-05-15) — toggle Mois/Semaine/Jour URL `?period=` filtre listing + progress bars budget.
- ✅ **Sprint P2/P3-Closeout-Administrative** (2026-05-15) — closeouts : formule RAV sans `cumulated_savings` + 3 règles RAV déjà toutes implémentées on-the-fly.

**État global** : Score audit estimé ~100/100. Lint baseline 0/0. Tests 485 non-gated / 89 gated. 54 routes API. 10 RPCs pinnées (cf. §5.5 Invariants).
