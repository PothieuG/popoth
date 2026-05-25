# CLAUDE.md — Popoth

> Index opérationnel chargé en début de chaque session Claude Code sur ce repo. Garde-le à jour si une convention change.

## 📏 Règle de taille des fichiers `.md` de contexte

Tous les `.md` du contexte (CLAUDE.md + références sous `.claude/`) doivent rester **entre 35 000 et 39 500 caractères** (`LC_ALL=en_US.UTF-8 wc -m`). **Plafond dur 39.5k** (marge 0.5k sous limite 40k Claude Code). **Plancher 35k**, sauf si naturellement plus court.

**Enforcement automatique** : `pnpm check:md-size` ([scripts/check-md-size.mjs](scripts/check-md-size.mjs)) — invoqué par lint-staged pre-commit, `pnpm verify`, et un PostToolUse hook Claude Code. Si > 39.5k → split (chronologique / thématique / module). Si < 35k + frère proche → fusionner. Détails → [@.claude/guardrails/size-policy.md](.claude/guardrails/size-policy.md).

**Architecture documentaire** — `@` prefix = auto-load ; plain link = on-demand :

- `CLAUDE.md` — index opérationnel + instructions critiques actives
- [.claude/history/](.claude/history/) — score-evolution, sprint-history-security, roadmap-detailed (95 sprints verbatim)
- [.claude/reference/structure-repo.md](.claude/reference/structure-repo.md) — inventaire fichiers annoté
- [.claude/conventions/](.claude/conventions/) — 6 patterns ; auto : operational-rules, operational-rules-ui-modals, git-workflow, typescript ; on-demand : zod-patterns, logs-cleanup
- [@.claude/guardrails/size-policy.md](.claude/guardrails/size-policy.md) — politique 39.5k chars
- `.claude/skills/` — slash commands

## 1. Projet

**Popoth** : PWA francophone **mobile-first** de gestion financière personnelle et en groupe. **Toute UI doit être pensée mobile uniquement** (cible iPhone Safari/Chrome, viewport ≤ 430 px). Domaines clés : budgets estimés, dépenses réelles, économies cumulées, tirelire commune, récap mensuel, transferts inter-budgets.

Prod hébergée sur Supabase (`jzmppreybwabaeycvasz`), dev sur (`ddehmjucyfgyppfkbddr`) — workflow par défaut côté dev ; tous les `scripts/db-*.mjs` ciblent prod par défaut via fallback hardcodé, override `$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'` pour cibler dev (cf. `feedback_supabase_project_target` memory). **Score audit estimé : ~100/100** (baseline 47/100 audit 2026-04). Pour l'évolution détaillée du score sprint par sprint, voir [.claude/history/score-evolution-part-1-47-to-99.md](.claude/history/score-evolution-part-1-47-to-99.md) (+ [part-2](.claude/history/score-evolution-part-2-99-to-100.md)).

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
| `pnpm db:check-rpcs`                       | Vérifie présence des **19 RPCs pinnées** dans `pg_proc`                                                                                   |
| `pnpm db:check-functions`                  | Vérifie présence des 5 fonctions trigger custom                                                                                           |
| `pnpm db:check-types-fresh`                | Vérifie que `database.types.ts` matche prod                                                                                               |
| `pnpm db:audit-functions`                  | Audit générique `pg_proc` ↔ migrations (lance après chaque migration touchant une fonction PL/pgSQL)                                      |
| `pnpm db:audit-objects`                    | Audit générique étendu (functions, types, enums, domains, operators)                                                                      |
| `pnpm verify`                              | **Sanity sweep** : `typecheck + format:check + test:run + 6 db:* checks` fail-fast. ~36s en local. À lancer après chaque sprint.          |
| `pnpm supabase ...`                        | Supabase CLI (lié à `jzmppreybwabaeycvasz`)                                                                                               |
| `node scripts/export-schema.mjs <out.sql>` | Snapshot du schéma prod via API Management (sans Docker)                                                                                  |
| `node scripts/apply-sql.mjs <file.sql>`    | Applique un fichier SQL via API Management (apply migration, SELECT lecture). Voir aussi `clone-data.mjs` pour cloner data inter-projets. |
| `node scripts/seed-recap/<key>.mjs`        | Seede dev DB pour un scénario Monthly Recap V3 (27 keys). Doc + workflow → [scripts/seed-recap/README.md](scripts/seed-recap/README.md).  |

### Hooks Git (Husky)

3 hooks installés : **pre-commit** (`pnpm lint-staged`), **pre-push** (`pnpm lint:check && pnpm typecheck` fail-fast), **commit-msg** (`pnpm exec commitlint`). Bypass `--no-verify` à éviter (cf. §8 ❌). Si hooks ne firent pas après fresh clone : `pnpm exec husky` manuellement.

