# 🔧 Chantier : Extraction partielle `recover/route.ts` vers `lib/recap/recover-{algorithm,persist}.ts`

> ⚠️ **STALE — livré 2026-05-16 par Sprint Refactor-Recover.**
> Voir CLAUDE.md §11 entrée Sprint Refactor-Recover pour le détail (8 commits sur `cleanup` : `c0eb91c` caract / `cb2ae30` types / `a2c4448` algorithm / `ca93112` algorithm tests / `1d49072` persist / `bd4196b` persist tests / `ca18d2c` rewire + closeout). Route 385 → 168 LOC. 37 nouveaux tests non-gated + 5 caract gated. CLEANUP-ATTEMPT CRITIQUE préservé verbatim via RecoveryAppliedPartiallyError. 5 tables v2 non-restaurées préservées par design.

**Statut détecté** : en suspens
**Source** : CLAUDE.md §11 Sprint Refactor-I6 (2026-05-14) — hors scope ("balance, auto-balance, recover partial → chantier ultérieur")
**Dernière activité** : 2026-05-14 (Sprint Refactor-I6 livré `complete` extraction, défère les 3 autres routes stateful)
**Priorité suggérée** : moyenne
**Effort estimé** : L

---

## Prompt pour Claude Code

### Contexte
Popoth est une PWA financière (Next.js 16 + Supabase). Les routes `app/api/monthly-recap/{process-step1,complete}/route.ts` ont été extraites en thin handlers (~45-59 LOC) via les Sprints Refactor-I5 (2026-05-11) et Refactor-I6 (2026-05-14). Le pattern d'extraction est standard :

```
route.ts (thin handler) → lib/recap/<name>-{types,algorithm,persist}.ts
```

`recover/route.ts` (~430 LOC) reste un god file (state machine de recovery snapshot v1/v2). Sprint Refactor-I6 explicitly notes : "**Les 4 routes monthly-recap stateful restantes (balance, auto-balance, recover patrials) restent dans le god-file state — déferrées chantiers ultérieurs**".

Ce chantier traite **`recover/route.ts`** spécifiquement. `auto-balance` est traité par [`04_auto-balance-godfile-extraction.md`](04_auto-balance-godfile-extraction.md). `balance` extraction est implicite (sprint suivant balance-godfile, non scaffolded ici car non explicitement mentionné dans CLAUDE.md §11 hors scope I6).

### État actuel
- **Code concerné** : [`app/api/monthly-recap/recover/route.ts`](app/api/monthly-recap/recover/route.ts) (~430 LOC). Structure :
  - **POST handler** : recovery snapshot deserialization (`SnapshotPayload v1 | v2`) + restore tables (real_expenses, real_income_entries, monthly_recaps, etc.) + cleanup snapshot
  - **GET handler** : list available snapshots pour resume UI
  - **`restoreTable<T>()` helper** (~80 LOC) : dispatch v1/v2 + INSERT batch
  - **CLEANUP-ATTEMPT CRITIQUE** L306 préservé verbatim Sprint Lot 5b (rollback partiel snapshot peut rester actif si recovery fail mid-flight)
- **Wrapping** : déjà `withAuthAndProfile` (Sprint Refactor-Architecture-v4 2026-05-08)
- **Logs** : Sprint Lot 5b (2026-05-10) a migré 9 sites → 3 KEEP+migrate / 6 DROP. ESLint glob `app/api/monthly-recap/{...,recover}/**` enforce `no-console: 'error'`
- **Types `SnapshotPayload` v1/v2** : déjà existants Sprint Polish T4 (2026-05-07) dans [`lib/recap-snapshot.types.ts`](lib/recap-snapshot.types.ts) — réutiliser
- **Tests gated** : 3 cas régression Sprint Lint-Followups (2026-05-08) Item 1 dans [`lib/__tests__/api-regressions.test.ts`](lib/__tests__/api-regressions.test.ts) sur `bank_balance` / `piggy_bank` boolean type — `SUPABASE_API_TESTS=1`. **Aucun caract test gated complet** pour `recover/route.ts` workflow

