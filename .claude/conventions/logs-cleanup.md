# Logs — logger central + cleanup history (Lot 1-6)

> Extraction détaillée de CLAUDE.md §6 Logs + références aux Lots 1-6 du §11 Roadmap.

## 1. Logger central

[lib/logger.ts](../../lib/logger.ts). 4 niveaux exposés — `logger.error`, `logger.warn`, `logger.info`, `logger.debug` — chacun signature `(msg: string, ...rest: unknown[])` (drop-in mécanique pour les call sites `console.log`).

## 2. Niveau actif

Gated via `LOG_LEVEL` env var (`error | warn | info | debug`). Défaut : `warn` en prod, `debug` en dev. Cached à module load (Edge-safe, pas de lookup `process.env` par appel).

## 3. Strip prod automatique

[next.config.js](../../next.config.js) `compiler.removeConsole` SWC supprime tous les `console.log/info/debug` du code applicatif au build (`exclude: ['error', 'warn']` les conserve). N'affecte ni `node_modules` ni le runtime Next.js.

## 4. ESLint enforcement

- **Global** (depuis Sprint Cleanup-I8 / Lot 6, 2026-05-14) : `'no-console': ['error', { allow: ['warn', 'error'] }]` ([eslint.config.mjs](../../eslint.config.mjs)) — tout nouveau `console.log/info/debug` fait sortir la PR rouge. `console.warn`/`console.error` restent allow-listés ad-hoc, mais préférer `logger.warn`/`logger.error` pour cohérence.
- **Per-file override** (depuis Lot 3) : un bloc ajouté APRÈS le bloc principal d'`eslint.config.mjs` durcit `no-console: 'error'` sur les modules migrés (`lib/logger.ts`, `lib/finance/**`, etc.). Inclure `lib/logger.ts` dans la liste est intentionnel : le `/* eslint-disable no-console */` au top du fichier reste source de vérité (le module est la frontière), mais l'override durcit le contrat si le disable est jamais retiré accidentellement.

## 5. Règle d'or de triage

Pour tout `console.*` rencontré (existant ou nouveau), se poser la question : **"est-ce que quelqu'un (toi, dans 6 mois, devant une prod en panne) lira ce log ?"**. Si non → **SUPPRIMER**. Si oui mais sans cas concret → **SUPPRIMER** aussi (YAGNI ; on ré-instrumente quand le bug arrive).

Décliné par pattern :