**Détails workflows Husky + capture-then-drop + DROP + push gate + Dependabot triage** → [@.claude/conventions/git-workflow.md](.claude/conventions/git-workflow.md).

### Tests gated (env var requise, sinon `describe.skipIf` skip)

6 env vars activent les tests gated DB : `SUPABASE_RPC_CONCURRENCY_TESTS` / `_RLS_TESTS` / `_API_TESTS` / `_TRIGGER_TESTS` / `_FINANCE_TESTS` / `_RECAP_TESTS`. Détails par scope → §9 Tests.

## 4. Structure du repo

L'inventaire complet annoté (app/, components/, hooks/, lib/, supabase/, scripts/) est dans [.claude/reference/structure-repo.md](.claude/reference/structure-repo.md). À tenir à jour quand un module est ajouté/supprimé/déplacé.

**Sommaire haut-niveau** :

- `app/` — App Router (pages + API routes)
- `components/` — UI (shadcn/ui sous `components/ui/`), incluant `<DecimalFormInput>`, `<ModalCloseX>`, `DRAWER_CONTENT_CLASSES`
- `contexts/` — `AuthContext` (split en `AuthUserContext` + `AuthActionsContext`)
- `hooks/` — 18 hooks React (TanStack Query majoritairement, post Clean-Slate-Recap)
- `lib/` — modules backend
  - `lib/api/` — `parseBody`/`parseQuery`/`withAuth`/`withAuthAndProfile` + handlers `lib/api/finance/` (12 modules)
  - `lib/finance/` — modules atomiques RPC + helpers (Sprint Refactor-I4, 8 modules)
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
- **Monthly Recap V3** : sprints 01-15/17 livrés (spec `prompt-montly-recap/`, sprint 15 carry-over UI → Part 23). Fondations [lib/recap/](lib/recap/), Zod [lib/schemas/recap.ts](lib/schemas/recap.ts), 10 endpoints `app/api/monthly-recap/*` via `withAuthAndProfile`. **Gating `proxy.ts`** : `/dashboard` + `/group-dashboard` redirigent sur `/monthly-recap?context=X` tant que `isRecapBlocking(status)` ; cookie httpOnly 5min `recap-ok-{ctx}-{Y}-{M}` cache `completed`. Seeds CLI [scripts/seed-recap/](scripts/seed-recap/README.md). **UI sprints 10-14** : wizard shell + 5 steps (BilanPositif/Négatif 12/13 interactifs) + 6 surfaces refloat sous `components/monthly-recap/*` ; hook [hooks/useMonthlyRecap.ts](hooks/useMonthlyRecap.ts) (useQuery + 9 mutations) ; [lib/format-currency.ts](lib/format-currency.ts) (2 décimales). ⚠️ Re-entrée wizard = retour EXACT step + sub-state (cf. memory `feedback_recap_exact_reentry`).
- **Allocation des dépenses** : ordre de priorité **budget restant → savings (cascade UNIQUEMENT si overflow) → piggy JAMAIS auto-débitée** (Sprint P4-P5-P6 strict default). Toggle P5 (`useSavingsToggle: true`) inverse au profit des savings (opt-in user-driven). `calculateBreakdown` dans le module pur [lib/expense-breakdown.ts](lib/expense-breakdown.ts) (séparé de `expense-allocation.ts` pour éviter le bundling de service_role key côté client). L'écriture passe **toujours** par les helpers `lib/finance/*` (RPC atomiques).
- **Auth** : JWT custom signé via `jose` (pas Supabase Auth direct). Cookie `session` validé par `validateSessionToken(request)` dans chaque route API, encapsulé dans `withAuth` / `withAuthAndProfile` (Sprint Refactor-Architecture v3-v5).
- **Globals partagés** : **0 occurrence** `declare global` dans le code.
- **Distinction calculs finance** : [lib/contribution-calculator.ts](lib/contribution-calculator.ts) (budget-allocation, salary-proportional split, pure-sync, consumer = `ProfileSettingsCard.tsx`) ≠ [lib/finance/income-compensation.ts](lib/finance/income-compensation.ts) (income aggregation, async + Supabase, alimente le RAV via `_loadFinancialData`). Les noms sont voisins mais orthogonaux.

## 5.5 Invariants actuels

À tenir à jour à chaque sprint touchant ces invariants.

