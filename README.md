# Popoth

> Application web (PWA) francophone de gestion financière personnelle et en groupe.

Popoth aide un foyer ou un groupe à piloter mensuellement ses budgets : revenus estimés vs réels, dépenses planifiées vs réelles, économies cumulées par budget, tirelire commune, et un workflow de récap mensuel qui réconcilie le tout. La logique métier (allocation des dépenses, transferts inter-budgets, RAV — _reste à vivre_) est centralisée côté serveur ; le client est une PWA Next.js.

**Public cible** : un développeur seul ou en duo qui veut suivre ses finances avec des règles métier explicites (ordre d'imputation tirelire → économies budget → budget restant) plutôt qu'un agrégateur bancaire commercial.

---

## Sommaire

- [Stack](#stack)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commandes](#commandes)
- [Structure du projet](#structure-du-projet)
- [Architecture](#architecture)
- [Modèle de données](#modèle-de-données)
- [Tests & qualité](#tests--qualité)
- [Sécurité](#sécurité)
- [Déploiement](#déploiement)
- [Documentation](#documentation)
- [Conventions](#conventions)
- [Contribution](#contribution)
- [Licence](#licence)

---

## Stack

| Couche          | Technos                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | **Next.js 16.2.6** (App Router, webpack en dev / Turbopack en build)                                                               |
| UI              | **React 19.1.1**, **Tailwind 4** (CSS-first config dans `app/globals.css` `@theme`), **shadcn/ui** (variant new-york)              |
| Data fetching   | **TanStack Query 5.100.9** (`@tanstack/react-query` + devtools dev-only)                                                           |
| Langage         | **TypeScript 5** strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`)                                                       |
| Backend         | API routes Next.js + **Supabase** (PostgreSQL + Auth) (`@supabase/supabase-js@^2.105.4`)                                           |
| Auth            | JWT custom (`jose`) — pas Supabase Auth direct                                                                                     |
| Tests           | **Vitest 4.1.5** avec `test.projects` split (env `node` pour `*.test.ts` + env `jsdom` pour `*.test.tsx` RTL) + `@testing-library` |
| Validation      | **Zod 4.4.3** (schemas serveur `lib/schemas/` + helpers `parseBody`/`parseQuery`) + **react-hook-form** + **@hookform/resolvers**  |
| Lint / Format   | **ESLint 9.39.4** + **eslint-config-next 16.2.6** (flat config natif) + **Prettier 3.8.3** + `prettier-plugin-tailwindcss`         |
| Hooks Git       | **Husky 9** — `pre-commit` (lint-staged) + `pre-push` (`lint:check && typecheck`) + `commit-msg` (commitlint)                      |
| Package manager | **pnpm 9.15.5** (verrouillé via `packageManager` + `engines.pnpm`), Node ≥ 20.10.0 (`.nvmrc` pinné `20` LTS)                       |

---

## Prérequis

- [Node.js](https://nodejs.org/) ≥ 20.10 (utilisateurs `nvm` : `nvm use` lit [`.nvmrc`](./.nvmrc) qui pin sur la LTS major `20`)
- [pnpm](https://pnpm.io/) 9.x (`corepack enable && corepack prepare pnpm@9.15.5 --activate`)
- Un projet [Supabase](https://supabase.com/) (URL + clés service_role et anon)

Optionnel pour les opérations DB hors-app :

- Un [access token Supabase](https://supabase.com/dashboard/account/tokens) (`sbp_…`) pour scripts en API Management.
- Un mot de passe DB (Project Settings > Database > Reset password) pour `pnpm supabase ...`.

---

## Installation

```bash
git clone git@github.com:PothieuG/popoth.git
cd popoth
pnpm install
cp .env.example .env.local        # voir Configuration
pnpm dev                          # http://localhost:3000
```

> **Note historique** : le repo s'appelait `Popoth_App_Claude` jusqu'au rename Sprint Cleanup-Legacy / C3. GitHub redirige encore l'ancien URL ; nouveau clone → utiliser `popoth.git` directement.

---

## Configuration

`.env.local` (gitignored) doit contenir :

```ini
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...     # utilisé par lib/supabase-server.ts (bypass RLS)

# Auth (JWT custom)
JWT_SECRET_KEY=...
```

> Multi-environnement (prod + staging `dev`) : `.env.local` contient les deux jeux de clés, un seul bloc actif. Détails dans [`.claude/conventions/multi-env.md`](./.claude/conventions/multi-env.md).

Variables inline (jamais dans un fichier committé) pour les opérations CLI/scripts :

```ini
SUPABASE_ACCESS_TOKEN=sbp_...     # pour scripts/{export-schema,apply-sql,check-*}.mjs
SUPABASE_DB_PASSWORD=...          # pour pnpm supabase db push
```

Les tests gated lisent leurs propres variables : `SUPABASE_RPC_CONCURRENCY_TESTS=1`, `SUPABASE_RLS_TESTS=1`, `SUPABASE_API_TESTS=1`, `SUPABASE_TRIGGER_TESTS=1`, `SUPABASE_FINANCE_TESTS=1`, `SUPABASE_RECAP_TESTS=1`.

---

## Commandes

| Commande                                   | Effet                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm dev`                                 | Serveur dev Next.js (webpack, HMR)                                                     |
| `pnpm build`                               | Build production (Turbopack)                                                           |
| `pnpm start`                               | Serveur production (après `build`)                                                     |
| `pnpm typecheck`                           | `tsc --noEmit` strict (BLOQUANT en CI)                                                 |
| `pnpm lint` / `pnpm lint:fix`              | ESLint avec `--fix`                                                                    |
| `pnpm lint:check`                          | ESLint sans modification — **BLOQUANT** CI, baseline 0 errors / 0 warnings             |
| `pnpm format`                              | Prettier `--write` (idempotent ; **ne pas lancer dans une PR feature** — diff massif)  |
| `pnpm format:check`                        | Prettier `--check` — **BLOQUANT** CI                                                   |
| `pnpm run ci`                              | `typecheck` + `lint:check` + `format:check` + `test:run` + `build`                     |
| `pnpm test` / `pnpm test:run`              | Vitest watch / single run (CI)                                                         |
| `pnpm test:coverage`                       | Vitest avec rapport couverture v8 (écrit dans `coverage/`, gitignored)                 |
| `pnpm db:types`                            | Régénère [`lib/database.types.ts`](./lib/database.types.ts) depuis le schéma prod      |
| `pnpm db:check-drift`                      | Compare prod ↔ baseline `20260101000000_remote_schema.sql`                             |
| `pnpm db:check-rpcs`                       | Vérifie via `pg_proc` les **29 RPC finance** pinnées (cf. `scripts/check-rpcs.mjs`)    |
| `pnpm db:check-functions`                  | Vérifie via `pg_proc` les 5 fonctions trigger custom                                   |
| `pnpm db:check-types-fresh`                | Vérifie que `lib/database.types.ts` correspond au schéma prod actuel                   |
| `pnpm db:audit-functions`                  | Audit générique : toutes les `public.*` fonctions vs `supabase/migrations/` (44/44)    |
| `pnpm db:audit-objects`                    | Audit étendu : functions, composite types, enums, domains, operators                   |
| `pnpm verify`                              | **Sanity sweep** : `typecheck` + `test:run` + les 6 `db:*` checks (fail-fast, ~36s)    |
| `pnpm pwa:assets`                          | Régénère apple-icon + icons manifest + splash iPhone (sharp)                           |
| `pnpm supabase ...`                        | CLI Supabase (lié au projet distant)                                                   |
| `node scripts/export-schema.mjs <out.sql>` | Snapshot du schéma prod via API Management                                             |
| `node scripts/apply-sql.mjs <file.sql>`    | Applique un .sql (write OU SELECT lecture seule)                                        |
| `node scripts/seed-recap/<key>.mjs`        | Seede la DB dev pour un scénario Monthly Recap V3 (cf. `scripts/seed-recap/README.md`) |

**Tests gated** (la suite skip sans la variable, donc la CI standard reste rapide) :

```bash
SUPABASE_RPC_CONCURRENCY_TESTS=1 pnpm test:run   # atomicité des RPCs composites sous 100× concurrence
SUPABASE_RLS_TESTS=1             pnpm test:run   # isolation cross-user (RLS)
SUPABASE_API_TESTS=1             pnpm test:run   # régressions API + wrapper withAuth
SUPABASE_TRIGGER_TESTS=1         pnpm test:run   # fonctions trigger + FK ON DELETE
SUPABASE_FINANCE_TESTS=1         pnpm test:run   # golden math profile/group + RAV
SUPABASE_RECAP_TESTS=1           pnpm test:run   # Monthly Recap V3 (start/status/transfer/refloat/complete)
```

---

## Structure du projet

Vue d'ensemble dans [`CLAUDE.md`](./CLAUDE.md) §4 ; **inventaire complet annoté** (app/, components/, hooks/, lib/, supabase/, scripts/) maintenu dans [`.claude/reference/structure-repo.md`](./.claude/reference/structure-repo.md).

Résumé haut-niveau : `app/` (App Router — pages + API routes), `components/` (UI shadcn/ui), `contexts/` (Auth), `hooks/` (TanStack Query), `lib/` (backend : `lib/api/`, `lib/finance/`, `lib/recap/`, `lib/schemas/`, `lib/openapi/`, `lib/logger.ts`), `supabase/migrations/`, `scripts/` (outils API Management + seeds).

---

## Architecture

Détails dans [`CLAUDE.md`](./CLAUDE.md) §5 (architecture critique) + §5.5 (invariants chiffrés). Points saillants :

- **2 clients Supabase** : `lib/supabase-server.ts` (service_role, **bypass RLS** — toutes les routes API) et `lib/supabase-client.ts` (anon, **soumis à RLS** — browser via hooks).
- **Auth** : JWT custom signé via `jose`, cookie `session` validé par les wrappers `withAuth` / `withAuthAndProfile`.
- **Écritures DB sensibles** (`piggy_bank.amount`, `bank_balances.balance`, `estimated_budgets.cumulated_savings`) : **toujours** via des composite RPCs `lib/finance/*` (atomiques, `SECURITY DEFINER`).
- **Monthly Recap V3** (`lib/recap/` + wizard `components/monthly-recap/`) et **Projets d'épargne** (`savings_projects`) : features livrées — détail dans CLAUDE.md §5 + closeouts `.claude/history/`.

---

## Modèle de données

Carte complète des tables, RPC atomiques, indexes, FK et triggers prod : [`doc2/db/SCHEMA.md`](./doc2/db/SCHEMA.md). Types TypeScript générés : [`lib/database.types.ts`](./lib/database.types.ts) (régénérés via `pnpm db:types`, vérifiés par `pnpm db:check-types-fresh`). Référence API : [`doc2/api/README.md`](./doc2/api/README.md) + Swagger live sur `/api/docs`.

---

## Tests & qualité

Stack + conventions détaillées dans [`CLAUDE.md`](./CLAUDE.md) §9. Résumé :

- **Vitest 4** (`test.projects` split node/jsdom), tests à côté du code (`*.test.ts` / `*.test.tsx` / `__tests__/`).
- `pnpm test:run` lance la suite non-gated ; les suites d'intégration DB s'activent via les 6 env vars `SUPABASE_*_TESTS=1` (cf. Commandes) et créent de vraies données — à lancer manuellement, jamais en CI.
- **Gates bloquantes CI** : `pnpm typecheck` + `pnpm lint:check` (baseline 0/0) + `pnpm format:check`.
- **Sanity sweep complet** après chaque sprint : `pnpm verify`.

---

## Sécurité

État des lieux dans [`CLAUDE.md`](./CLAUDE.md) §7 + historique sécurité dans [`.claude/history/`](./.claude/history/). Points clés :

- Le RLS n'est exploitable que côté **client anon** ; toutes les routes API passent par le client service_role (bypass RLS).
- Toute écriture sur une colonne financière sensible passe par une RPC atomique `SECURITY DEFINER` (`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role`).
- Routes `/api/debug/*` bloquées en production (`blockInProduction()` → 404).
- Secrets jamais committés (`.env.local` gitignored). Push gate DB + workflows capture/drop : [`.claude/conventions/git-workflow.md`](./.claude/conventions/git-workflow.md).

---

## Déploiement

Vercel (Next.js) + Supabase managed, en **multi-environnement** : **prod** (`main` → projet Supabase `jzmppreybwabaeycvasz`) et **staging** (`dev` → `ddehmjucyfgyppfkbddr`), chacun avec son propre projet Vercel. Workflow prod/staging détaillé dans [`.claude/conventions/multi-env.md`](./.claude/conventions/multi-env.md). Les migrations sont appliquées via `pnpm supabase db push` ou `node scripts/apply-sql.mjs <fichier>` selon le cas (push gate : CLAUDE.md §8).

---

## Documentation

> La **source de vérité maintenue à jour** est [`CLAUDE.md`](./CLAUDE.md) (sa §11 Roadmap suit chaque sprint). Le contexte étendu vit sous [`.claude/`](./.claude/).

- [`CLAUDE.md`](./CLAUDE.md) — guide opérationnel pour les sessions [Claude Code](https://claude.com/claude-code) (conventions, à-faire/à-ne-pas-faire, invariants, roadmap). **Préférer ce fichier en cas de divergence.**
- [`.claude/`](./.claude/) — contexte étendu : `history/` (closeouts de sprints verbatim + évolution du score), `reference/structure-repo.md`, `conventions/` (Zod, TypeScript, logs, git-workflow, multi-env, règles opérationnelles, questions utilisateur), `guardrails/size-policy.md`.
- [`doc2/db/SCHEMA.md`](./doc2/db/SCHEMA.md) — carte des tables, RPC atomiques, indexes, FK, triggers prod.
- [`doc2/api/README.md`](./doc2/api/README.md) — référence rapide du namespace `/api/finance/*` (endpoints, verbes, query params, shapes de réponse).
- [`doc2/features/group-contributions.md`](./doc2/features/group-contributions.md) — feature contributions de groupe.
- **`/api/docs`** — Swagger UI live : doc OpenAPI 3.1 générée automatiquement depuis les schemas Zod (`lib/schemas/`) via `lib/openapi/`. JSON brut sur `/api/docs/openapi.json` (importable dans Postman / Insomnia).

---

## Conventions

Cf. [`CLAUDE.md`](./CLAUDE.md) §6 et §8 pour le détail. Résumé :

- **Format API** : `{ data: T } | { error: string }` partout, `401 'Session invalide'` si auth invalide, `404` (pas 403) pour les routes debug en prod.
- **TypeScript** : `import type` obligatoire (verbatimModuleSyntax), narrow systématique (noUncheckedIndexedAccess), pas de `any` dans le nouveau code, `as unknown as T` plutôt que `as any`.
- **Naming** : DB en `snake_case`, TS en `camelCase`, migrations Supabase `<YYYYMMDDHHMMSS>_<verb>_<scope>.sql`.
- **Git** : Conventional Commits (11 types : `feat`/`fix`/`chore`/`docs`/`perf`/`test`/`refactor`/`style`/`revert`/`build`/`ci`), un commit par item, pas de `--amend` sur un commit publié, jamais `--no-verify` sans demande explicite.
- **DB writes** : pour `piggy_bank`/`bank_balances`/`cumulated_savings`, **toujours** via les helpers `lib/finance/*`. Pas de SELECT-then-UPDATE direct.

---

## Contribution

Le repo est privé et maintenu en solo aujourd'hui. Si vous arrivez sur ce code via un fork ou une collaboration ad-hoc :

1. **Lire d'abord** [`CLAUDE.md`](./CLAUDE.md) — guide de référence pour les conventions, les pièges connus, l'historique des sprints et la roadmap (§11). Dense mais à jour.
2. **Brancher depuis `dev`** (staging) et ouvrir la PR vers `dev` ; `main` = prod. Le workflow prod/staging est décrit dans [`.claude/conventions/multi-env.md`](./.claude/conventions/multi-env.md).
3. **Gates PR** (GitHub Actions) : `code-checks.yml` (`pnpm typecheck` + `pnpm test:run` + lint/format) et `db-drift-pr.yml` (`pnpm db:check-drift` + détecteurs sur tout PR touchant `supabase/migrations/**` ou les types générés).
4. **Commits** : Conventional Commits, un commit par item logique (cf. CLAUDE.md §6).
5. **Migrations DB** : suivre le push gate de CLAUDE.md §8 (`db push --dry-run` → STOP confirmation → `db push` → re-audit → commit). Workflows capture-then-drop / DROP : [`.claude/conventions/git-workflow.md`](./.claude/conventions/git-workflow.md).
6. **Tests d'intégration gated** : `SUPABASE_*_TESTS=1` créent de vraies données. À lancer manuellement uniquement, jamais en CI.

Issues / discussions : pas de canal formel aujourd'hui (repo privé, mainteneur solo).

---

## Licence

Privé. Aucune licence open-source attribuée.
