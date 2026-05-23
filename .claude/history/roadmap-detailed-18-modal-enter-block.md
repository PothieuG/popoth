# Roadmap détaillé — Part 18 : Modal-Forms-Block-Enter-Submit → Monthly-Recap-V3-Migrations

> Chronologie des sprints livrés à partir de 2026-05-21 (suite de [roadmap-detailed-17-delete-header-income-polish.md](roadmap-detailed-17-delete-header-income-polish.md)). Split préemptif pour rester sous le cap 39.5k chars/fichier.

## Sprints

- ✅ **Sprint Modal-Forms-Block-Enter-Submit** (livré 2026-05-21, déclenché par "je veux obliger les gens à appuyer sur le bouton de validation les modals d'ajout et de suppression de depense, revenu, budget, revenu planifié... en gros toutes les modals, appuyer sur entrée sur un input de montant fait juste disparaitre le clavier" → clarification AskUserQuestion "j'aimerais obliger les gens à cliquer sur le bouton" → portée élargie à tous les inputs des forms modaux).

  **Constat pré-sprint** : sur mobile (cible iPhone Safari/Chrome ≤430 px), appuyer sur "Go"/"Return" du clavier numérique (`inputMode="decimal"`) ou texte dans un input wrapped dans un `<form onSubmit={handleSubmit}>` déclenche le submit implicite du navigateur (HTML5 form behavior). Cas user : remplir le montant, presser Return pour fermer le clavier et continuer à éditer un autre champ → la modale se ferme prématurément avec le formulaire dans un état incomplet. Symptôme aggravé sur les wizards `AddTransactionModal` (step 3 = form) où le user veut juste fermer le clavier pour revoir le résumé de catégorisation avant de cliquer "Ajouter".

  **Architecture installée** :

  **(1) Helper `preventEnterSubmit`** ([lib/forms/prevent-enter-submit.ts](../../lib/forms/prevent-enter-submit.ts), 22 LOC) : `onKeyDown` handler à brancher sur les `<form>` des modals/drawers. Intercepte la touche `Enter` (sans modificateurs Shift/Ctrl/Meta/Alt) sur tout target qui n'est ni `<textarea>` (multi-line input légitime), ni `<button>` (clic intentionnel sur un bouton focus), ni `<a>` (lien). Action : `e.preventDefault()` (bloque le submit implicite HTML5) + `target.blur()` (ferme le clavier mobile sur iOS Safari / Chrome). Safe-guard `target instanceof HTMLElement` pour les events synthétiques.

  **(2) Branchement sur 10 sites `<form>` modaux** (1 ligne par site, import + prop) :
  - [components/groups/CreateGroupForm.tsx](../../components/groups/CreateGroupForm.tsx)
  - [components/dashboard/AddBudgetDialog.tsx](../../components/dashboard/AddBudgetDialog.tsx) + [EditBudgetDialog.tsx](../../components/dashboard/EditBudgetDialog.tsx)
  - [components/dashboard/AddIncomeDialog.tsx](../../components/dashboard/AddIncomeDialog.tsx) + [EditIncomeDialog.tsx](../../components/dashboard/EditIncomeDialog.tsx)
  - [components/dashboard/AddTransactionModal.tsx](../../components/dashboard/AddTransactionModal.tsx) (step 3 wizard `<form key="step-fields">`) + [EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx)
  - [components/dashboard/EditBalanceModal.tsx](../../components/dashboard/EditBalanceModal.tsx)
  - [components/profile/FirstTimeProfileDialog.tsx](../../components/profile/FirstTimeProfileDialog.tsx) + [EditProfileDialog.tsx](../../components/profile/EditProfileDialog.tsx)

  **(3) Modals/drawers sans `<form>` non touchés** : `DeleteGroupModal` (Input + onClick handler, pas de form-tag → pas de submit possible), `ConfirmationDialog` (2 buttons, pas d'inputs), `SavingsDistributionDrawer` (raw `<input>` dans un Drawer non-form). Pressing Enter sur un input isolé hors `<form>` ne déclenche aucun submit côté navigateur — le helper est inutile.

  **Tests** : 7 nouveaux cas dans [lib/forms/\_\_tests\_\_/prevent-enter-submit.test.tsx](../../lib/forms/__tests__/prevent-enter-submit.test.tsx) (env jsdom, `.tsx` car DOM types) :
  - Enter sur `<input>` → `preventDefault` + `blur` appelés
  - Enter sur `<textarea>` → no-op (multi-line préservée)
  - Enter sur `<button type="submit">` → no-op (clic intentionnel)
  - Enter sur `<a>` → no-op
  - Tab / Escape / 'a' / ArrowDown sur input → no-op (autres touches passent)
  - Enter+Shift/Ctrl/Meta/Alt sur input → no-op (modificateurs réservés)
  - Target null (event synthétique) → no-throw safe

  Tests passants 513 → **520** (+7). Lint:check 0/0. Format:check clean. Typecheck exit 0.

  **Files livrés** :
  - **Nouveaux** (2) : `lib/forms/prevent-enter-submit.ts` + `lib/forms/__tests__/prevent-enter-submit.test.tsx`.
  - **Modifiés source** (10) : les 10 forms modaux ci-dessus, chacun avec 2 edits (import + prop `onKeyDown={preventEnterSubmit}` sur `<form>`).

  **Trade-off / leçons apprises** :
  - **Form-level interception > field-level interception** : tentation initiale de modifier `DecimalFormInput` (centralized pour amount inputs uniquement). Rejeté après clarification user "j'aimerais obliger les gens à cliquer sur le bouton" — portée élargie à TOUS les inputs (incl. text fields name/description). Form-level `onKeyDown` est le seul point unique qui catche les 2 types d'inputs sans toucher à chaque field component.
  - **Passe-droit `<button>` même si focus-then-Enter = submit** : un user qui Tab jusqu'au bouton submit puis presse Enter le veut explicitement. Bloquer ici aurait cassé l'a11y keyboard navigation (cf. WCAG 2.1.1 Keyboard). Le passe-droit `<a>` est cohérent (anchor Enter = navigation, pas submit).
  - **Passe-droit modificateurs Shift/Ctrl/Meta/Alt** : défensif pour ne pas bloquer un raccourci futur (e.g. Ctrl+Enter = submit explicite est un pattern existant dans certaines apps SaaS). Aucun raccourci de ce type actuellement dans Popoth, mais le coût du passe-droit est ~0 et la réversibilité high.
  - **Test `.tsx` pas `.ts`** : le helper ne render pas de React, mais les tests utilisent `document.createElement` (DOM). Vitest config `test.projects` split env=node `*.test.ts` / env=jsdom `*.test.tsx` → file extension drive l'environnement. Rename `.test.ts` → `.test.tsx` au lieu de mocker manuellement les HTMLElement (plus simple, plus réaliste).
  - **Pas de modif `DecimalFormInput`** : le composant reste un wrapper pur sans logique de submit. Si plus tard on veut un Enter→Tab-to-next-field pattern (UX plus mobile-friendly), c'est une 2e couche orthogonale au form-level submit block.

  **Pattern à retenir** :
  - **Tout nouveau `<form>` dans un modal/drawer doit avoir `onKeyDown={preventEnterSubmit}`** sauf cas explicite où le submit-on-Enter est souhaité (e.g. un search bar single-input). Cas non actuellement présent dans Popoth.
  - **Mobile-first signature** : sur viewport ≤430 px, le clavier on-screen occupe 40-60 % de la hauteur. "Return"/"Go" sur le clavier numérique ou texte doit fermer le clavier (= `blur`) plutôt que submit, pour permettre à l'utilisateur de relire le formulaire avant validation explicite.
  - **Forms non-wrapped (input isolé hors `<form>`)** sont déjà safe — le navigateur ne soumet rien sans form-tag. Inutile d'ajouter le helper. Mais si on enveloppe un input dans un `<form>` plus tard pour validation Zod, penser à brancher le helper.

- ✅ **Sprint Clean-Slate-Recap** (sprint 01/17 Monthly Recap V3, livré 2026-05-23, déclenché par "on repart de zéro pour V3, je veux que le code et la DB n'aient plus aucune trace des recap V1/V2 inertes").

  **Constat pré-sprint** : V1 (inerte, 0 consumer applicatif depuis Sprint Dead-Code-Purge) et V2 (ossature partielle, ~10 routes + ~5 components + 2 tables + 1 cookie cache proxy gating) coexistaient dans le code. Risque de friction maintenance + ambiguïté sur ce qui est "actuel" en cas d'ouverture du chantier V3. Choix de table rase plutôt que migration progressive — V2 n'avait pas été déployée auprès des users, suppression sans impact UX.

  **Architecture supprimée** :
  - **App routes** : `app/api/monthly-recap/{status,start,complete,process-step1,process-step2,recover,auto-balance,reset}/route.ts` (~10 routes).
  - **Lib modules** : `lib/recap/` au complet (state lib, snapshot loader, contributors, calculations, types).
  - **Components** : `components/recap/*` (MonthlyRecapFlow, MonthlyRecapStep1, MonthlyRecapStep2, etc.) + références dans dashboard/group-dashboard layouts.
  - **Hooks** : `useMonthlyRecap`, `useRecapStatus`, etc.
  - **Schemas Zod** : `lib/schemas/recap.ts` + entries dans le barrel.
  - **Proxy gating** : `proxy.ts::checkRecapStatus()` + cookie cache TTL 5min retirés (sera réintroduits en sprint 05).
  - **Tests gated** : env vars `SUPABASE_*_RECAP_TESTS` + tests associés purgés.
  - **DB tables** : `monthly_recaps` (V1) + `recap_snapshots` (V1) + `monthly_recaps_v2` + `recap_snapshots_v2` + FK `budget_transfers.monthly_recap_id` (CASCADE drop = 2 RLS policies aussi retirées).

  **Migration livrée** : [supabase/migrations/20260523000000_drop_legacy_recap_tables.sql](../../supabase/migrations/20260523000000_drop_legacy_recap_tables.sql) avec `DROP TABLE IF EXISTS ... CASCADE` (4 tables) + `ALTER TABLE budget_transfers DROP COLUMN IF EXISTS monthly_recap_id CASCADE`. `remaining_to_live_snapshots` PRÉSERVÉE (utilisée par 6 modules finance hors workflow recap, audit trail RAV indépendant).

  **Docs alignement** ([6e7a4ba](https://github.com/.../commit/6e7a4ba)) : CLAUDE.md + `.claude/conventions/*` nettoyés des refs résiduelles `checkRecapStatus`, `lib/recap/`, `SnapshotPayload`, `process-step1`, `auto-balance`, `recover`. Refs historiques (sprint summaries, immutable roadmap parts) préservées per convention append-only.

  **Invariants post-sprint** : 29 routes API (était 39, -10) ; tests 334 non-gated + 80 gated skipped (drop tests recap V1/V2) ; 0 reference cross-codebase à `monthly_recap` / `monthlyRecap` / `recapSnapshot` (sauf `prompt-montly-recap/` untracked = specs V3).

  **Trade-off / leçons apprises** :
  - **Path B closed-by-deletion à grande échelle** : V1+V2 dropped car 0 user touché. Si V2 avait été en prod auprès de >0 user, on aurait dû migrer leurs données vers V3 → bien plus coûteux. La règle "0 user → DELETE" est respectée.
  - **Sprint 01 a oublié de re-exporter le baseline** : `supabase/migrations/20260101000000_remote_schema.sql` contenait encore les 4 tables V1/V2 droppées en prod → drift latent jusqu'au sprint 02 qui a fixé.
  - **Migrations DROP ne sont PAS auto-appliquées via `supabase db push`** dans ce repo — le workflow est `node scripts/apply-sql.mjs` + `pnpm supabase migration repair --status applied <TS>`. La migration `20260523000000_drop_legacy_recap_tables.sql` était dans git mais pas forcément exécutée — il faut vérifier la prod avant tout nouveau sprint touchant le même domaine.

- ✅ **Sprint Monthly-Recap-V3-Migrations** (sprint 02/17 Monthly Recap V3, livré 2026-05-24, suite logique de Clean-Slate-Recap).

  **Constat pré-sprint** : Sprint 01 a fait table rase mais sans poser de schéma V3. Sprint 02 fait l'inverse : pose le schéma DB V3 from scratch (table `monthly_recaps` avec state machine + lock + refloats + snapshot JSONB) + flag carry-over sur les transactions réelles. Aucun code applicatif — sprints 03-17 portent l'usage.

  **Architecture installée** :

  **(1) Table `monthly_recaps` V3** ([supabase/migrations/20260524000000_create_monthly_recaps_v3.sql](../../supabase/migrations/20260524000000_create_monthly_recaps_v3.sql)) :
  - 14 colonnes : `id`, owner XOR `profile_id`/`group_id`, `recap_month` smallint (1-12), `recap_year` smallint (2024-2100), `current_step` text+CHECK 6 valeurs (`welcome` → `summary` → `manage_bilan` → `salary_update` → `final_recap` → `completed`), lock `started_by_profile_id` ON DELETE SET NULL + `started_at` timestamptz, refloats `refloated_from_piggy`/`_from_savings` numeric(14,2), snapshot `budget_snapshot_data` jsonb DEFAULT `'{}'::jsonb` pour le puisage proportionnel différé ligne 3 (§4.B), `completed_at` + `created_at` + `updated_at`.
  - CHECK constraints : `monthly_recaps_owner_exclusive_check` (XOR profile/group, pattern repo verbose `(((A AND NOT B) OR (NOT A AND B)))`), `monthly_recaps_recap_month_check`, `monthly_recaps_recap_year_check`, `monthly_recaps_current_step_check` (IN 6 valeurs).
  - 3 indexes : 2 UNIQUE partiels (un par contexte profile/group, garantit 1 seul recap par mois par owner) + 1 lookup `_completed_lookup` pour `/api/monthly-recap/status` (proxy gating sprint 05).
  - Trigger `update_monthly_recaps_updated_at BEFORE UPDATE EXECUTE FUNCTION update_updated_at_column()` (réutilise la fonction globale capturée en `20260512000000_capture_trigger_functions.sql`).
  - `NOTIFY pgrst` à la fin pour PostgREST schema reload.

  **(2) Flag carry-over sur transactions réelles** ([supabase/migrations/20260524000001_add_carry_over_flags.sql](../../supabase/migrations/20260524000001_add_carry_over_flags.sql)) :
  - `ALTER TABLE real_expenses` + `real_income_entries` : add `is_carried_over boolean NOT NULL DEFAULT false` + `carried_from_recap_id uuid` (nullable, FK ON DELETE SET NULL vers `monthly_recaps(id)` — préserve la donnée user si recap source supprimé).
  - 1 index partial par table : `WHERE is_carried_over = true` pour filtrer les transactions reportées sans full scan (dashboard recap UI sprint 15).

  **(3) Capture rétroactive `rls_auto_enable`** ([supabase/migrations/20260524000002_capture_rls_auto_enable.sql](../../supabase/migrations/20260524000002_capture_rls_auto_enable.sql)) — orthogonal hygiene fix :
  - Event-trigger function PG (auto-enable RLS sur toute nouvelle table `public.*` via `pg_event_trigger_ddl_commands()`) existait en DB mais n'avait jamais été versionnée.
  - Surfacée par `pnpm db:audit-functions` post-application des 2 migrations sprint 02 (`MISSING_FROM_MIGRATIONS: 1 function(s)`).
  - Capturée verbatim via `scripts/dump-functions.sql` étendu (IN list +1) + paste body dans migration `<TS>_capture_*.sql` (pattern A2 standard).

  **(4) Re-export baseline depuis dev** : Le sprint 01 avait laissé un drift baseline ↔ prod (V1/V2 résiduelles dans baseline alors que DROP appliqué en prod). Sprint 02 re-exporte `20260101000000_remote_schema.sql` depuis le projet **dev** `ddehmjucyfgyppfkbddr` (cf. découverte mid-sprint : le workflow utilise dev, pas l'ex-prod `jzmppreybwabaeycvasz` que les scripts ciblaient par défaut). Baseline net : -140/+135 lignes, ~32k chars.

  **(5) Regen `lib/database.types.ts`** depuis dev via `cmd /c "node_modules\.bin\supabase gen types typescript --project-id ddehmjucyfgyppfkbddr --schema public > lib/database.types.ts"` (contournement du script `pnpm db:types` hardcodé `--project-id jzmppreybwabaeycvasz`). UTF-8 preserved via cmd byte-passthrough.

  **(6) `.prettierignore` étendu** : `prompt-montly-recap/` (dossier untracked de specs V3, 18 fichiers .md) ajouté pour ne plus faire échouer `pnpm format:check`.

  **Commits livrés (4) sur branche `monthly_recap`** :
  - `8cd6c8f chore(db): capture rls_auto_enable event trigger function`
  - `dafd8a2 feat(recap): create monthly_recaps V3 schema with state machine + lock + snapshot`
  - `7ff5aac feat(recap): add is_carried_over flags on real transactions`
  - `3f2c4f8 chore(db): re-export baseline + regen types post-V3 (dev project)`

  **Invariants post-sprint** : Functions DB versionnées 17/17 → **20/20** (`add_expense_with_breakdown` + ... + `rls_auto_enable` + `update_updated_at_column` + 16 autres). EXPECTED_RPCS reste 13. Tests stables 334/80. Routes API stables 29. `pnpm verify` exit 0 ✓.

  **Trade-off / leçons apprises** :
  - **Découverte projet dev/prod dual** : CLAUDE.md référençait uniquement `jzmppreybwabaeycvasz` comme "prod". L'utilisateur a un projet dev séparé `ddehmjucyfgyppfkbddr` (cloné via `scripts/clone-data.mjs` ajouté commit `7165ebc`). Tous les `scripts/db-*.mjs` ciblent prod par défaut → risque récurrent d'appliquer sur prod par erreur. Solution : nouvelle memory `feedback_supabase_project_target.md` + section §1 CLAUDE.md mise à jour avec override `$env:SUPABASE_PROJECT_REF`.
  - **`pnpm db:types` hardcodé prod** : seul script DB qui ne respecte pas `SUPABASE_PROJECT_REF`. À refactor en sprint séparé (wrapper script `scripts/db-types.mjs` ou env var inline cross-platform). Pour l'instant, override manuel via `cmd /c "node_modules\.bin\supabase gen types ... --project-id dev ..."`.
  - **Migrations non-idempotentes (CONSTRAINT/INDEX adds)** : seuls `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... DROP IF EXISTS`, `CREATE OR REPLACE FUNCTION` sont idempotents. `ALTER TABLE ... ADD CONSTRAINT/COLUMN/INDEX` throw si déjà présent. Conséquence : appliquer 2× sur le même projet échoue. Vérifier l'état (export-schema + grep) avant re-apply en cas de doute.
  - **Capture orthogonale dans le même sprint** : pattern accepté d'inclure une migration de capture (`rls_auto_enable`) qui n'est pas dans le scope du sprint mais débloque `pnpm db:audit-functions` (et donc `pnpm verify`). Moins propre qu'un sprint dédié, mais évite de laisser verify rouge pendant des jours.
  - **Apply accident sur prod** : 3 migrations sprint 02 ont été appliquées sur `jzmppreybwabaeycvasz` (prod) par défaut avant de découvrir que dev est `ddehmjucyfgyppfkbddr`. Décision user : laisser en l'état (le schéma V3 sans consumer applicatif est inerte, prod l'aurait reçu de toute façon plus tard). Pas de rollback. Memory `feedback_supabase_project_target` créée pour éviter récidive.

  **Pattern à retenir** :
  - **Avant tout `node scripts/apply-sql.mjs <file>` ou `node scripts/export-schema.mjs <file>`** : confirmer le projet cible (lire `$env:SUPABASE_PROJECT_REF` ou demander). Le log "Applying ... to project <REF>" doit matcher l'intention.
  - **Lock initiateur (contexte groupe)** : `started_by_profile_id` + `started_at` columns sur `monthly_recaps`. Permet à n'importe quel membre du groupe d'ouvrir le recap, mais seul l'initiateur peut le finaliser (logique app sprints 05+).
  - **State machine via text+CHECK** plutôt qu'ENUM PG : `current_step` text NOT NULL avec `CHECK (current_step IN (...))`. Cohérent avec pattern repo (cf. baseline pre-sprint pour `monthly_recaps_v2.current_step`). ENUM PG est plus rigide à muter (ALTER TYPE ADD VALUE non-transactional post-PG12).
  - **JSONB snapshot vs table snapshot séparée** : décision V3 = `monthly_recaps.budget_snapshot_data jsonb` plutôt que table `recap_snapshots` séparée. Plus simple à query (1 SELECT, pas de JOIN), atomicité naturelle (RPC qui écrit recap + snapshot en 1 tx).
  - **`SUPABASE_PROJECT_REF` env var override** : tous les scripts `scripts/*.mjs` (sauf wrap `pnpm db:types`) respectent `process.env.SUPABASE_PROJECT_REF ?? 'jzmppreybwabaeycvasz'`. Set inline avant la commande ou pour la session : `$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'`.

- ✅ **Sprint State-Lock-Schemas-V3** (sprint 03/17 Monthly Recap V3, livré 2026-05-24, commit `b4fa1af`). Fondations pure-async pour débloquer les calculs métier (04), les endpoints (05+) et l'UI (09+).

  **Constat pré-sprint** : sprint 02 a posé le schéma DB sans code applicatif. Aucun module TS pour lire/transiter l'état recap. Le but du sprint : poser 3 modules pure-fonctionnels (state machine, lock helpers, barrel) + 1 module I/O minimal (check-status) + tous les schémas Zod des 8 futurs endpoints. **0 endpoint, 0 UI, 0 proxy gating** — strict plomberie isolée du calcul (sprint 04) et des routes (05+).

  **Architecture installée** :

  **(1) `lib/recap/state.ts`** (pure sync, 40 LOC) : `RecapStep` type union (6 valeurs : `welcome` → `summary` → `manage_bilan` → `salary_update` → `final_recap` → `completed`), `RECAP_STEP_ORDER` const tuple `as const satisfies readonly RecapStep[]` (single source of truth), `isAdvanceAllowed(from, to)` (forward-only via `RECAP_STEP_ORDER.indexOf` ; skip permis ; self-loop interdit) et `nextRequiredStep(current)` (next step linéaire, `null` sur terminal `'completed'`). Décision YAGNI tranchée : drop le paramètre `bilan: number` de la spec, la séquence est statique côté TS (le bilan affecte le contenu UI de `manage_bilan` mais pas la séquence).

  **(2) `lib/recap/check-status.ts`** (async I/O, 235 LOC) : `RecapContext = 'profile' | 'group'`, discriminated union `RecapStatusKind = { kind: 'no_recap' } | { kind: 'in_progress', recapId, step, startedAt, startedByProfileId } | { kind: 'locked_by_other', recapId, startedByProfileId, startedByName } | { kind: 'completed', recapId, completedAt }`. Discriminator `kind` (pas `type` qui collide avec React intrinsic prop). `RecapStatusError` custom class avec `code: 'PROFILE_NOT_FOUND' | 'NO_GROUP'` (mirror de l'ancien V2 supprimé). `checkRecapStatus(userId, context)` async :
  - Lit `profiles` via `.maybeSingle()` (PROFILE_NOT_FOUND si absent).
  - Branche `context === 'profile'` : `SELECT monthly_recaps WHERE profile_id = ... AND recap_month = ... AND recap_year = ...` via `.maybeSingle()` (jamais `.single()` — sinon PGRST116 sur compte fresh, cf. règle CLAUDE.md §❌ Tables owner-row hybrides). Si absent → `no_recap`. Si `completed_at != null` → `completed`. Si `started_by_profile_id IS NULL` (orphan row, ex. start a planté mid-claim) → `no_recap` (laisse `/start` re-claim). Sinon → `in_progress`.
  - Branche `context === 'group'` : `NO_GROUP` throw si `profile.group_id` null. Même séquence sur `monthly_recaps WHERE group_id = ...` mais avec **JOIN PostgREST FK-hinted** `starter:profiles!monthly_recaps_started_by_profile_id_fkey(first_name, last_name)` pour récupérer le nom de l'initiateur. Si `started_by_profile_id === userId` → `in_progress`. Sinon → `locked_by_other` avec `startedByName = '${first_name} ${last_name}'.trim() || null`.
  - `coerceStep(raw: string): RecapStep` interne — défense en profondeur si la DB retourne une valeur hors `VALID_STEPS` (CHECK constraint déjà actif côté PG, mais double-safety au cas où le CHECK serait drop futur).

  **(3) `lib/recap/lock.ts`** (pure sync, 22 LOC) : `isUserLocked(status)` (true ssi `kind === 'locked_by_other'`) et `isRecapBlocking(status)` (true sur `no_recap` | `in_progress` | `locked_by_other`, **false sur `completed`** — le reste du mois est libre, décision user-confirmée).

  **(4) `lib/recap/index.ts`** (barrel) : ré-exporte tout — `checkRecapStatus`, `RecapStatusError`, types `RecapContext`/`RecapStatusKind`/`RecapStatusResult`, `isUserLocked`/`isRecapBlocking`, `RECAP_STEP_ORDER`/`isAdvanceAllowed`/`nextRequiredStep`, type `RecapStep`. Consumers : `import { ... } from '@/lib/recap'`.

  **(5) `lib/schemas/recap.ts`** (Zod, 95 LOC) : 8 schémas pour les futurs endpoints, réutilisant les primitives `contextSchema`/`uuidSchema`/`nonNegativeMoneySchema` de [common.ts](../../lib/schemas/common.ts) + 2 locaux `positiveAmountSchema` (refloat) et `salaryAmountSchema` (non-negative pour `0€` autorisé). Liste : `startRecapBodySchema`, `transferSurplusesBodySchema` (`budgetIds: z.array(uuidSchema).min(1)`), `refloatFromPiggyBodySchema`, `refloatFromSavingsBodySchema` (same shape), `saveBudgetSnapshotBodySchema` (`snapshot: z.record(uuidSchema, nonNegativeMoneySchema)` — Zod 4 signature key+value), `updateSalariesBodySchema` (`salaries: array of {profileId, salary} min(1)`), `completeRecapBodySchema`, `statusQuerySchema`. Chaque schéma exporte aussi son type `z.infer`. Barrel `lib/schemas/index.ts` étendu (`export * from './recap'`).

  **Tests** :
  - **`lib/recap/__tests__/state.test.ts`** : 17 cas non-gated pure (8+ `isAdvanceAllowed` couvrant forward consécutif, forward skip court/long, backward, self-loop sur tous les steps, transitions depuis terminal `'completed'` ; 6 cas `nextRequiredStep` couvrant chaque step → next + terminal → null ; 1 snapshot `RECAP_STEP_ORDER`).
  - **`lib/recap/__tests__/check-status.test.ts`** : 8 cas gated `SUPABASE_RECAP_TESTS=1` via `describe.skipIf(process.env.SUPABASE_RECAP_TESTS !== '1')`. Fixtures 3 users (Alice/Bob dans groupA, Carla sans groupe) avec `await import('@/lib/recap/check-status')` dans `beforeAll` + cleanup cascade `afterAll`. Couvre les 4 kinds + orphan row (started_by NULL = no_recap) + 2 erreurs (PROFILE_NOT_FOUND, NO_GROUP).
  - **`lib/schemas/__tests__/recap.test.ts`** : 40 cas non-gated (5 par schéma) couvrant valid context profile/group + invalide enum + champ manquant + cas spécifique au schéma (`budgetIds: []` rejected min(1), `amount: 0` rejected positive, `amount: 1.234` rejected decimal refine, `salaries: [{profileId: 'bob', ...}]` rejected uuid, `snapshot: { 'not-uuid': 100 }` rejected key, etc.).

  Tests passants 334 → **391** (+57 non-gated : 17 state + 40 schémas) ; gated skipped 80 → **88** (+8 check-status). Typecheck exit 0 ; lint:check exit 0 baseline 0/0 ; format:check clean après prettier --write sur 3 fichiers (lock.ts, check-status.ts, recap.test.ts) ; `pnpm verify` exit 0 (DB checks via override `$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'` — drift `verify` par défaut compare prod où V3 pas encore poussée, état transitoire post-sprint 02 hors scope).

  **Files livrés (9, 1010 insertions)** :
  - **Nouveaux modules** (5) : `lib/recap/state.ts`, `lib/recap/check-status.ts`, `lib/recap/lock.ts`, `lib/recap/index.ts`, `lib/schemas/recap.ts`.
  - **Nouveaux tests** (3) : `lib/recap/__tests__/state.test.ts`, `lib/recap/__tests__/check-status.test.ts`, `lib/schemas/__tests__/recap.test.ts`.
  - **Modifié** (1) : `lib/schemas/index.ts` (+1 ligne `export * from './recap'`).

  **Trade-off / leçons apprises** :
  - **YAGNI sur `nextRequiredStep(current, bilan)` → `nextRequiredStep(current)`** : la spec donnait le param `bilan: number` "pour future extension" (manage_bilan content varies). Mais la séquence est statique côté TS, le bilan affecte uniquement le contenu UI. Drop confirmé via AskUserQuestion. Si plus tard un step est skipable conditionnel, on ajoutera le param sans casser les consumers (changement compatible side-effect-free).
  - **Discriminator `kind` PAS `type`** : `type` collide avec la prop intrinsèque React (`<button type="...">`). Le pattern `kind` est cohérent avec l'existant repo (`EmailOtpType`, `Action` unions, etc.).
  - **`.maybeSingle()` obligatoire sur `monthly_recaps`** : règle déjà documentée pour `piggy_bank` (Sprint Fix-Empty-Recap-Tirelire). Re-application ici. PGRST116 "Cannot coerce the result to a single JSON object" silencieusement crash l'UI si on utilise `.single()` sur une row qui peut ne pas exister. Toute lecture future sur `monthly_recaps` doit respecter cette règle.
  - **Orphan row classée `no_recap` (décision user-confirmée)** : edge case `started_by_profile_id IS NULL` (création row réussie mais claim atomique a planté). Trois options évaluées : (a) `no_recap` (laisse `/start` re-claim ; recommended), (b) `in_progress` générique (qui claim ? risque de lock indéfini), (c) throw `ORPHAN_RECAP` (force gestion UI). User a tranché (a). L'endpoint `/start` (sprint 05) devra gérer la collision UPSERT (la row existe déjà).
  - **`isRecapBlocking(completed) = false`** : décision user-confirmée. Le `'completed'` ne force pas la nav vers `/monthly-recap` — l'utilisateur peut utiliser l'app librement jusqu'au mois suivant. L'autre option (rester blocking pour ré-afficher l'écran completion) était moins UX.
  - **JOIN PostgREST FK-hint obligatoire** : `starter:profiles!monthly_recaps_started_by_profile_id_fkey(...)`. Sans le `!<fk_name>`, PostgREST échoue avec "Could not embed because more than one relationship was found" — 3 FK depuis monthly_recaps vers profiles (`profile_id`, `started_by_profile_id`, + implicite via group→profile transitif). Le nom de FK provient des Relationships dans `database.types.ts` (généré par `supabase gen types`).
  - **Pré-existing drift baseline ↔ prod** : `pnpm verify` failed à `db:check-drift` car la baseline (issue de dev `ddehmjucyfgyppfkbddr` post-sprint 02) inclut `monthly_recaps` qui n'existe pas encore en prod `jzmppreybwabaeycvasz`. Out-of-scope sprint 03 (qui ne touche pas la DB). Workaround : `$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'` pour les 6 DB checks (tous verts contre dev). Le drift prod sera résorbé quand V3 sera push sur prod (sprint dédié futur).
  - **Prettier après écriture** : les 3 fichiers (lock.ts, check-status.ts, recap.test.ts) ont demandé un `prettier --write` post-Write avant que `format:check` passe. Le pattern Edit (vs Write from-scratch) avec strict matching aurait évité — Write n'applique pas Prettier automatiquement. Note future : éviter de courir `pnpm format` global (mécanique massive cf. CLAUDE.md), prefer `prettier --write <file>` sur les fichiers touchés.

  **Pattern à retenir** :
  - **Tout nouveau `lib/recap/*` reste pure sauf check-status** : `state.ts` et `lock.ts` n'importent PAS `supabaseServer` (0 I/O). Seul `check-status.ts` (et plus tard `load-summary.ts` au sprint 04+) importe Supabase. Permet de tester les transitions à vide sans DB.
  - **Toute lecture `monthly_recaps` côté app** : `.maybeSingle()` + branche `if (!row) → no_recap`. Jamais `.single()`. Cas vu Sprint 03 — re-application de la règle Fix-Empty-Recap-Tirelire à V3.
  - **Le `kind` discriminator est cohérent avec le pattern repo** pour les discriminated unions de status async. Si on ajoute une nouvelle union (ex. `LoadSummaryKind` au sprint 04), garder `kind` au lieu de `type`/`status`/`state` pour cohérence.
  - **Pour tout sprint qui exporte de nouvelles primitives Zod** : penser à ajouter `export * from './<name>'` au barrel `lib/schemas/index.ts`. Sinon les consumers doivent importer directement (`from '@/lib/schemas/recap'`) au lieu de la convention `from '@/lib/schemas'`. Pas de blocker, mais cohérence.
  - **Param YAGNI sur signature publique** : si la spec donne un param "pour future extension" mais non-utilisé au premier sprint, le drop (cf. `nextRequiredStep` ici). Réintroduire le param est un changement non-breaking (default optional ou new overload). Avoir le param vestigial pollue l'API et fait passer des tests faux-positifs (le param n'a aucun effet observable).
