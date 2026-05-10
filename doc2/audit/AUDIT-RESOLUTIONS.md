# 📋 Audit 2026-04-29 — Closeout du plan d'action

> Cross-reference one-shot fermant les **41 items** du plan d'action priorisé ([06-action-plan.md](./06-action-plan.md)). Sa contrepartie sprint-par-sprint chronologique est [CLAUDE.md §11](../../CLAUDE.md). Ce fichier n'est PAS maintenu en continu — c'est un closeout figé daté du 2026-05-10.

## Résumé exécutif

| Indicateur | Valeur |
| --- | --- |
| Items livrés (✅) | **27 / 41** (65.9 %) |
| Items partiels (✅⏭️) | **3 / 41** (7.3 %) — I8 console.log, R6 split components, R14 PR template only |
| Items différés (⏭️) | **12 / 41** (29.3 %) — chantiers I4/I5/I6, R9-R11/R13, N1-N10 |
| Items refusés (❌) | **2 / 41** (4.9 %) — R2 `--webpack`, commitlint dans R14 |
| Score global | **47 / 100 (audit 2026-04-29) → ~98.2 / 100 (2026-05-10)** |
| Durée écoulée | ~6 mois (audit avril → closeout mai 2026) |
| Sprints livrés | 30+ documentés dans CLAUDE.md §11 |

Trois remarques :