| Invariant                              | Valeur                    | Source / Vérification                                                                                                    |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `EXPECTED_RPCS`                        | **19**                    | [scripts/check-rpcs.mjs](scripts/check-rpcs.mjs)                                                                         |
| Counter `as unknown as SupabaseClient` | **0**                     | `Grep "as unknown as SupabaseClient"` cross-codebase                                                                     |
| Counter `: any` (hors auto-generated)  | **0**                     | `pnpm lint:check` no-explicit-any                                                                                        |
| Counter `declare global`               | **0**                     | `Grep "declare global"` cross-codebase                                                                                   |
| Lint baseline                          | **0 errors / 0 warnings** | `pnpm lint:check`                                                                                                        |
| Tests non-gated passants               | **661**                   | `pnpm test:run`                                                                                                          |
| Tests gated skipped (sans env vars)    | **203**                   | idem (`SUPABASE_*_TESTS=1` activent)                                                                                     |
| Routes API                             | **41**                    | `pnpm build`                                                                                                             |
| Functions DB versionnées               | **28/28**                 | `pnpm db:audit-functions`                                                                                                |
| Score audit estimé                     | **~100**                  | Voir [.claude/history/score-evolution-part-1-47-to-99.md](.claude/history/score-evolution-part-1-47-to-99.md) (+ part-2) |

## 6. Conventions

### UI / Mobile-first

**Toute UI doit être pensée mobile uniquement**. Cible viewport iPhone Safari/Chrome, largeur ≤ 430 px. Pas de breakpoints `md:`/`lg:`/`xl:` "pour le desktop". Un layout qui décale en mobile (texte qui pousse le navbar, modal qui déborde, table non-scrollable) est un bug bloquant. Tester en DevTools mobile viewport avant push. Pour les textes longs dans les zones contraintes (navbar, badges) : tronquer + tooltip via `title=` natif.

### API

