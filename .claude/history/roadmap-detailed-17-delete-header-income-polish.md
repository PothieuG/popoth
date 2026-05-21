# Roadmap détaillé — Part 17 : Delete-Header-And-Income-Polish

> Chronologie des sprints livrés à partir de 2026-05-22 (suite de [roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md](roadmap-detailed-16-expense-preview-pose-and-preserve-caps.md)). Split préemptif pour rester sous le cap 38k chars/fichier.

## Sprints

- ✅ **Sprint Delete-Header-And-Income-Polish** (livré 2026-05-22, déclenché par 4 demandes user en une passe : "quand je veux supprimer un revenu estimé, dans l'encart j'aimerais une petite phrase qui dit de combien mon revenu estimé sera modifié" + "Je n'ai pas d'encart de recap quand je modifie un revenu ajouté (qu'il soit exceptionnel ou non), crée en un" + "quand on supprime un revenu, supprime la phrase 'Revenu lié à 'xxx'. Sois plus concis. Utilise un code couleur si tu parles du reste à vivre" + "dans toutes les modals de suppression, j'aimerais qu'il soit marqué quelque part (je pense en haut de l'encart) un truc disant que c'est ce à quoi ça va ressembler.")

  **(1) Header "Après suppression :" obligatoire dans toutes les modals de suppression** : wrap des `details` de `<ConfirmationDialog>` avec un `<p className="text-sm font-medium text-gray-700">Après suppression :</p>` au-dessus du panel/phrase. Le user voyait l'encart mais ne savait pas ce qu'il représentait. Implémenté dans :
  - [components/dashboard/TransactionListItem.tsx::buildDeleteDetails](../../components/dashboard/TransactionListItem.tsx) — wrapper `<div className="space-y-1.5 text-left">` avec header + inner content (panel ou phrase fallback selon branche).
  - [components/dashboard/PlanningDrawer.tsx](../../components/dashboard/PlanningDrawer.tsx) — fonction inline `details={(() => { ... })()}` qui wrappe les phrases budget/revenu avec le header.

  **(2) Income concision dans la modal de suppression** ([components/dashboard/TransactionListItem.tsx::buildIncomeDeleteDetails](../../components/dashboard/TransactionListItem.tsx)) : drop du `sourceLine` qui rendait "Revenu lié à **'Salaire Mai'**." dans les 3 branches income (exceptional, regular-with-context, regular-without-context). User explicite "Sois plus concis". Les phrases fallback (pas-de-panel) gardent leur texte mais colorient "reste à vivre" en `text-blue-600 font-medium` (inline span dans la phrase) pour cohérence avec l'EntityLabel du panel.

  **(3) Preview recap en mode édition d'un revenu (ou dépense exceptionnelle)** ([components/dashboard/EditTransactionModal.tsx](../../components/dashboard/EditTransactionModal.tsx)) : avant ce sprint, `<EditTransactionModal>` ne rendait que `<ExpenseBreakdownPreview>` pour les dépenses budgétées. Pas d'aperçu pour income edits ni pour exceptional expense edits. Ajout d'un bloc `<RemainingToLivePreview>` gated sur `transactionType === 'income' || (transactionType === 'expense' && isOriginallyExceptional)` + `Math.round(previewSafe * 100) !== Math.round(transaction.amount * 100)` (changement effectif du montant). Pass `existingAmount={transaction.amount}` pour back-out la contribution déjà comptabilisée.

  **(4) `<RemainingToLivePreview>` étendu avec `existingAmount`** ([components/dashboard/RemainingToLivePreview.tsx](../../components/dashboard/RemainingToLivePreview.tsx)) :
  - Nouveau prop `existingAmount?: number` défault 0 (mode ADD inchangé).
  - Branche exceptionnelle : `netAmount = amount - existingAmount` (delta) avant calcul de l'impact. Pour ADD : netAmount = amount (existing=0). Pour EDIT : netAmount = delta réel.
  - Branche income régulière : `effectiveCurrentReceived = currentReceived - existingAmount` (back-out de la tx existante avant le compute du newTotalReceived). Tous les calculs aval (currentDifference, newDifference, additionalChange) utilisent l'effective au lieu du raw cumul.
  - Permet à `<EditTransactionModal>` de rendre la preview sans double-compter la transaction en cours d'édition.

  **(5) Recap phrase pour la suppression d'un revenu estimé** ([components/dashboard/PlanningDrawer.tsx::ConfirmationDialog](../../components/dashboard/PlanningDrawer.tsx)) :
  - Extension du state `deletingItem` avec `estimatedAmount: number` (était cumulatedSavings only pour le budget).
  - `handleRequestDelete` capture `item.estimated_amount` (presnent sur EstimatedBudget ET EstimatedIncome).
  - Pour `type === 'income' && estimatedAmount > 0` : phrase "Vos revenus estimés passeront de **{currentTotal}** à **{newTotal}**." avec les 2 amounts en `text-green-600 font-semibold` (entity color income). `newTotal = totalIncomesWithSalary - estimatedAmount`.
  - Pour `type === 'budget' && cumulatedSavings > 0` : phrase historique sur le transfert des économies (purple) conservée + header "Après suppression :" ajouté.

  **Tests** : 3 tests RTL `TransactionListItem.test.tsx` mis à jour pour matcher les nouveaux comportements :
  - `queryByText(/Salaire Mai/)` not.toBeInTheDocument() (sourceLine droppée).
  - `getByText('Après suppression :').toBeInTheDocument()` (header obligatoire).
  - `getByText('reste à vivre').toHaveClass('text-blue-600')` (lowercase span coloré dans la phrase fallback).

  **Files livrés** :
  - **Modifiés UI** (4) : `components/dashboard/RemainingToLivePreview.tsx` (existingAmount prop + math back-out), `components/dashboard/EditTransactionModal.tsx` (preview block income+exceptional-expense), `components/dashboard/TransactionListItem.tsx` (header + drop sourceLine + color RAV inline), `components/dashboard/PlanningDrawer.tsx` (estimatedAmount state + income recap phrase + header).
  - **Modifiés tests** (1) : `components/dashboard/__tests__/TransactionListItem.test.tsx` (3 assertions mises à jour).
  - **Modifiés conventions** (4) : `CLAUDE.md` §11, `.claude/conventions/operational-rules-ui-modals.md` (+1 règle ❌ header obligatoire + income concision), `.claude/conventions/operational-rules.md` (+1 row §6 chronologie), `.claude/guardrails/size-policy.md` (inventaire).

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm format:check` exit 0
  - `pnpm test:run` **513 passed / 98 skipped** (baseline stable)

  **Trade-off / leçons apprises** :
  - Le `existingAmount` prop sur `<RemainingToLivePreview>` est un défault 0 pattern — backward compatible avec tous les call sites ADD existants (AddTransactionModal). Seul `EditTransactionModal` le passe explicitement. Pattern à généraliser : les composants de preview qui peuvent fonctionner en ADD ET EDIT doivent accepter un optional existingAmount/existingId pour back-out la contribution courante.
  - Le `queryByText('Reste à vivre')` (capital R) ne match pas `<span>reste à vivre</span>` (lowercase) — testing-library est case-sensitive par défaut. C'est utile pour distinguer le label EntityLabel (capital R via le `word` constant) du texte inline en phrase fallback (lowercase). Cela permet d'asserter l'absence du panel sans ambiguité.
  - Le format de la phrase income delete "Vos revenus estimés passeront de X à Y" privilégie la before/after explicite plutôt que "diminueront de Z" (delta-only). L'utilisateur veut savoir le nouvel état total, pas juste la variation. Pattern miroir possible pour le budget delete (à implémenter si user complain).

  **Pattern à retenir** :
  - Pour toute modal de confirmation qui passe `details` à `<ConfirmationDialog>`, prepend un header "Après suppression :" (ou équivalent contextuel) au-dessus du contenu pour clarifier ce qu'il représente. Le user mental model "qu'est-ce qui change" doit être annoncé en clair.
  - Pour les composants de preview RAV/financier qui supportent ADD et EDIT, ajouter un prop `existingAmount?: number` (default 0). En EDIT, l'appelant passe `transaction.amount` pour permettre le back-out. Sans ça, le préview double-compte la contribution courante.
  - Pour les références inline à "reste à vivre" / "économies" / "budget" dans les phrases (en dehors du panel), utiliser un `<span className="font-medium text-{entity-color}">` pour cohérence visuelle avec les EntityLabel des panels. Le visual feedback aide l'utilisateur à associer les concepts à leurs couleurs.

- ✅ **Sprint Group-Transaction-Creator-Avatar** (livré 2026-05-22, déclenché par "Je me rends compte que dans un groupe, quand quelqu'un regarde les dépenses et revenus, toutes les photos des valeurs pour chaque dépense et revenus sont les memes : celles de l'user qui est connecté sur l'espace. En fait j'aimerais que chaque revenu ou dépenses ait la photo du user qui l'a ajouté").

  **Bug pre-sprint** : dans `/group-dashboard`, chaque ligne de la liste « Dépenses / Revenus » affichait toujours l'avatar de l'user connecté, peu importe qui avait ajouté la transaction. Cause racine :
  - [components/dashboard/TransactionListItem.tsx](../../components/dashboard/TransactionListItem.tsx) L316-320 rendait `<UserAvatar profile={userProfile} />` où `userProfile` = auth user, transmis par `TransactionTabsComponent.tsx:302+335`.
  - Les tables `real_expenses` et `real_income_entries` ont la contrainte `owner_exclusive_check` (`profile_id` XOR `group_id`). Pour les transactions de groupe, `profile_id` est NULL → aucune trace du créateur en DB.
  - Les RPCs composites `add_expense_with_breakdown` + `add_expense_with_cross_budget_cascade` ne capturaient pas l'auteur.
  - Les GET handlers ne JOIN pas `profiles` pour ramener le créateur.

  **(1) DB migration colonne créateur** ([supabase/migrations/20260522000000_add_created_by_to_real_transactions.sql](../../supabase/migrations/20260522000000_add_created_by_to_real_transactions.sql)) : `ALTER TABLE real_expenses ADD COLUMN created_by_profile_id uuid` + FK nommée explicitement `real_expenses_created_by_profile_id_fkey` REFERENCES `profiles(id)` ON DELETE SET NULL + index. Idem `real_income_entries`. Nullable by design : legacy rows restent NULL → UI tombe sur le placeholder `??` natif. FK nommée explicitement parce qu'avec `profile_id` ET `created_by_profile_id` tous deux FK vers `profiles`, PostgREST refuse le shorthand `created_by:profiles(...)` (ambiguïté) et exige le hint `created_by:profiles!<fk_name>(...)`. Nommer la FK rend le contrat stable.

  **(2) DB migration RPCs créator-aware** ([supabase/migrations/20260522010000_update_add_expense_rpcs_with_creator.sql](../../supabase/migrations/20260522010000_update_add_expense_rpcs_with_creator.sql)) : DROP + CREATE OR REPLACE de `add_expense_with_breakdown` et `add_expense_with_cross_budget_cascade` avec un nouveau param `p_created_by_profile_id uuid DEFAULT NULL`. Le DROP est requis parce que PG ne peut pas `CREATE OR REPLACE` avec changement de signature (default params ne widen pas la signature match). Drift préexistant corrigé en passant : `20260519000000_create_transfer_piggy_to_budget_with_insert_rpc.sql` renommé en `20260519000001_...` parce que la table `_supabase_migrations` n'accepte qu'une ligne par timestamp et le `20260519000000_create_cross_budget_cascade_rpc.sql` la tenait déjà. 4 migrations poussées en prod via `pnpm supabase db push --include-all`.

  **(3) Helpers `lib/finance/expenses.ts`** ([lib/finance/expenses.ts](../../lib/finance/expenses.ts)) : `createdByProfileId: string` ajouté en arg required aux 2 helpers (`addExpenseWithBreakdown` + `addExpenseWithCrossBudgetCascade`), passé au `.rpc()` via `p_created_by_profile_id`. Required (pas optional) pour forcer tous les call sites prod à expliciter le créateur — le DEFAULT NULL côté SQL existe seulement pour la rétro-compat des call sites externes éventuels.

  **(4) API POST handlers** (3 routes) : `lib/api/finance/expenses-real.ts` POST, `lib/api/finance/income-real.ts` POST, `lib/api/finance/expenses-add-with-logic.ts` (branche exceptionnelle + 2 invocations RPC) — tous écrivent `created_by_profile_id: userId` dans `insertData` ou passent `createdByProfileId: userId` aux helpers. Le `userId` vient du wrapper `withAuth({ userId })`. Le PUT/DELETE handlers ne touchent PAS `created_by_profile_id` (set-once at INSERT, l'édition ne change pas le créateur).

  **(5) API GET handlers JOIN** (6 selects étendus) : `lib/api/finance/expenses-real.ts` (GET + POST + PUT 3 selects), `lib/api/finance/income-real.ts` (GET + POST + PUT 3 selects), `lib/api/finance/expenses-add-with-logic.ts` (2 selects post-RPC). Chaque `.select()` étendu avec `created_by:profiles!<fk_name>(id, first_name, last_name, avatar_url)`. La réponse POST inclut alors le créateur, l'optimistic update du hook reste cohérent.

  **(6) Recap algorithm** ([lib/recap/complete-algorithm.ts](../../lib/recap/complete-algorithm.ts) L147-158) : payload `exceptionalExpense` ("Écart de reste à vivre reporté du récap M/Y") attribué à `input.userId` (l'user qui clique Finaliser). `input.userId` est déjà dans `ProcessCompleteInput` via le wrapper `withAuthAndProfile`, l'algo reste pur (0 I/O).

  **(7) Hook types** : `hooks/useRealExpenses.ts` `RealExpense` + `hooks/useRealIncomes.ts` `RealIncome` + interfaces miroir `RealExpenseData`/`RealIncomeEntryData` côté handlers — tous étendus avec `created_by?: { id: string; first_name: string \| null; last_name: string \| null; avatar_url: string \| null } \| null`.

  **(8) UI cleanup** : `<TransactionListItem>` perd la prop `userProfile`. Helper local `toCreatorProfile()` mappe `transaction.created_by` → `ProfileData` partiel (avec defaults inertes pour les champs non-lus par `<UserAvatar>` : `salary: 0, group_id: null, group_name: null, created_at: null, updated_at: null`). Si `created_by` null/undefined → `creatorProfile = null` → `<UserAvatar profile={null}>` affiche `??` natif. `<TransactionTabsComponent>` perd la prop `userProfile` + drop des 2 passes (L302+L335). Les 2 pages `app/(dashboards)/{dashboard,group-dashboard}/page.tsx` perdent le type `Parameters<typeof TransactionTabsComponent>[0]['userProfile']` + le JSX `userProfile={profile}`. `useProfile()` reste dans group-dashboard pour le check `profile.group_id` du redirect, donc pas de drop de l'appel hook.

  **Tests** (5 fichiers) :
  - `lib/finance/__tests__/add-expense-with-breakdown.test.ts` (gated) : `createdByProfileId: testUserId` passé aux 5 invocations + assertion DB sur la colonne dans le happy path.
  - `lib/finance/__tests__/add-expense-with-cross-budget-cascade.test.ts` (gated) : idem pour les 6 invocations.
  - `lib/recap/__tests__/complete-algorithm.test.ts` : regression-guard `expect(decision.exceptionalExpense?.created_by_profile_id).toBe('user-1')`.
  - `app/api/monthly-recap/complete/__tests__/route.integration.test.ts` (gated SUPABASE_RECAP_TESTS=1) : assertion DB sur la colonne post-finalisation.
  - `lib/api/finance/__tests__/expenses-add-with-logic.test.ts` : contract lock `expect.objectContaining({ createdByProfileId: 'user-1' })` sur l'invocation `addExpenseWithBreakdown` mockée.

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm format:check` exit 0 (après `prettier --write` sur `app/(dashboards)/group-dashboard/page.tsx`)
  - `pnpm test:run` **513 passed / 98 skipped** (baseline stable)
  - `pnpm verify` exit 0 (typecheck + format + tests + 6 db:\* checks)
  - `pnpm build` exit 0 (54 routes)
  - Gated `SUPABASE_RPC_CONCURRENCY_TESTS=1` add-expense × 2 : **12/12**
  - Gated `SUPABASE_RECAP_TESTS=1` complete : **5/5**

  **Trade-off / leçons apprises** :
  - **FK hint syntax** : avec 2 FK pointant sur `profiles` (`profile_id` + `created_by_profile_id`), PostgREST refuse le shorthand `created_by:profiles(...)`. Solution : nommer la FK explicitement dans la migration (`ADD CONSTRAINT <table>_created_by_profile_id_fkey ...`) + utiliser le hint `created_by:profiles!<fk_name>(...)` dans `.select()`. Le couple FK-name + hint string est un contrat. Le nom suit la convention PG `<table>_<column>_fkey`. Régénération des types via `pnpm db:types` met le `foreignKeyName` dans `Database['public']['Tables'][T]['Relationships'][N]` — vérifier que le hint matche.
  - **DROP + CREATE OR REPLACE des RPCs** : PG ne peut pas `CREATE OR REPLACE` une fonction dont la signature change (default params ne widen pas la signature match — la function ID est `(<arg types>)` donc ajouter un nouvel arg = nouvelle fonction). Sans le DROP explicite, PostgREST résolvait l'ambiguïté en erreur ou en pickant le mauvais overload.
  - **Drift préexistant trickle-down** : 2 migrations pré-existantes (`20260511...align_bank_balance_overdraft.sql` + `20260519000000_create_transfer_piggy_to_budget_with_insert_rpc.sql`) n'étaient pas dans `_supabase_migrations` (appliquées historiquement via `apply-sql.mjs`/capture-then-drop). `pnpm supabase db push` les a re-tentées en mode `--include-all` ; le 2e a crashé sur duplicate timestamp (le `20260519...cross_budget_cascade.sql` la tenait déjà). Rename `20260519000000` → `20260519000001` + re-push a corrigé. **Pattern à retenir** : éviter 2 migrations avec le même timestamp même si capturées séparément — `_supabase_migrations` n'accepte qu'une ligne par version.
  - **`created_by_profile_id` nullable, pas required NOT NULL** : choix délibéré pour la rétrocompat des rows legacy (créées avant la migration). Backfill best-effort (ex. attribuer au premier membre du groupe) aurait été approximatif et risqué. L'UI tombe gracefully sur le placeholder `??` pour les anciennes lignes.
  - **`userId` for recap exceptional** : l'exceptionnelle "Écart de reste à vivre" est techniquement system-generated, mais attribuée à l'user qui clique Finaliser. Choix défendable : (a) cohérence visuelle (ligne avec un avatar plutôt qu'un placeholder), (b) responsabilité — le user a triggered l'opération. La description `Écart de reste à vivre reporté du récap M/Y` reste explicite sur l'origine recap.
  - **Drop de la prop `userProfile`** : choix de cleanup-first plutôt que back-compat (cf. CLAUDE.md operational-rules ❌ "Avoid backwards-compatibility hacks"). Cascade dans `TransactionTabsComponent` + les 2 pages dashboard. `useProfile()` reste dans group-dashboard pour le check `profile.group_id` du redirect (consumer indépendant).
  - **Cas non-couvert** : le PERSONAL context affiche le breakdown UI sans avatar (cf. `context === 'group'` guard à L316 dans TransactionListItem). Le JOIN tourne quand même en personal (overhead négligeable) — décision : préférer la cohérence DB. La colonne est toujours peuplée même en personal, ce qui sera utile si un futur sprint expose un mode "audit" cross-context.

  **Pattern à retenir** :
  - Toute écriture sur `real_expenses` / `real_income_entries` (via les POST handlers directs ou via les composite RPCs) DOIT passer `created_by_profile_id: userId`. Le DEFAULT NULL côté SQL est pour les call sites externes uniquement, pas pour les routes app.
  - Toute lecture qui retourne une ligne `real_expenses` / `real_income_entries` au client DOIT JOIN `created_by:profiles!<fk_name>(id, first_name, last_name, avatar_url)`. Sans ce JOIN, l'UI tombe sur le placeholder `??` même quand la colonne est peuplée.
  - Pour un FK ambigu (2+ FK vers la même table), nommer la contrainte explicitement dans la migration et utiliser le hint `<rel>:<table>!<fk_name>(...)` dans `.select()`.

- ✅ **Sprint Mobile-Density-Shrink** (livré 2026-05-21, déclenché par "cette application est destinée à être utilisé sur mobile. J'ai testé l'application sur mon Fairphone 6, mais je trouve que tout est trop gros. Est-ce qu'il serait possible de faire en sorte que l'application rende bien sur ce mobile et sur tous les autres ? Je pense qu'il faudrait réduire un peu tout d'un petit cran.").

  **Constat pré-sprint** : l'app PWA mobile-first cible viewport ≤ 430 px (CLAUDE.md §6). Sur Fairphone 6 (412×916 CSS px, DPR 2.625), Roboto rendu par Android paraît visuellement plus dense que SF sur iOS — couplé à `text-lg` (18 px) sur amounts/titres, `p-4` (16 px) sur transaction cards, `p-3` (12 px) sur BottomNav, l'effet cumulé fait "trop gros". Mesure foundation : `app/globals.css` `@theme {}` ne déclare aucun override `--spacing` / `--text-*`, `<html>/<body>` n'a aucune `font-size` set → fallback navigateur 16 px. **Zero `text-[Npx]` arbitraire** dans le code — 100 % rem-based via classes Tailwind utility. Foundation **rem-anchored idéal** pour un single-point-of-truth scale.

  **(1) Root font-size shift** ([app/globals.css](../../app/globals.css) lignes 122-138) : ajout dans le `@layer base` existant de `:root { font-size: 15.5px }` (au lieu du 16 px par défaut). Tous les utilitaires Tailwind rem-based (`text-*`, `p-*`, `m-*`, `gap-*`, `h-*`, `w-*`, `space-*`) shrinkent proportionnellement de ~3 % :
  - text-base : 16 px → 15.5 px ; text-lg : 18 px → 17.4 px ; text-xs : 12 px → 11.6 px ; text-2xl : 24 px → 23.3 px
  - p-3 / p-4 : 12 / 16 px → 11.6 / 15.5 px ; gap-2 / gap-4 : 8 / 16 px → 7.75 / 15.5 px
  - bouton h-9 : 36 px → 34.9 px (touch target borderline, compensé par padding parent `p-3`/`p-4` qui donne une touch-zone effective ≥ 44 px)
  - avatar w-8 / w-10 / w-12 : 32 / 40 / 48 px → 31 / 38.75 / 46.5 px
  - Modal `max-h-[85vh]`, `sm:max-w-md`, `tw-animate-css` % transforms : **inchangés** (vh-based / px-locked / %-translate) — invariants `MODAL_CONTENT_CLASSES bottom-auto!` + `flex-auto + min-h-0` + `px-6 py-4` canonical + `!` postfix preserved.

  **(2) iOS Safari zoom guard** ([app/globals.css](../../app/globals.css)) : ajout `input, textarea, select { font-size: 16px }`. Sans cette garde, iOS Safari zoome automatiquement au focus quand un input a `font-size` computed < 16 px (accessibilité spec WebKit délibérée). Notre `text-base` passe à 15.5 px après le root shift → la garde force les form controls à 16 px (element-selector, gagne en specificity-tie contre les classes Tailwind utility de même couche). Pattern à généraliser à toute future règle qui shift le root font-size.

  **(3) Drive-by fix : eslint `scripts/**`no-console:off** ([eslint.config.mjs](../../eslint.config.mjs)) : ajout d'un glob override`files: ['scripts/**/*.mjs'], rules: { 'no-console': 'off' }`. Latent introduit par le commit `04a96c7 chore(claude): add md-size enforcement gate + bump cap to 39.5k`:`scripts/check-md-size.mjs:105`utilisait`console.log`pour la sortie`--verbose`mais le rule global`'no-console': ['error', { allow: ['warn', 'error'] }]`(Sprint Cleanup-I8 / Lot 6, 2026-05-14) le bloquait. Le pre-push hook`pnpm lint:check && pnpm typecheck`fired sur le retry de push, raison root :`pnpm verify`(CLAUDE.md §3 sanity sweep) n'inclut PAS`lint:check`, donc le latent est passé sous le radar local du commit `04a96c7`. CLI scripts (apply-sql, export-schema, check-md-size, check-rpcs, check-drift, etc.) écrivent légitimement sur stdout — la rule globale cible app code (Vercel capture stdout en prod = log pollution), pas dev tooling local.

  **Files livrés** :
  - **Modifiés source** (2) : `app/globals.css` (+13 LOC : `:root { font-size: 15.5px }` + `input,textarea,select { font-size: 16px }` + 2 comments WHY), `eslint.config.mjs` (+6 LOC : nouveau bloc glob override `scripts/**/*.mjs` `no-console: off`).
  - **Modifiés conventions** (4) : `CLAUDE.md` §11 (Part 17 description maj : "(2)" → "(3)" + dernier sprint name Group-Transaction-Creator-Avatar → Mobile-Density-Shrink + "111 sprints" → "113 sprints" alignement avec chronology), `.claude/conventions/operational-rules.md` §5 (+1 subsection "Mobile UI density baseline"), `.claude/history/sprint-chronology.md` (+1 row Sprint Mobile-Density-Shrink + footer "112" → "113"), `.claude/history/roadmap-detailed-17-delete-header-income-polish.md` (ce closeout).

  **Vérification end-to-end** :
  - `pnpm verify` exit 0 (typecheck + format + tests + 6 db:\* checks) — premier run, avant le push.
  - `pnpm lint:check` exit 0 post-fix scripts/\*\* override — confirmé manuellement.
  - `git push origin cleanup` après le 2nd commit eslint : pre-push hook (lint:check + typecheck) vert, 6 commits poussés (4 pré-existants `04a96c7..3774347` + 2 nouveaux `5302b38..1b8220e`).
  - Tests stables 513 non-gated / 98 gated skipped.
  - Visual verification : à la charge de l'utilisateur sur son Fairphone 6 (l'ultime juge).

  **Trade-off / leçons apprises** :
  - **Root font-size shift > override `@theme --spacing` / `--text-*`** : le `--spacing` override seul change layout sans typography (proportions visuelles cassées vs. le request "réduire un peu tout"). Le `--text-*` override seul est verbeux (5-7 lignes à maintenir). Le root font-size shift est **1 ligne** qui propage uniformément à travers TOUS les rem-based utilitaires, y compris les nouveaux ajouts futurs sans maintenance. Reversal en 30 s en commentant 2 déclarations.
  - **Pourquoi 15.5 px et pas 15 px ou 14.5 px** : 15.5 px = -3 % vs default 16 px, "un petit cran" exact comme demandé. Bouton h-9 passe à 34.9 px (acceptable, padding parent ≥ 44 px compense), text-xs reste à 11.6 px (limite mais lisible). À 15 px (-6 %) ou 14.5 px (-10 %), h-9 descend à 33.75 / 32.6 px (sous Material 36 dp), text-xs à 11.25 / 10.9 px (limite lisibilité). Iteration facile sans rollback : éditer juste la valeur 15.5px → 15px et recharger.
  - **iOS Safari zoom is real** : `input/textarea/select { font-size: 16px }` est une garde non-négociable dès qu'on shift le root sous 16 px. Spec WebKit délibérée (accessibilité, éviter que les inputs aient l'air trop petits sur mobile au focus). À vérifier sur device réel iOS si le `DecimalFormInput` ou un autre composant utility-override surcharge le font-size — escalate à `!important` si zoom revient.
  - **`pnpm verify` ne lint pas** : leçon apprise — le `pnpm verify` (Sanity sweep CLAUDE.md §3 : typecheck + format:check + test:run + 6 db:\* checks) ne run PAS `pnpm lint:check`. Le pre-push hook `pnpm lint:check && pnpm typecheck` est donc le seul gate de lint avant push. Conséquence : un latent lint error peut passer entre les mailles plusieurs commits si jamais on ne push pas (cas vu : `04a96c7` md-size-gate landé localement, pré-existant à mon push). Pattern à retenir : lancer `pnpm lint:check` ad-hoc après un edit substantiel d'un script ou d'un fichier .mjs qui n'est pas standard staged.
  - **CLI scripts vs app code** : la rule globale `'no-console': ['error', { allow: ['warn', 'error'] }]` (Sprint Cleanup-I8 / Lot 6 2026-05-14) est correcte pour app code (Vercel capture stdout en prod = log pollution). Mais les scripts dans `scripts/**/*.mjs` sont du dev tooling local, où `console.log` est la primitive naturelle de communication avec l'utilisateur. Glob override est la bonne séparation de responsabilité.

  **Pattern à retenir** :
  - Pour tout shift de `root font-size`, ajouter systématiquement une garde `input, textarea, select { font-size: 16px }` pour préserver l'UX iOS Safari.
  - Tailwind 4 CSS-first : ne touche pas aux defaults `--spacing` / `--text-*` du `@theme`. Le root font-size shift propage uniformément sans toucher au système Tailwind.
  - Pour les nouveaux scripts CLI dev tooling (`scripts/*.mjs`), `console.log` est libre. Les app modules (`app/`, `lib/`, `components/`, `hooks/`, `contexts/`) restent gated `no-console: ['error', { allow: ['warn', 'error'] }]`.
  - Penser à `pnpm lint:check` ad-hoc après tout edit substantiel d'un fichier `.mjs` ou de scripts CLI — `pnpm verify` ne le couvre pas.