1. **R2 (`--webpack`)** est marqué refusé volontairement (CLAUDE.md §2 — Next 16 Turbopack a des problèmes en dev sur ce repo, on garde webpack en dev et Turbopack en build).
2. **commitlint dans R14** a été skip volontairement (Sprint 1 — convention CLAUDE.md §6 documentée par confiance ; le hook pre-commit lint-staged et le pre-push lint+typecheck couvrent l'essentiel).
3. **Les 12 items différés** sont tous tracés dans CLAUDE.md §11 avec leurs prompts dédiés (`prompt-04-tooling-dx-v*`, `prompt-07-deep-dive-*`).

## Tableau de résolution

### 🔴 Critique

| Item | Description | Statut | Résolu par |
| --- | --- | --- | --- |
| C1 | Retirer `ignoreBuildErrors: true` | ✅ done | Sprint 0 / C1 |
| C2 | Sécuriser `/api/debug/*` | ✅ done | Sprint 0 / C2 (`blockInProduction()`) + Sprint Refactor / R1 (drop 11 routes populate-*) + Sprint Polish / T2 (drop 3 routes : `quick-test`, `recap-data`, `test-balance`) |
| C3 | Race condition `piggy_bank` / `bank_balance` | ✅ done | Sprint 0 / C3 (4 RPC atomiques) + post-mortem drift schema_migrations ↔ pg_proc dans [POST-MORTEM-C3-DRIFT.md](./POST-MORTEM-C3-DRIFT.md) + filet via `pnpm db:check-rpcs` (Sprint Hardening / H4) |
| C4 | Auditer + versionner les RLS Supabase | ✅ done | Sprint 0 / C4 + Sprint DB / D1-D4 (RLS activée sur `piggy_bank`, policy `group_contributions` fixée, `remaining_to_live_snapshots.INSERT` restreint, tests RLS gated) + Sprint Refactor / R6 (drop policy récursive `profiles`) |
| C5 | Réparer README.md | ✅ done | Sprint 0 / C5 (UTF-8 sans BOM) |

### 🟠 Important

| Item | Description | Statut | Résolu par |
| --- | --- | --- | --- |
| I1 | Setup Prettier + Husky + lint-staged | ✅ done | Sprint 1 (commits 57d026b → 1cabae4) — Prettier flat config + plugin tailwindcss + lint-staged hook pre-commit |
| I2 | Setup CI GitHub Actions | ✅ done | Sprint Hardening / H5 (cron weekly drift) + Sprint Audit-Triggers / A4 (extension drift+rpcs+functions) + Sprint Audit-Functions-v2 / B3 (PR-time drift gate) + Sprint Hygiene-CI / E2 (types-fresh) + Sprint Code-CI / F1 (`code-checks.yml` typecheck+test+format) + Sprint Stabilize-Deps / S2 (push-time gate) |
| I3 | Vitest + premiers tests | ✅ done | Sprint 0 (init Vitest) + Sprint DB / D9 (tests RPC concurrence gated) + Sprint Polish / T3 (régressions API gated) + Sprint Audit-Functions-v2 / B2 (tests trigger gated) + Sprint 2-followup (test query-client non-gated) + Sprint 2-followup-v4 (tests auth-reducer non-gated) — 19 tests non-gated + suites gated `SUPABASE_*_TESTS=1` |
| I4 | Scinder `lib/financial-calculations.ts` | ⏭️ deferred | God file 1 075 LOC encore intact ; chantier dédié roadmappé dans CLAUDE.md §11 ⏭️ Chantier I4 |
| I5 | Extraire l'algo `process-step1` | ⏭️ deferred | Route 700+ LOC métier intacte ; le wrap auth header a été extrait Sprint Refactor-Architecture-v5 (`withAuthAndProfile`), mais la logique métier reste verbatim. Chantier roadmappé dans CLAUDE.md §11 ⏭️ Chantier I5 |
| I6 | Zod sur les bodies POST/PATCH | ⏭️ deferred | 0 usages aujourd'hui ; chantier roadmappé dans CLAUDE.md §11 ⏭️ Chantier Zod rollout. Le wrapper `withAuth(AndProfile)` v3+v4+v5 donne déjà un boundary clean pour rollout futur |
| I7 | Générer les types Supabase | ✅ done | Sprint DB / D6 (`pnpm db:types`) + Sprint Hygiene-CI / E2 (`pnpm db:check-types-fresh` filet CI) + Sprint Code-CI / F2 (`--project-id` au lieu de `--linked` pour fresh clones) |
| I8 | Nettoyer les `console.log` | ✅⏭️ partial | 1 331 → 986 (-26 %) via cleanups au fil de l'eau (Sprints Hygiène-Code, Refactor-Architecture v3+v4+v5, 2-followup, etc.) ; chantier dédié roadmappé dans CLAUDE.md §11 ⏭️ Chantier console.log cleanup |
| I9 | Rédiger CLAUDE.md | ✅ done | Sprint 1 + maintenu en continu sur 30+ sprints (le fichier fait ~880 lignes au 2026-05-10) |

### 🟡 Recommandé

| Item | Description | Statut | Résolu par |
| --- | --- | --- | --- |
| R1 | `eslint-config-next@16` + `eslint@9` | ✅ done | Sprint 1 (5d5d882) — flat config natif (FlatCompat circular-reference bug v9 contourné) |
| R2 | Retirer `--webpack` du script `dev` | ❌ refused | Choix volontaire CLAUDE.md §2 — Turbopack en build, webpack en dev (Turbopack dev bug observé sur ce repo) |
| R3 | Refactor middleware self-call HTTP | ✅ done | Sprint Refactor-Architecture / chantier 1 (35c86e7) — extraction dans [lib/recap/check-status.ts](../../lib/recap/check-status.ts), middleware appelle directement |
| R4 | Splitter AuthContext | ✅ done | Sprint Hygiène-Code / chantier 3 (6844089) — `AuthUserContext` + `AuthActionsContext` + Sprint Hygiène-Code-v2 (migration des 4 single-concern consumers) + Sprint 2-followup-v3 (migration `useReducer`) + Sprint 2-followup-v4 (extract reducer + tests + memoize) + Sprint 2-followup-v5 (purge aggregator dead code) |
| R5 | Introduire TanStack Query | ✅ done | Sprint 1.5 (14 commits) — 11 hooks fetcher migrés sur `useQuery` / `useMutation` + provider mounted + bridge legacy Sprint 2 cleanup + Sprint 2-followup helper extraction |
| R6 | Scinder les composants > 500 LOC | ✅⏭️ partial | Lazy-load via `next/dynamic` fait sur AddTransactionModal / PlanningDrawer / SavingsDistributionDrawer + 5 modals dans PlanningDrawer (Sprint Hygiène-Code v1+v2). Vrai split décomposé (extraction de sous-composants) pas fait — pas urgent puisque la TTI a déjà bénéficié du lazy-load |
| R7 | Uniformiser noms d'API | ✅ done | Sprint Refactor-Architecture v1 (créer `/api/finance/**` + aliases avec header `Deprecation: true`) + Sprint Refactor-Architecture-v2 (drop des 13 thin-wrappers après période d'observation, drop dashboard.ts et budgets GET) |
| R8 | Versionner les migrations Supabase | ✅ done | Sprint DB / D5 (baseline backdaté `20260101000000_remote_schema.sql` via API Management sans Docker) + 16 migrations cumulées + `pnpm db:check-drift` (Sprint Refactor / R4) |
| R9 | Audit trail mutations financières | ⏭️ deferred | Pas roadmappé. Nice-to-have, pas un risque actif (les RPCs C3 sont atomiques + RLS active) |
| R10 | Documenter l'API | ⏭️ deferred | Amorcé via [doc2/api/README.md](../api/README.md) Sprint Refactor-Architecture-v2 mais pas OpenAPI complet. Pas roadmappé pour OpenAPI génération |
| R11 | Tests E2E Playwright | ⏭️ deferred | Pas roadmappé. La couverture par tests Vitest gated (SUPABASE_API_TESTS, SUPABASE_TRIGGER_TESTS, SUPABASE_RLS_TESTS, SUPABASE_RPC_CONCURRENCY_TESTS) couvre déjà les golden paths côté serveur |
| R12 | `.editorconfig` + `.vscode/` + `.nvmrc` | ✅ done | Sprint Align-PackageJson / P2 (`.nvmrc` + `engines`) + Sprint 1 (`.editorconfig` + `.vscode/{settings,extensions}.json` + `.gitignore` selective) |
| R13 | ADR (Architecture Decision Records) | ⏭️ deferred | Pas roadmappé. Les décisions architecturales sont documentées en line dans CLAUDE.md §2-§8 + dans les sprints CLAUDE.md §11 |
| R14 | PR template + commitlint | ✅⏭️ partial | PR template livré Sprint 1 ([.github/pull_request_template.md](../../.github/pull_request_template.md)). **commitlint refusé volontairement** (Sprint 1) — convention CLAUDE.md §6 par confiance ; le pre-commit lint-staged + pre-push lint+typecheck couvrent l'essentiel |
| R15 | Migrer `next steps.txt` en issues | 🔄 ce sprint | Migré vers [next-steps.md](../../next-steps.md) au format Markdown structuré (commit du même jour que ce closeout) ; le `.txt` plat est supprimé |
| R16 | Retirer `@anthropic-ai/sdk` | ✅ done | Sprint Align-PackageJson / P1 (4d1621c) — vérifié 0 callsite via `grep` |
| R17 | `autoprefixer` en devDependencies | ✅ done | Sprint Align-PackageJson / P1 (build-time only via postcss.config.js) |