- Format réponse : **`{ data: T } | { error: string }`** sur toutes les routes
- Auth invalide : `401` + `{ error: 'Session invalide' }`
- Debug-route en prod : `404` (pas 403, pour ne pas révéler l'existence)
- **Pattern obligatoire** (routes `/api/debug/*` uniquement) : `blockInProduction()` en première instruction → `validateSessionToken(request)` + 401 si invalide → try/catch + 500 fallback. Exemple complet dans `git-workflow.md` ou voir route existante.
- Handlers non-debug : wrapper `withAuth(handler)` / `withAuthAndProfile(handler)` ([lib/api/with-auth.ts](lib/api/with-auth.ts), 34 modules). Le second fetch `select('id, group_id, first_name, last_name')` et passe `{ userId, profile }`. Routes dynamiques : `withAuth<TParams>(async (req, ctx, routeContext) => { const { id } = await routeContext.params })`.
- **Hors scope wrapper** : `app/api/debug/**` (blockInProduction wrap d'abord), `app/api/auth/**` (créent la session).

### Validation Zod

Le repo utilise Zod pour valider 100% des bodies API et form clients via `parseBody`/`parseQuery` + `react-hook-form` + `zodResolver`. **Patterns A–H standardisés** dans [.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md).

**Pour ajouter une route** : déclarer schema dans `lib/schemas/<domain>.ts` + brancher via `parseBody(request, schema)` + `handleBadRequest(error)` au top du catch (avant le 500 fallback). Pas de validation manuelle subséquente. Exemple serveur complet dans [.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md) §2.

**Pour les forms client** : pattern dual-type `useForm<FormInput, undefined, FormOutput>` (Pattern A) avec `<DecimalFormInput>` composant réutilisable pour décimaux fr-FR (comma→dot). Voir [.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md) pour les 8 patterns standardisés et la liste des routes/forms migrés par sprint.

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

Format obligatoire : `// eslint-disable-next-line <rule> -- <raison explicite>` (double-tiret + raison). **Ne PAS** utiliser sans raison ni `// eslint-disable` (sans `-next-line`) au top du fichier. Exemples installés : `react-hooks/exhaustive-deps` sur fetchers mount-only, `@next/next/no-img-element` sur UserAvatar (Supabase Storage remote hosts).

### Format / Prettier

Config [.prettierrc.json](.prettierrc.json) : `semi:false`, `singleQuote:true`, `trailingComma:'all'`, `printWidth:100`, `tabWidth:2`, `endOfLine:'lf'`, plugin `prettier-plugin-tailwindcss`. Ignore auto-gen (`lib/database.types.ts`, `next-env.d.ts`). **Ne PAS lancer** `pnpm format` dans PR feature (diff mécanique massif) — `lint-staged` formate les staged au commit.

### Logs

Logger central : [lib/logger.ts](lib/logger.ts). 4 niveaux `error/warn/info/debug`. Gated via `LOG_LEVEL` env (défaut `warn` prod / `debug` dev). Strip prod automatique via SWC `compiler.removeConsole` (exclude `error`/`warn`).

ESLint global `'no-console': ['error', { allow: ['warn', 'error'] }]` (Sprint Cleanup-I8 / Lot 6, activé 2026-05-14). Tout nouveau `console.log` fait sortir la PR rouge.

**Règle d'or de triage** pour tout `console.*` : (a) outer catch-all → **DROP** (Vercel capture la stack) ; (b) DB error inline discriminant → **KEEP+migrate** `logger.error` (grep-able) ; (c) erreur silencieusement avalée → **KEEP+migrate** ; (d) cleanup-attempt critique → **KEEP+migrate**. Pour ton code : préfère `logger.debug/info`. Détails Lot 1-6 + per-file overrides → [.claude/conventions/logs-cleanup.md](.claude/conventions/logs-cleanup.md).

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

### Interaction utilisateur

**Questions au user** (`AskUserQuestion` / texte) : vocabulaire **métier**, jamais jargon tech, avec contexte business + impact concret par option. Détails → [@.claude/conventions/user-questions.md](.claude/conventions/user-questions.md).

## 7. Sécurité — état des lieux

Historique détaillé des 15 sprints sécurité (Sprint 0 → Refactor-Architecture, livrés 2026-05-06/08) dans [.claude/history/sprint-history-security-part-1-foundation-ci.md](.claude/history/sprint-history-security-part-1-foundation-ci.md) + [part-2](.claude/history/sprint-history-security-part-2-quality-architecture.md). État résumé :

- ✅ **Sprints 0 / DB / Refactor / Hardening** : `ignoreBuildErrors` retiré (C1), 20 routes debug `blockInProduction` (C2), 4 RPC atomiques C3, RLS `piggy_bank` (D1), policies group_contributions + remaining_to_live_snapshots fixées (D2/D3), baseline schéma versionné (D5), `createClient<Database>` wirage (R2), `pnpm db:check-drift` (R4), 17 scope-casts unwound + 3 bugs surfacés (H1), ~~H3 overdraft~~ retiré 2026-05-25, `pnpm db:check-rpcs` (H4).
- ✅ **Sprints Polish → Stabilize-Deps** (9 sprints) : consolidations CI / db-audit / dependabot.

**Drift C3 résolu** ([post-mortem](doc2/audit/POST-MORTEM-C3-DRIFT.md)) : filet = `pnpm db:check-drift` + `db:check-rpcs` + `db:check-types-fresh` + tests gated `SUPABASE_RPC_CONCURRENCY_TESTS=1`.

## 8. À FAIRE / À NE PAS FAIRE

> Listes condensées. Pour chaque pattern : précédents (Path B closed-by-deletion, god-files extractions, cleanup-attempts CRITIQUES préservés, chronologie sprint) → [@.claude/conventions/operational-rules.md](.claude/conventions/operational-rules.md).

### ✅ À faire

- **Body POST/PATCH/PUT** : schema dans `lib/schemas/<domain>.ts` + `parseBody(request, schema)` + `handleBadRequest(error)` (cf. §6). Préférer `z.discriminatedUnion` / `z.union + type guard` / `.refine`.
- **Écriture sur colonnes sensibles** (`piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings`) : **obligatoirement** via composite RPCs `lib/finance/*`. Mapping smart-allocation / cross-budget cascade / savings ↔ budget / piggy ↔ budget → [operational-rules.md](.claude/conventions/operational-rules.md) §4.
- **Calcul breakdown client** : `calculateBreakdown` depuis [lib/expense-breakdown.ts](lib/expense-breakdown.ts) (pur). **Jamais** `expense-allocation.ts` (leak service_role).
- **Composant auth** : `useAuthUser()` / `useAuthActions()` / hooks composés `useRequireGuest`/`useLogin`/`useLogoutAndRedirect`. Pas de `useAuth()` aggregator (supprimé v5).
- **Magic numbers** (TTL, intervalle, tolérance) : déclarer dans [lib/constants/](lib/constants/) avant usage.
- **Nouvelle route API finance** : handler dans `lib/api/finance/<route>.ts` + `route.ts` ré-exporte.
- **Nouveau handler API** : `withAuth(handler)` / `withAuthAndProfile(handler)` (cf. §6).
- **Middleware / Edge runtime** : pas de `fetch` self-call HTTP. Extraire en lib pure + import direct. Vérifier transitifs Edge-safe.
- **Fetch composant** : **TanStack Query** (`useQuery`/`useMutation`). Cross-domain → `invalidateFinancialRefreshes` depuis [@/lib/query-client](lib/query-client.ts). Mutations changeant `profile.group_id` invalident aussi `['profile']` + `['groups']`.
- **Modal forms mirror prop** : `key={editing.id}` + `useState(() => ...editing.foo)` lazy + parent `{isOpen && editing && <Modal ... />}` (Sprint 1.5 standard).
- **`useReducer`** : extraire reducer + types module dédié sans `'use client'` (pattern [contexts/auth-reducer.ts](contexts/auth-reducer.ts)). Context value via useReducer → wrapper `useMemo` slice-by-slice.
- **Nouvelle route `/api/debug/*`** : `blockInProduction()` en première instruction.
- **Form client a11y** : `aria-describedby` + `id` sur erreur (id-prefix par form) ; `role="alert"` sur serverError ; `onInvalidSubmit` → `form.setFocus(Object.keys(errors)[0])` ; close X svg-only → `type="button"` + `aria-label="Fermer"` + `aria-hidden="true"` sur `<svg>`.
- **Modal Radix-migré** : close X via `<ModalCloseX onClose variant="circle"|"ghost" />` (v10). Drawer fullscreen → `DRAWER_CONTENT_CLASSES` (v9). Test focus-trap → helper `expectEscClose()` (v10).
- **Feedback transient post-mutation** : snackbar fixed bottom `z-[60]` (au-dessus drawer z-50) + `animate-in slide-in-from-bottom-4` + auto-dismiss 3s + `role="status"`. Mobile-safe `w-[calc(100%-2rem)] max-w-sm`. Pas de bandeau in-flow. Cf. [ProfileSettingsCard.tsx](components/profile/ProfileSettingsCard.tsx).
- **DB ops** : Nouvelle RPC = `SECURITY DEFINER` + `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` + `SET search_path = public` + `NOTIFY pgrst`. Migration fonction → `pnpm db:audit-functions`. CREATE TYPE/DOMAIN → `db:audit-objects`. DROP / capture rétroactive prod → workflow strict ([git-workflow.md](.claude/conventions/git-workflow.md) §5-6). **NE PAS** `supabase db push` pour capture rétroactive.
- **Push gate prod** : `db push --dry-run` → STOP → `db push` → re-audit → commit. Régénérer types `pnpm db:types` + `db:check-types-fresh`. Migration non-triviale → `db:check-drift`, si exit 1 re-exporter baseline.
- **PR Dependabot mergée** : `git pull` + `pnpm install` + `pnpm verify` + `pnpm dev` smoke. Fix-forward plutôt que `git revert -m 1` ([git-workflow.md](.claude/conventions/git-workflow.md) §9).

### ❌ À ne pas faire

**Architecture / modals / Zod**

- **Modal/drawer raw** `<div className="fixed inset-0 ...">` → `<Dialog>` + `<DialogContent>` Radix (v8). Pas de raw button + SVG `M6 18L18 6M6 6l12 12` → `<ModalCloseX>` (v10).
- **`window.location.reload()` après mutation TanStack Query**. `onSuccess` fait `setQueryData(key, newData)` → les consumers re-render. Le reload casse le drawer/modal/state UX (cas vu sur avatar update 2026-05-18).
- **`await request.json()` direct** sans `parseBody` dans les routes Zod-migrated. Pas de `if (typeof X !== 'number' || X <= 0)` après parseBody.
- **Réintroduire `lib/financial-calculations.ts`** (splitté en 8 modules `lib/finance/` au Refactor-I4).
- **Exports supprimés Dead-Code-Purge** ou **server route `/auth/confirm` / auto-`verifyOtp()` / `{{ .ConfirmationURL }}` Supabase** (cf. [operational-rules.md](.claude/conventions/operational-rules.md) §1+§7).

**Sémantique RAV / breakdown**

- **`cumulated_savings` dans la formule RAV**. Canonique : `totalIncomeContribution + exceptionalIncomes - estimatedBudgets - exceptionalExpenses - budgetDeficits`. `totalSavings` exposé séparément.
- **Dépendre de `estimated_budgets.monthly_surplus_deficit`** comme source de `budgetDeficits` — calculé **on-the-fly** via `calculateBudgetDeficit`.
- **Cascade-aggressive piggy→savings→budget** dans `calculateBreakdown`. P4 strict = budget priorité 1, savings cascade uniquement si overflow, **piggy JAMAIS auto-débitée**. Toggle P5 opt-in.
- **Wizard single-step `AddTransactionModal`** — 2-step requis pour P6.

**Patterns DB non-atomiques (composite RPCs requis)**

- **Appels directs `updatePiggyBank` + `updateBudgetCumulatedSavings` + `INSERT real_expenses`** séparés en smart-allocation → `addExpenseWithBreakdown`.
- **2 RPCs séquentielles + manual rollback** dans `savings/transfer` → `transferSavingsBetweenBudgets` / `transferBudgetToPiggyBank`. `handlePiggyBankAction` supprimé v2 (0 consumer).
- **Pattern reversed `for(savingsUpdates) updateBudgetCumulatedSavings → INSERT batched`** → `transferWithSavingsDebit` per-pair.
- **Pattern reversed `updatePiggyBank(aggregate) + INSERT batched (from_budget_id=NULL)`** → `transferPiggyToBudgetWithInsert` per-pair (Phase-B).

**Forbidden absolus**

- **Modifier** [supabase/migrations/20260506000000_create_finance_rpcs.sql](supabase/migrations/20260506000000_create_finance_rpcs.sql) — corriger via `CREATE OR REPLACE` dans nouvelle migration.
- **`any`** dans nouveau code. **`console.log` ajouté** → `logger.debug/info`. **Mocker la DB** dans tests d'intégration.
- **Commiter** de secret. `.env.local` + `.claude/settings.local.json` gitignored.
- **Réactiver** `typescript.ignoreBuildErrors`. **Upgrader `eslint-config-next` 15→16** (déjà fait, ignore rule en place).
- **Écrire des docs `.md`** sans demande explicite (sauf CLAUDE.md, RLS-FINDINGS, sous-fichiers `.claude/`).
- **Écrire la phrase littérale `eslint-disable-next-line`** dans un commentaire qui n'est PAS un disable directive (ESLint la parse comme rule "directive.").
- **Trigger / handler-side cleanup pour FK** avant d'avoir vérifié `ON DELETE SET NULL` / `ON DELETE CASCADE` existant.
- **Réintroduire `middleware.ts`** — la file convention Next.js est renommée `proxy.ts` au Next 16 (runtime nodejs non-edge non-configurable). Sprint Hygiene-Next-16-Migration 2026-05-20.
- **`pnpm self-update`** sans target version explicite — bumpe silencieusement le pin `packageManager` à la dernière version (incident 2026-05-20 : pnpm@9.15.5 → pnpm@11.1.3 avec install incomplet `bin/` shims absents → ENOENT). Pattern correct : `pnpm self-update <version>` ou edit `package.json` `packageManager` manuellement + `pnpm install`.

## 9. Tests

- **Vitest 4.1.5** avec `test.projects` split env=node (`*.test.ts`) / env=jsdom (`*.test.tsx`) — évite régression perf x23. Tests à côté du code (`.test.ts`/`.test.tsx` ou `__tests__/`). CI auto-run via [code-checks.yml](.github/workflows/code-checks.yml) sur PR + push `cleanup`.
- **Total** : 447 non-gated + 158 gated skipped (sans env vars).

### Tests gated DB (env var requise)

- **SUPABASE_RPC_CONCURRENCY_TESTS=1** : atomicité RPCs sous 100× concurrence (rpc-concurrency, transfer-with-savings 4, add-expense-with-breakdown 6, transfer-savings 8, transfer-piggy-to-budget-with-insert 4, delete-budget-with-savings-transfer 8).
- **SUPABASE_RLS_TESTS=1** : isolation cross-user.
- **SUPABASE_API_TESTS=1** : régressions H1/H2/R2 + withAuth wrapper (12 cas).
- **SUPABASE_TRIGGER_TESTS=1** : 4 fonctions trigger A2 + FK ON DELETE SET NULL.
- **SUPABASE_FINANCE_TESTS=1** : 6 cas profile/group golden math + round-trip RAV + 11 cas planner-emptiness (Sprint Salary-Edit-Gating 2026-05-25).
- **SUPABASE_RECAP_TESTS=1** : 78 cas V3 (sprints 05-08 : start/status 13, transfer/transform 15, refloat/save-snapshot 24, update-salaries/complete 18) + 8 `checkRecapStatus`. Détails Part 19-21.

### Tests non-gated par module

Couverture par dossier : `lib/finance/` (calc-rtl 19 + snapshots 5), `lib/api/` (parse-body 9, finance/expenses-add-with-logic 5 PIN ATOMIC CONTRACT), `app/api/savings/transfer/` (4 PIN ATOMIC CONTRACT), `app/api/monthly-recap/` (sprint 05 V3 : 13 gated start+status ; sprint 06 V3 : 15 gated transfer+transform ; sprint 07 V3 : 24 gated refloat-piggy/refloat-savings/save-snapshot, `withAuthAndProfile` mocké), `lib/schemas/` (10 fichiers : 9 post Clean-Slate + recap V3 41 cas), `lib/recap/` (state.ts 17 cas + calculations.ts 33 cas + actions-negative.ts 12 cas pure deficit helpers + 8 gated check-status), `lib/__tests__/` (auth-reducer 14 + logger 11 + contribution-calculator 8 + query-client), `components/__tests__/` (a11y-audit 19 dont 12 focus-trap `expectEscClose`), `components/ui/__tests__/` (DecimalFormInput 8 + ModalCloseX 4), RTL forms (64+ cas / 15 fichiers).

### Patterns techniques

- **Gated tests** : `await import(...)` dans `beforeAll` (load lazy), `chunked` helper pour batch 10× appels (pool undici), cleanup cascade obligatoire dans `afterAll` (FK → profiles sans CASCADE).
- **RTL** : mock-per-site inline `vi.mock(...)`. UUIDs valides obligatoires dans fixtures FK. CustomDropdown mocké en `<select>`.
- **a11y regression-guards** : `toHaveAttribute('aria-describedby', 'X')` + `toHaveFocus()` ; `axe(container).violations.toEqual([])` direct (pivot vitest 4.x).

### Sanity sweep

`pnpm verify` (DX-Verify / G1) : `typecheck` + `test:run` + 6 `db:*` checks fail-fast. ~36s local. Tests gated skip-friendly sans env vars.

Détails Zod-client (Pattern A-H, useRavValidation, factory refines) → [.claude/conventions/zod-patterns.md](.claude/conventions/zod-patterns.md).

## 10. Variables d'environnement

`.env.local` (gitignored) doit contenir :

```
NEXT_PUBLIC_SUPABASE_URL=https://jzmppreybwabaeycvasz.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<...>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>     # utilisé par lib/supabase-server.ts
JWT_SECRET_KEY=<...>                 # utilisé par lib/session.ts
LOG_LEVEL=debug                      # optionnel — error|warn|info|debug, défaut warn en prod / debug en dev
NEXT_PUBLIC_SITE_URL=<...>           # REQUIS en prod (cf. lib/site-url.ts)
```

Pour les opérations CLI Supabase :

```
SUPABASE_ACCESS_TOKEN=sbp_...        # https://supabase.com/dashboard/account/tokens
SUPABASE_DB_PASSWORD=...             # Project Settings > Database > Reset password si oublié
SUPABASE_PROJECT_REF=ddehmjucyfgyppfkbddr  # optionnel — override le default prod (jzmppreybwabaeycvasz) pour pointer dev
```

Ces deux derniers sont à passer en variables inline (`SUPABASE_ACCESS_TOKEN=... pnpm supabase ...`) ou persistés au niveau User env (`[Environment]::SetEnvironmentVariable(...)`), **jamais** committés dans un fichier.

> 🚨 **Règle absolue (sécurité)** : Claude **ne doit JAMAIS lire la valeur** de `SUPABASE_ACCESS_TOKEN` ni `SUPABASE_DB_PASSWORD` (ni de tout autre secret du `.env.local`).
>
> - ❌ **Interdit** : `Write-Output $env:SUPABASE_ACCESS_TOKEN`, `echo $env:SUPABASE_DB_PASSWORD`, `Get-Content .env.local`, ou toute commande qui rend la valeur visible dans le transcript.
> - ✅ **Autorisé** : test de présence binaire (`if ($env:SUPABASE_ACCESS_TOKEN) { "OK" } else { "MISSING" }`) — ne révèle pas la valeur.
> - ✅ **Autorisé** : laisser les scripts (`apply-sql.mjs`, `export-schema.mjs`, `check-rpcs.mjs`) lire `process.env.SUPABASE_ACCESS_TOKEN` en interne — la valeur ne transite pas par stdout/stderr.
> - **Si une commande échoue avec "TOKEN_MISSING"** : demander à l'utilisateur de le set lui-même via `[Environment]::SetEnvironmentVariable(...)` puis redémarrer Claude Code. **Ne jamais** lui demander de coller le secret dans le chat.

## 11. Roadmap

**État global** : Score ~100/100. Lint 0/0. Tests 661/203. 41 routes API. 19 RPCs + 28 fn (§5.5). **Monthly Recap V3** sprints 01-17 livrés (cf. §5 + Part 24). Récents : Salary-Edit-Gating (25), Wizard-Flicker-Fix (26), Recap-Positive-Consume-Surplus (27).

**Historique** — 27 parts `.claude/history/roadmap-detailed-NN-*.md` (128 sprints) :

- [Part 01](.claude/history/roadmap-detailed-01-sprint-0-to-architecture-v5.md) Sprint 0 → Refactor-Architecture-v5 (24) | [Part 02](.claude/history/roadmap-detailed-02-sprint-1-to-cleanup-lot-1.md) Sprint 1 → Lot 1 (11) | [Part 03](.claude/history/roadmap-detailed-03-lot-3-to-refactor-i5-followup-v2.md) Lot 3 → Refactor-I5-followup-v2 (8) | [Part 04](.claude/history/roadmap-detailed-04-followup-v3-to-atomicity-savings-v2.md) Refactor-I5-followup-v3 → Atomicity-Savings v2 (5)
- [Part 05](.claude/history/roadmap-detailed-05-dead-code-to-lot-4b.md) Dead-Code-Purge → Lot 4b (6) | [Part 06](.claude/history/roadmap-detailed-06-lot-4c-to-lot-5d.md) Lot 4c → Lot 5d (7) | [Part 07](.claude/history/roadmap-detailed-07-audit-c2-to-zod-v3.md) Audit-Closeout C2 → Zod v3 (6) | [Part 08](.claude/history/roadmap-detailed-08-zod-v4-to-zod-v8.md) Zod v4 → v8 (5)
- [Part 09](.claude/history/roadmap-detailed-09-zod-v9-to-tailwind-v4.md) Zod v9 → Tailwind-v4 (5) | [Part 10](.claude/history/roadmap-detailed-10-p10-to-auto-balance-atomic.md) P10 → Auto-Balance-Atomic (7) | [Part 11](.claude/history/roadmap-detailed-11-phase-b-to-commitlint.md) Phase-B → Commitlint (6) | [Part 12](.claude/history/roadmap-detailed-12-cas3-to-refactor-recover.md) Complete-CAS3-TestFix → Fix-Password-Reset-OTP (7) | [Part 13](.claude/history/roadmap-detailed-13-fix-empty-recap-tirelire.md) Fix-Empty-Recap-Tirelire → Drawer-Slide-Fix-And-Header-Harmonize (6) | [Part 14](.claude/history/roadmap-detailed-14-modal-uniformize-polish-dropdown.md) Modal-Uniformize → Fix-Dashboards-Navbar-Switch (6) | [Part 15](.claude/history/roadmap-detailed-15-skeleton-refetch-loaders.md) Skeleton-Refetch → Cache fix (3) | [Part 16](.claude/history/roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md) Expense-Preview-Posé-Layout → Recap-Compact-And-Uniform (4) | [Part 17](.claude/history/roadmap-detailed-17-delete-header-income-polish.md) Delete-Header-And-Income-Polish → Fix-Auth-Flicker-And-Recap-Reentry-Gate (4) | [Part 18](.claude/history/roadmap-detailed-18-modal-enter-block.md) Modal-Forms-Block-Enter-Submit → Calculations-V3 (5) | [Part 19](.claude/history/roadmap-detailed-19-endpoints-start-status.md) Endpoints-START-STATUS-V3 → Endpoints-Negative-Flow-V3 (3) | [Part 20](.claude/history/roadmap-detailed-20-salary-finalize.md) Endpoints-Salary-Update-And-Finalize-V3 → Wizard-Shell-Lock-Screen-V3 (3) | [Part 21](.claude/history/roadmap-detailed-21-screens-welcome-summary.md) Screens-Welcome-Summary-V3 → Screen-Bilan-Positive-V3 (3) | [Part 22](.claude/history/roadmap-detailed-22-screen-bilan-negative.md) Sprints 13-14 V3 (2) | [Part 23](.claude/history/roadmap-detailed-23-carry-over.md) Sprint 15 carry-over (1) | [Part 24](.claude/history/roadmap-detailed-24-contribution.md) Sprint 16 + Contribution (8) | [Part 25](.claude/history/roadmap-detailed-25-salary-edit-gating.md) Salary-Edit-Gating (1) | [Part 26](.claude/history/roadmap-detailed-26-wizard-flicker-fix.md) Recap-Wizard-Flicker-Fix → Fix-Welcome-Skip (2)

**Évolution du score** : [part-1 47→99.998](.claude/history/score-evolution-part-1-47-to-99.md) + [part-2 99.999→100](.claude/history/score-evolution-part-2-99-to-100.md).
**Historique sécurité Sprint 0 → Refactor-Architecture** : [part-1 foundation/CI](.claude/history/sprint-history-security-part-1-foundation-ci.md) + [part-2 quality/architecture](.claude/history/sprint-history-security-part-2-quality-architecture.md).
