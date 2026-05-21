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