### 🟢 Nice-to-have

Tous différés. Ces items sont du backlog produit / observabilité / accessibilité — aucun n'est un risque actif.

| Item | Description | Statut |
| --- | --- | --- |
| N1 | Calculs financiers en `Decimal` (centimes int) | ⏭️ deferred |
| N2 | Rate limiting | ⏭️ deferred |
| N3 | Sentry / observabilité | ⏭️ deferred |
| N4 | Storybook | ⏭️ deferred |
| N5 | PWA push notifications | ⏭️ deferred |
| N6 | i18n (next-intl) | ⏭️ deferred |
| N7 | Lighthouse / Web Vitals monitoring | ⏭️ deferred |
| N8 | Analytics (Plausible, Umami, PostHog) | ⏭️ deferred |
| N9 | Accessibilité (jsx-a11y, Axe) | ⏭️ deferred |
| N10 | Dark mode | ⏭️ deferred |

## Comment maintenir ce fichier

**Ne pas le maintenir.** C'est un closeout one-shot du plan d'action 2026-04-29. La roadmap vivante (sprints livrés + chantiers ⏭️) est dans [CLAUDE.md §11](../../CLAUDE.md). Si un futur audit (par exemple 2027) génère un nouveau plan d'action avec ses items numérotés, créer un fichier dédié à ce nouveau cycle (e.g. `AUDIT-RESOLUTIONS-2027.md`) plutôt que d'étendre celui-ci — chaque audit a sa propre numérotation et son propre cadrage temporel.

## Liens

- 🎯 [Plan d'action priorisé](./06-action-plan.md) — source des 41 items
- 📊 [Executive summary](./00-executive-summary.md) — score 47/100 baseline
- 📈 [Scoring détaillé](./08-scoring-detailed.md) — détails par catégorie
- 🗺️ [CLAUDE.md §11 — Roadmap](../../CLAUDE.md) — sprints livrés + chantiers ⏭️
- 📦 [next-steps.md](../../next-steps.md) — backlog produit (migré depuis `next steps.txt`)