### Objectif
Extraire `recover/route.ts` en suivant le pattern Refactor-I5/I6 adapté pour state machine v1/v2 :
1. **Caract tests gated** (3-5 cas) pin byte-identique pré-extraction
2. **`lib/recap/recover-types.ts`** réutilise `SnapshotPayload v1|v2` de `lib/recap-snapshot.types.ts` + ajoute types orchestration
3. **`lib/recap/recover-algorithm.ts`** dispatcher pur v1/v2 (`decideRecoveryActions(snapshot, profile, group): RecoveryDecision`)
4. **Tests pure-unit non-gated** sur `decideRecoveryActions` (~15-20 cas dispatch v1/v2 + edge cases)
5. **`lib/recap/recover-persist.ts`** : `processRecovery(input)` = load snapshot → decide → apply (INSERT batches per-table)
6. **Tests mocked non-gated** sur `applyRecoveryDecision` (~10-15 cas incluant CLEANUP-ATTEMPT CRITIQUE L306 préservé)
7. **Route thin handler** (~70-80 LOC : `withAuthAndProfile` + `parseBody(recoverRecapBodySchema)` + `processRecovery` + error mapping + GET unchanged)
8. **Barrel + ESLint glob**

### Contraintes et conventions à respecter
- **Pattern I5/I6 strict** (mêmes 8-9 commits qu'I5/I6/chantier 04)
- **Pure function `decideRecoveryActions`** : 0 I/O, 0 `console.*`, immutable, dispatch v1/v2 via `isSnapshotV2()` predicate de `lib/recap-snapshot.types.ts`
- **`processRecovery` orchestration** : INSERT batches per-table (real_expenses / real_income_entries / monthly_recaps / budget_transfers / piggy_bank / bank_balances). **PRÉSERVER VERBATIM** le CLEANUP-ATTEMPT CRITIQUE L306 — `try { ... } catch (err) { logger.error('[recover] rollback partiel impossible (snapshot can stay active)', { snapshotId, error: err })` ne pas modifier ce log fail-soft.
- **Discriminated union** `SnapshotPayload = SnapshotPayloadV1 | SnapshotPayloadV2` (Sprint Polish T4) + `isSnapshotV2()` type guard. NE PAS casser ce contrat — utiliser tel quel via import depuis `lib/recap-snapshot.types.ts`.
- **`restoreTable<T>()` helper** : extraire dans `recover-persist.ts` (logique générique CountKey/BooleanKey + branche v1/v2). Préserver le fix Sprint Lint-Followups (strict `boolean` partout pour `bank_balance` / `piggy_bank`).
- **Pas de `: any`** ni `as unknown as SupabaseClient` ni `as any` sur les snapshots (Sprint Polish T4 a fait disparaître ces casts via discriminated union)
- **Pas de `declare global`** (CLAUDE.md §5)
- **Schema body** : `recoverRecapBodySchema` (Sprint Zod-Rollout v2) — réutiliser tel quel
- **`pnpm verify`** exit 0 (8 stages)
- **Conventional commits**, pas de `--no-verify`, branche feature depuis `cleanup`

### Plan d'action suggéré

**Commit 1 — caract tests gated** : nouveau fichier `app/api/monthly-recap/recover/__tests__/route.integration.test.ts` (~700-800 LOC). Pattern miroir [`app/api/monthly-recap/complete/__tests__/route.integration.test.ts`](app/api/monthly-recap/complete/__tests__/route.integration.test.ts). **5 cas** gated `SUPABASE_API_TESTS=1` (snapshot tests sont API regression-flavored, pas RECAP_TESTS) :
- CAS 1 happy v2 (snapshot complet récent) — restore tables + cleanup snapshot
- CAS 2 v1 fallback (legacy snapshot, dispatch via `isSnapshotV2() === false`)
- CAS 3 empty v2 (table avec 0 rows backed up — preserve `restoreTable` boolean=true with 0 inserted)
- CAS 4 400 schema (body invalide) — `recoverRecapBodySchema` parse fail
- CAS 5 401 no auth — `withAuthAndProfile` reject

Verif : 5/5 passed avant tout refactor.

**Commit 2 — types** : `lib/recap/recover-types.ts` (~100 LOC). Imports `SnapshotPayload` + `isSnapshotV2` depuis `@/lib/recap-snapshot.types`. Ajoute :
- `ProcessRecoveryInput` (snapshotId, userId, profileId/groupId)
- `RecoveryDecision` (per-table actions list, ordered)
- `RecoveryOutput` (response shape avec `bank_balance: boolean`, `piggy_bank: boolean`, counts per-table)
- `TableRestoreAction<T>` (discriminated union v1/v2 per-table)

0 runtime. Re-export depuis `lib/recap/index.ts` barrel.

**Commit 3 — algorithm pure** : `lib/recap/recover-algorithm.ts` (~150-200 LOC). `decideRecoveryActions(snapshot, profile, group): RecoveryDecision`. Pure : dispatch v1/v2 via `isSnapshotV2()`, ordering deterministe des table restorations (FK-safe : profiles → groups → estimated_budgets → real_expenses → ... → snapshots cleanup last).

**Commit 4 — algorithm tests pure-unit** : `lib/recap/__tests__/recover-algorithm.test.ts` (~400-500 LOC). **15-20 cas** non-gated (<0.5s) :
- 5-7 v2 dispatch (différents shapes + counts)
- 3-5 v1 fallback (legacy backward compat)
- 3-5 edge cases (empty tables, missing keys, mixed v1+v2 shouldn't exist mais regression-guard)
- 2-3 determinism (FK order pin)

Pattern miroir [`lib/recap/__tests__/step1-algorithm.test.ts`](lib/recap/__tests__/step1-algorithm.test.ts).

**Commit 5 — persist** : `lib/recap/recover-persist.ts` (~250-300 LOC). `processRecovery(input)` = `loadRecoverySnapshot → decideRecoveryActions → applyRecoveryDecision`. Préserve verbatim **CLEANUP-ATTEMPT CRITIQUE L306** (rollback partiel snapshot peut rester actif → `logger.error` grep-able). Préserve **strict `boolean` types** pour `bank_balance` / `piggy_bank` (Sprint Lint-Followups Item 1). Préserve fix `boolean | number` mismatch (les 2 paths v1 vs v2 retournent désormais strict `boolean`).

**Commit 6 — persist tests mocked** : `lib/recap/__tests__/recover-persist.test.ts` (~400-500 LOC). **10-15 cas** non-gated (~1s) :
- 4-6 `applyRecoveryDecision` happy (v1 + v2 dispatch via mock)
- 3-5 **CLEANUP-ATTEMPT CRITIQUE preservation** (snapshot deactivation fail mid-restore → `logger.error` fired but processRecovery continues vs throws)
- 2-3 strict `boolean` regression-guard (assert `bank_balance: true` not `1` or `'true'`)
- 2-3 `loadRecoverySnapshot` mapped SELECT failures

Pattern miroir [`lib/recap/__tests__/complete-persist.test.ts`](lib/recap/__tests__/complete-persist.test.ts) (mock strategy : `vi.mock` hoisted + `__mocks` registry + dynamic import-in-test).

**Commit 7 — rewire route thin handler** : `app/api/monthly-recap/recover/route.ts` réécrit à ~70-80 LOC. POST = `withAuthAndProfile` + `parseBody(recoverRecapBodySchema)` + `processRecovery(input)` + error mapping. GET handler (list snapshots) reste verbatim ou refactor minor. Verif : 5/5 caract tests gated still pass byte-identique. Verif aussi : 3 cas régression `bank_balance` / `piggy_bank` boolean type dans `api-regressions.test.ts` toujours verts.

**Commit 8 — barrel + ESLint glob** : `lib/recap/index.ts` étendu. ESLint glob `lib/recap/recover-*.ts` ajouté au bloc per-file `no-console: 'error'`. Sanity test injection → ESLint error attendu.

**Commit 9 — closeout** : CLAUDE.md §1 score (saut +0.001 — pure consolidation), §4 file inventory étendu (lib/recap/recover-\*), §5 architecture note, §8 ❌ "Ne pas réintroduire logique métier dans recover/route.ts" + ❌ "Ne pas casser le strict `boolean` invariant" (Sprint Lint-Followups), §11 entrée Sprint Refactor-Recover.

### Critères de complétion
- [ ] **5 caract tests gated** `SUPABASE_API_TESTS=1 pnpm test:run app/api/monthly-recap/recover/__tests__/` 5/5 passed pré-extraction (Commit 1) ET post-rewire (Commit 7) — byte-identique behavior
- [ ] **3 régressions existantes** `SUPABASE_API_TESTS=1 pnpm test:run lib/__tests__/api-regressions.test.ts` 3+/3+ passed (les cas `bank_balance` / `piggy_bank` boolean type Sprint Lint-Followups)
- [ ] **`lib/recap/recover-types.ts`** existe, 0 runtime, réutilise `SnapshotPayload v1|v2`
- [ ] **`lib/recap/recover-algorithm.ts`** existe, pure fonction, 0 I/O
- [ ] **15+ cas pure-unit** `lib/recap/__tests__/recover-algorithm.test.ts` passed <0.5s
- [ ] **`lib/recap/recover-persist.ts`** existe, CLEANUP-ATTEMPT CRITIQUE L306 préservé verbatim
- [ ] **10+ cas mocked** `lib/recap/__tests__/recover-persist.test.ts` passed ~1s
- [ ] **`app/api/monthly-recap/recover/route.ts`** ≤ 80 LOC (POST handler), GET handler ≤ 30 LOC supplémentaires
- [ ] **0 `as any`** sur les snapshots (`Grep "as any" app/api/monthly-recap/recover/route.ts lib/recap/recover-*.ts` → 0 hit)
- [ ] **0 `declare global`** (`Grep "declare global" app/api/monthly-recap/recover/route.ts lib/recap/recover-*.ts` → 0 hit)
- [ ] **`pnpm verify`** exit 0 (8 stages)
- [ ] **`pnpm typecheck`** + **`pnpm lint:check`** exit 0 / 0 errors / 0 warnings stable
- [ ] **`pnpm test:run`** 100% passing (no regression)
- [ ] **Counter `as unknown as SupabaseClient`** reste à 0
- [ ] **Counter `: any` introduits** = 0
- [ ] **CLAUDE.md §11** entrée Sprint Refactor-Recover + §1 score + §4 inventory + §5 architecture + §8 ❌ bullets
- [ ] **Smoke browser** deferred to user : recovery flow exerçant v2 snapshot (Sprint Polish T4 idiom) sur compte test

### Pièges connus / points d'attention
- **`SnapshotPayload v1|v2` discriminated union** (Sprint Polish T4) : NE PAS casser ce contrat. Utiliser `isSnapshotV2()` predicate, pas `'snapshot_version' in payload` direct.
- **CLEANUP-ATTEMPT CRITIQUE L306 préservé verbatim** : Sprint Lot 5b a explicitement KEEP+migrate ce log (recovery rollback partiel peut laisser snapshot actif). Mock test cas 3-5 (Commit 6) régression-guard contre suppression.
- **Strict `boolean` invariant** (Sprint Lint-Followups Item 1) : `bank_balance` et `piggy_bank` doivent être `boolean` partout (pas `boolean | number`). Branche v1 path assigne `true`, branche v2 path branchait sur `data.length` (numérique, falsy si 0) → fix split `CountKey + BooleanKey + ResultKey` + branche conditionnelle ligne 234. **Préserver fix dans `recover-persist.ts`** : si tu refactors le helper `restoreTable<T>()`, assert `typeof result === 'boolean'` dans tests.
- **GET handler** : list available snapshots, ne pas casser. Soit garder verbatim dans `route.ts`, soit créer mini helper `listAvailableSnapshots(userId)` dans `recover-persist.ts` (option β). Phase 1 audit décide.
- **`recoverRecapBodySchema`** : déjà existant Sprint Zod-Rollout v2 (CLAUDE.md §6). Inclut `confirm: literal true` (sécurité — recovery est destructive). Réutiliser tel quel.
- **Cross-check sessionContext vs profile.id** : Sprint Zod-Rollout v2 risk #2 préservé verbatim. Reste handler-side dans `recover-persist.ts` (runtime data, out of schema reach).
- **FK ordering** : `decideRecoveryActions` doit produire les actions dans l'ordre FK-safe (parents avant enfants). Sinon INSERT failures. Tests pure-unit doivent pin cet ordre.
- **monthly_recap_id plumbing** : audit_2/18 dormant. `recover` peut ne pas avoir besoin (snapshots indépendants du `monthly_recap_id`). Verifier en Phase 1.
- **Lint-staged hang** : `lib/database.types.ts` non touché → safe.
- **Recovery path** : si extraction provoque flake gated tests, `git revert` du Commit 7 restaure le god file tout en gardant `lib/recap/recover-*` comme dead code temporaire.
- **`pnpm format:check`** : peut surfacer fichiers pré-existants dirty (chantier 16 hygiène git). Ignorer si hors scope ce sprint.