- ✅ **Sprint Fix-Auth-Flicker-And-Recap-Reentry-Gate** (livré 2026-05-21, déclenché par "J'aimerais qu'il soit impossible d'attérir sur l'écran de login ou un écran du monthly recap quand on appuie sur le retour du navigateur ou si on appuie sur le bouton de retour de notre téléphone. J'ai remarqué qu'en faisant ça, l'écran login peut flikerer. Et comme dit, on ne devrait JAMAIS pouvoir revenir sur l'écran d'un monthly recap déjà terminé.").

  **Constat pré-sprint** : (a) après login, appuyer sur back du navigateur (ou retour Android) provoque un flicker visible de `/connexion` avant que `proxy.ts:117-120` ne redirige vers `/dashboard` — root cause = `router.push('/dashboard')` dans `useLogin` (et `useRequireGuest`) qui laisse `/connexion` dans l'historique navigateur, lequel est servi instantanément par le bfcache mobile Safari/Chrome avant que le middleware n'ait fired ; (b) après avoir terminé un monthly-recap, le user peut y revenir via back (entrée `/monthly-recap` reste dans l'historique car `router.push('/dashboard')` au complete) ou via URL directe / bookmark / refresh F5 (pas de guard server-side sur `/monthly-recap` lui-même — `checkRecapStatus()` retourne `required: !hasExistingRecap` sans distinguer in-progress vs completed).

  **(1) Login : `router.push` → `router.replace`** ([hooks/useAuth.ts](../../hooks/useAuth.ts)) : conversion sur 2 sites — `useRequireGuest` L17 (guard guest-only pages) et `useLogin.handleLogin` L46 (post-login redirect). Le commentaire L47-49 mis à jour ("`router.replace` is non-blocking..."). `useLogoutAndRedirect` L81 reste en `router.push('/connexion')` car suivi immédiat par `handleLogout` → `window.location.href = '/connexion'` ([contexts/AuthContext.tsx:105](../../contexts/AuthContext.tsx)) qui fait un hard reload — l'historique est de toute façon clear pour purger le QueryClient cache. Le middleware déjà existant (`isAuthRoute && session?.userId` → redirect dashboard) reste le filet server-side ; le `router.replace` ferme la fenêtre où le bfcache rendait `/connexion` côté client AVANT que le middleware ne fire.

  **(2) Monthly-recap completion : `router.push` → `router.replace`** ([components/monthly-recap/MonthlyRecapFlow.tsx](../../components/monthly-recap/MonthlyRecapFlow.tsx)) : 2 sites — L52 (error handler "Retour au tableau de bord") et L138 (setTimeout post-complete success après 2s confirmation screen). Le `app/monthly-recap/page.tsx:53` garde son `window.history.pushState` initial + popstate handler (le back in-tab pendant un recap **in-progress** reste bloqué — confirmé par user en clarification AskUserQuestion). Le `router.replace` au complete dégage l'entrée `/monthly-recap` de l'historique au moment où l'utilisateur arrive sur `/dashboard` ou `/group-dashboard`.

  **(3) Extension `RecapStatus.isCompleted`** ([lib/recap/check-status.ts](../../lib/recap/check-status.ts)) : type `RecapStatus` étend d'un champ `isCompleted: boolean`. Le SELECT sur `monthly_recaps` passe de `select('id')` à `select('id, completed_at')`. Dérivation `isCompleted = existingRecap?.completed_at != null` dans les 2 branches profile/group. `hasExistingRecap` reste tel quel — les 2 axes sont orthogonaux (`hasExistingRecap=true && isCompleted=false` = in-progress, l'utilisateur peut revenir ; `hasExistingRecap=true && isCompleted=true` = terminé, lockout). Le `!= null` couvre null ET undefined, donc safe sur `existingRecap?.completed_at` quand existingRecap est null. La route API `app/api/monthly-recap/status/route.ts` retourne déjà `NextResponse.json(status)` — propage automatiquement le nouveau champ sans modification.

  **(4) Guard middleware server-side sur `/monthly-recap` terminé** ([proxy.ts](../../proxy.ts)) : nouvelle branche entre la garde no-session (L64-68) et le check recap-required (L100+, renuméroté). Pattern :

  ```typescript
  if (isSpecialRoute && session?.userId) {
    const queryContext = req.nextUrl.searchParams.get('context') === 'group' ? 'group' : 'profile'
    try {
      const status = await checkRecapStatus(session.userId, queryContext)
      if (status.isCompleted) {
        const redirectPath = queryContext === 'group' ? '/group-dashboard' : '/dashboard'
        return NextResponse.redirect(new URL(redirectPath, req.url))
      }
    } catch (error) {
      if (error instanceof RecapStatusError && error.code === 'NO_GROUP') {
        // Pas de groupe : laisser passer, le composant gérera l'affichage.
      } else {
        logger.error('❌ [Proxy] Erreur lors de la vérification recap terminé:', error)
      }
    }
  }
  ```

  Le `queryContext` est lu depuis `?context=` (passé par le redirect `proxy.ts:91-95` quand `required=true` depuis un dashboard) avec default `'profile'` si absent ou autre valeur. **Pas de cookie shortcut `recap-ok-*`** : la route `/monthly-recap` est peu fréquentée et le coût d'1 query Supabase par hit est négligeable. Le cookie existant `recap-ok-*` indique "no recap needed" (= required=false), pas "recap is completed" — re-utiliser ce cookie créerait une ambiguïté in-progress vs completed. `RecapStatusError.NO_GROUP` (utilisateur sans groupe ouvrant `/monthly-recap?context=group`) est tolérée — pass-through au composant.

  **Files livrés** :
  - **Modifiés source** (5) : `hooks/useAuth.ts` (2 conversions `push` → `replace`), `components/monthly-recap/MonthlyRecapFlow.tsx` (2 conversions), `lib/recap/check-status.ts` (interface + SELECT + dérivation `isCompleted`), `proxy.ts` (+18 LOC guard middleware), `app/api/monthly-recap/status/route.ts` (aucune modif, propagation auto).
  - **Modifiés conventions** (4) : `CLAUDE.md` §11 (Part 17 line maj "(3)→(4)" + dernier sprint name), `.claude/conventions/operational-rules.md` §5 (+1 subsection auth+recap nav), `.claude/history/sprint-chronology.md` (+1 row), `.claude/history/roadmap-detailed-17-delete-header-income-polish.md` (ce closeout).

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm format:check` exit 0 (après `prettier --write proxy.ts` sur le wrap d'une ligne longue)
  - `pnpm test:run` **513 passed / 98 skipped** (baseline stable, pas de test ajouté — la propriété `isCompleted` est mécanique, le typecheck garantit la complétude)
  - Smoke manuel attendu (charge user) : (a) login back-button → reste sur destination, pas de flicker `/connexion` ; (b) recap complete back-button → reste sur dashboard ; (c) URL direct `/monthly-recap` post-completion → redirect immédiat dashboard contextuel ; (d) back in-progress → blocage maintenu (popstate handler) ; (e) logout back → reste sur `/connexion` (hard reload `window.location.href` clear bfcache).

  **Trade-off / leçons apprises** :
  - **`router.replace` est suffisant côté client + middleware déjà existant suffit côté serveur pour le login flicker** : `proxy.ts:117-120` (`isAuthRoute && session?.userId`) redirige déjà server-side. Le flicker venait du bfcache mobile qui rendait `/connexion` cached AVANT que le middleware fire (browser optimization). `router.replace` élimine l'entrée historique, donc le bfcache n'a rien à rendre. Pas besoin de SSR redirect supplémentaire (le middleware reste le filet ultime contre navigation directe URL).
  - **Pas de SSR check sur `/connexion` côté page** : tentation de transformer `app/connexion/page.tsx` en server component qui call `validateSessionToken` et `redirect('/dashboard')` — mais le middleware le fait déjà, doublonnerait sans gain (le bfcache shortcut est exactly le cas où le middleware n'a pas fired, et un SSR check ne fire pas non plus pour un page-cache hit). `router.replace` est le seul vrai fix.
  - **`queryContext` default `'profile'` sur le middleware guard** : choix défensif. Si un user tape `/monthly-recap` direct sans `?context=`, on assume profile context (qui marche pour tous les users, y compris ceux sans groupe). Si l'utilisateur est en réalité dans un group context terminé mais a tapé `/monthly-recap` sans query, le guard ne fire pas → atterrit sur step 1 d'un new profile recap. Acceptable (cas marginal, l'utilisateur peut quitter manuellement).
  - **Pas de test ajouté sur `checkRecapStatus.isCompleted`** : mock de `supabaseServer` non-trivial à monter pour un cas pure-unit (chaining `.from().select().eq().eq().eq().single()`). Le typecheck couvre la complétude du champ ; un gated `SUPABASE_RECAP_TESTS=1` couvre déjà les recaps complete byte-identique. Si une régression surface plus tard, ajouter un cas dans le test gated.
  - **`isCompleted` orthogonal à `hasExistingRecap`** : décision conceptuelle — ne pas overload `required: !hasExistingRecap` qui sert au check "redirect to recap if missing this month". Garder les 2 axes séparés clarifie : `required` = "doit créer un recap" (in-flow trigger), `isCompleted` = "ne doit pas revenir" (out-flow lock). Les consumers existants (cookie `recap-ok-*`, redirect depuis dashboard) ignorent silencieusement le nouveau champ.

  **Pattern à retenir** :
  - **`router.replace` est obligatoire pour toute navigation sortant d'un écran "one-time / sensitive"** : login (post-auth), monthly-recap (post-complete), futurs flows wizard-style à étape finale. `router.push` laisse l'écran source dans l'historique, le bfcache mobile peut le re-rendre brièvement, et le back-button y revient. Pattern miroir possible à appliquer si on ajoute un wizard onboarding ou un payment flow.
  - **Garder un guard server-side `isCompleted` séparé sur les routes "one-time"** : le `router.replace` côté client n'élimine que l'historique de la session courante. URL bar, bookmark, deeplink push notif, nouvel onglet, refresh F5, ou crash-recovery de l'app peuvent toujours router vers la route sensible. Le middleware ferme ces vecteurs avec un check DB cheap.
  - **Étendre les fonctions de status applicatives avec des champs `isXxxCompleted`** plutôt que d'overload un champ existant — orthogonalité conceptuelle, consumers existants ne cassent pas, et le nouveau champ peut être adopté incrémentalement par les consumers qui en ont besoin.
  - **Lire les query params dans le middleware via `req.nextUrl.searchParams.get(...)`** plutôt que parser manuellement `req.url` — `nextUrl.searchParams` est un `URLSearchParams` standard, type-safe, immutable.