- **(a)** `console.error('Error in METHOD /api/...:', error)` dans un `try/catch` qui convertit en `NextResponse.json({error}, {status: 500})` → **SUPPRIMER** (Next.js capture déjà l'exception avec stack trace côté Vercel ; le custom message ajoute juste le route name déjà dans la stack).
- **(b)** DB error qui discrimine une branche métier non-évidente (`'Error fetching contributions:'` vs `'Error recalculating contributions:'`) → **KEEP+migrate** vers `logger.error` (le code/details Supabase n'apparaît qu'ici, grep-able si bug futur).
- **(c)** Erreur silencieusement avalée (le catch retourne 200 ou un fallback comme `{groups: []}`) → **KEEP+migrate** (sans le log, le serveur perd l'info qu'une op DB a fail).
- **(d)** Cleanup-attempt critique (e.g. groupe créé puis profile join fail → cleanup `delete groups`) → **KEEP+migrate** (path métier non-trivial qui mérite trace si jamais ça arrive).

Pour les `} catch (error) {` dont l'erreur est ainsi déliée du log : passer à `} catch {` (TS 4.4+, CLAUDE.md §6 convention).

## 6. Tests pure-unit du logger

[lib/**tests**/logger.test.ts](../../lib/__tests__/logger.test.ts) — 11 cas non-gated qui pin la level-filtering logic + `LOG_LEVEL` env handling + format `[level]` + rest-spread + non-utilisation de `console.log`. **Gotcha** : `lib/logger.ts` cache `currentLevel` à module load via `getCurrentLevel()`, donc chaque cas stub `LOG_LEVEL` + `NODE_ENV` AVANT `vi.resetModules()` + `await import('@/lib/logger')`.

## 7. Migration progressive — chronologie Lot 1-6

**Lot 1** (Sprint Cleanup-I8, 2026-05-10) — filet : création `lib/logger.ts` + strip prod SWC + ESLint global warn. Pas de migration code (setup only).

**Lot 3** (2026-05-10) — première migration : `middleware.ts` + `lib/expense-allocation.ts`, 7 sites total.

**Lot 4a** (2026-05-10) — `app/api/groups/**`, 22 sites → 11 supprimés + 11 migrés (ratio 50/50, "ménage avant migration"). Première application de la règle d'or de triage.

**Lot 4b** (2026-05-10) — `app/api/monthly-recap/{...9 routes simples}/**`, 132 sites distincts → 113 supprimés + 19 migrés (ratio 86%/14%, "triage agressif sur dump-debug"). Lot 4b a documenté que la pre-audit `grep -c` surcomptait à cause des template literals multi-ligne.

**Lot 4c** (2026-05-10) — `app/api/{profile,savings/data,bank-balance}/**`, 52 sites → 43 supprimés + 9 migrés (ratio 83%/17%, "triage strict avec drop critique de 3 PII surfaces — first_name/last_name/salary dans profile, solde bancaire dans bank-balance").

**Lot 4d** (2026-05-10) — `app/api/savings/transfer/route.ts`, 38 sites → 32 supprimés + 6 migrés (ratio 84%/16%, "triage strict avec **3 cleanup-attempts CRITIQUES préservés** — L123/L322/L338 rollback-impossible logs". Ces 3 cleanup-attempts ont été regression-guardés par Sprint Refactor-Test-Coverage 2026-05-12 puis fermés à la racine par Sprint Atomicity-Savings 2026-05-12).

**Lot 4e** (2026-05-10) — `lib/api/finance/**`, 12 fichiers, 152 sites → 119 supprimés + 33 migrés (ratio 78%/22%, "triage strict avec **3 cleanup-attempts CRITIQUES préservés** — `expenses-add-with-logic.ts:216` rollback piggy debit + `:229` rollback savings debit + `expenses-real.ts:431` rollback allocation reverse on DELETE silently-swallowed ; **+ 1 fallback 200-on-error préservé** sur `summary.ts:115` → logger.warn ; **+ ~10 snapshot failures** dans incomes/budgets/income-real/expenses-real → logger.warn per règle d'or rule c silently-swallowed").

**Lot 5** (2026-05-10) — couche client : 30 fichiers (12 components + 12 hooks + 1 context + 5 pages), 193 sites → 133 supprimés + 60 migrés (ratio 69%/31%, "triage strict avec **5 cleanup-attempts CRITIQUES préservés** — `SavingsDistributionDrawer.tsx:171` POST /savings/transfer fail + `useMonthlyRecap.ts:84/115/157` /monthly-recap/transfer + /auto-balance + /complete fail + `useGroups.ts:145+168` join/leave cross-mutation cascade fail ; **+ 1 boot-path PWA préservé** sur `ServiceWorkerRegistration.tsx:18` → logger.error ; **+ 4 dev-guarded sites** dans useProfile/useGroupContributions/useGroupSearch migrés vers logger.debug avec drop des `if (process.env.NODE_ENV === 'development')` ; **+ 18/19 DROP massif sur `app/dashboard/page.tsx`** useEffect verbose state dump RAV/économies/revenus/dépenses en € + PII profile.first_name/last_name").

**Lot 5b** (2026-05-10) — 3 fichiers serveur orphelins : `app/api/auth/session/route.ts` + `app/api/monthly-recap/recover/route.ts` + `app/api/monthly-recap/status-test/route.ts`, 16 sites → 8 supprimés + 4 migrés + 4 file-deleted (ratio 67/33). **2 cleanup-attempts CRITIQUES** : `auth/session/route.ts:56` Supabase auth réussi mais JWT session fail + `recover/route.ts:306` recovery rollback partiel. **status-test DELETE** confirmed dead code 0 consumer cross-codebase.

**Lot 5c** (2026-05-10) — 8 fichiers libs server-side foundationnels : `lib/{auth,session,session-server,supabase-client,database-snapshot,monthly-recap-calculations}.ts` + `app/auth/confirm/route.ts`, 45 sites → 18 supprimés + 23 migrés (ratio 56/44, KEEP-heavy parce que `monthly-recap-calculations` + `database-snapshot` sont audit-trail heavy plutôt que flow-log heavy). **1 cleanup-attempt CRITIQUE** : `app/auth/confirm/route.ts:46` OTP réussi mais `data.user` manquant. **5 audit-trail CRITIQUES préservés** : `database-snapshot.ts:169-173` × 5 statements logger.info (snapshot ID + mois + total records + per-table counts — foundational pour audit recovery).

**Lot 5d** (2026-05-10) — `app/api/debug/**`, 6 fichiers (tous gated `blockInProduction()` 404 prod), 64 statements → 45 supprimés + 12 migrés + 7 statements multi-line collapsé (ratio 79/21). **0 cleanup-attempt CRITIQUE** (routes atomiques Supabase, pas de rollback).

**Lot 2** (clos par Sprint Refactor-I4 2026-05-11) — la migration `lib/financial-calculations.ts → lib/finance/*` a interleavé le Lot 2 cleanup pendant l'extraction. 112 sites sources → ~13 sites en `lib/finance/` tous via `logger.*`. Lint baseline 406 → 307 (−99 warnings).

**Sprint Refactor-I5** (2026-05-11) — `process-step1/route.ts` 120 sites → 1 site `logger.error` dans le thin handler + 0 site dans `lib/recap/step1-*.ts`. Lint baseline 299 → 183 (−116 warnings).

**Sprint Refactor-I6** (2026-05-14) — `complete/route.ts` 65 sites via la même extraction god-file → thin handler + `lib/recap/complete-{algorithm,persist,types}.ts`. Lint baseline 180 → 115 (−65 warnings).

**Sprint Cleanup-I8 / Lot 6** (2026-05-14) — sweep final `balance/route.ts` + `auto-balance/route.ts` (130 sites → 5 KEEP+migrate / 125 DROP) + **activation globale `'no-console': 'error'`** dans le bloc principal d'`eslint.config.mjs`. Lint baseline 115 → **0 warnings**. **Chantier console.log cleanup multi-sprint Lot 1-6 officiellement clos** — désormais tout nouveau `console.log` hors per-file `warn`/`error` allowlist fait sortir la PR rouge automatiquement.

## 8. Pattern post-sprint à reproduire

Pour toute future migration `console.*` → `logger.*` :

1. **Phase 1 audit** : `grep -c "console\." <scope>` ne donne PAS le nombre réel de sites (template literals multi-ligne inflated le compteur). Audit Explore pour counter précis.
2. **Triage par règle d'or** : DROP rule (a) / KEEP+migrate rule (b) / KEEP+migrate rule (c) / KEEP+migrate CRITIQUE rule (d). Documenter chaque cleanup-attempt CRITIQUE préservé inline + dans le sprint closeout §11.
3. **Catches normalisés** : pour les bindings `error` non-utilisés après DROP, normaliser à `} catch {` (TS 4.4+).
4. **Per-file ESLint override** : étendre `eslint.config.mjs` glob (préférer `app/api/<domain>/**` global quand 100% couverture, sinon brace expansion explicite pour éviter les routes hors scope).
5. **Sanity test** : injection `console.log("SANITY-TEST")` dans un fichier migré → `pnpm lint:check` exit 1. Revert + exit 0.
