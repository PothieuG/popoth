# Structure du repo Popoth — inventaire fichiers

> **Archivé 2026-05-16** depuis CLAUDE.md §4 (lignes 67-228).
> Inventaire détaillé des dossiers `app/`, `components/`, `hooks/`, `lib/`, `supabase/`, `scripts/`, `docs/`, `prompts/`.
> Une partie de cet inventaire est régénérable via `git ls-files` ou `tree` ; ce fichier garde la version annotée
> (avec descriptions par fichier, pattern miroir, etc.) qui n'est PAS récupérable automatiquement.
>
> **À tenir à jour** : quand un nouveau module est ajouté/supprimé/déplacé, mettre à jour cet inventaire
> (puisque CLAUDE.md ne le contient plus pour rester ≤ 40 KB).

---

## 4. Structure du repo

> ⚠️ **Note historique (chantier 16 + Mission-suppression-audits — 2026-05-16)** : 2 cleanup massifs ont archivé la doc audit. Chantier 16 (2026-05-15) : `docs/audit/` + `prompts/`. Mission-suppression-audits (2026-05-16) : `audit_2/` + `audit_3/` (working set des prompts une fois tous les sprints livrés). Les 2 survivants doc migrés : `docs/db/SCHEMA.md` → [`doc2/db/SCHEMA.md`](./doc2/db/SCHEMA.md) et `docs/api/README.md` → [`doc2/api/README.md`](./doc2/api/README.md). Les références `docs/audit/*.md`, `prompts/*.md`, `audit_2/*.md`, `audit_3/*.md` qui persistent dans cette doc (§4 inventaire + §11 roadmap narrative) sont historiques — recovery via `git show <sha>:<path>` à partir du commit correspondant.

```
app/                       # App Router (pages + API routes)
  api/
    debug/                 # 6 routes seed/reset (post Sprint Polish T2) — BLOQUÉES en prod via blockInProduction()
    finance/               # ✅ Sprint Refactor-Architecture v1+v2 — namespace canonique unifié (12 routes)
                           #   summary, rav, budgets (POST/PUT/DELETE only), budgets/estimated, incomes,
                           #   income/{real,estimated,progress}, expenses/{real,add-with-logic,preview-breakdown,progress}
                           #   Toutes ré-exportent les handlers depuis lib/api/finance/<route>.ts
                           #   Sprint v2 a supprimé /api/finance/dashboard (0 consumer, 457 LOC dead code)
                           #   et le GET sur /api/finance/budgets (read passe par /budgets/estimated)
    monthly-recap/         # workflow récap mensuel — process-step1 est désormais un thin handler (~45 LOC) post-Sprint Refactor-I5 ; la logique métier vit dans lib/recap/
    savings/transfer/      # transferts budget↔budget et budget↔tirelire
    docs/                  # ✅ Sprint OpenAPI-Schema-To-Docs — `/api/docs` sert un HTML Swagger UI (chargé via CDN unpkg, zéro dep) ; `/api/docs/openapi.json` sert le doc OpenAPI 3.1 généré depuis le registry. Public (pas d'auth) — DX gain pour les API consumers + onboarding nouveaux devs.
components/                # UI (shadcn/ui sous components/ui/)
  ui/DecimalFormInput.tsx  # ✅ Sprint Zod-Rollout v4 — composant générique <T extends FieldValues> qui wrap Controller + shadcn Input + regex décimal + comma→dot. Consommé par 8 sites post-v4 (EditBalance/AddIncome/EditIncome/AddBudget/EditBudget/AddTransaction/EditTransaction/CreateGroup). Pour tout nouveau form décimal validé via `z.coerce.number()`, utiliser ce composant plutôt que de réécrire le pattern inline.
  ui/modal-close-x.tsx     # ✅ Sprint Zod-Rollout v10 — composant `<ModalCloseX onClose disabled? variant='circle'|'ghost' className? svgClassName? ariaLabel?>` qui centralise le SVG path `M6 18L18 6M6 6l12 12` + `aria-label="Fermer"` + `aria-hidden` sur le `<svg>`. Consommé par 11 sites dans 10 fichiers post-v10 (Edit/Add Budget/Income + Add/EditTransaction + Planning/SavingsDistribution drawers + nested transfer + GroupMembers + DeleteGroup). Variantes : `circle` h-8 w-8 rounded-full bg-gray-100 (6 sites), `ghost` h-8 w-8 rounded-md hover:bg-accent (4 sites). Pour tout nouveau modal Radix-migré, utiliser ce composant plutôt que de dupliquer le raw button + SVG inline.
  ui/drawer-content-classes.ts # ✅ Sprint Zod-Rollout v9 — `DRAWER_CONTENT_CLASSES` constant single source of truth pour le drawer bottom-up fullscreen override de `<DialogContent>`. Consommé par PlanningDrawer + SavingsDistributionDrawer (2 sites). Pour tout nouveau drawer fullscreen bottom-up, importer cette constante plutôt que dupliquer l'override className inline.
  __tests__/a11y-helpers.ts # ✅ Sprint Zod-Rollout v10 — helper test `expectEscClose(element, onClose, titleText: string | RegExp)` centralise le 5-line boilerplate focus-trap regression-guard (render + waitFor getByText + user.keyboard Escape + expect onClose called). Consommé par 10/12 cas dans a11y-audit.test.tsx (2 cas spéciaux restent manuels : EditTransactionModal heading level 2 + nested-stacking PlanningDrawer+AddBudget). Pour tout nouveau modal Radix-migré, ajouter un cas focus-trap via ce helper.
  providers/QueryProvider.tsx # ✅ Sprint 1.5 — 'use client' wrapper QueryClientProvider + ReactQueryDevtools (dev only). Mounted outermost in app/layout.tsx
  settings/SettingsDrawer.tsx # ✅ Sprint Refactor-Settings-Drawer (2026-05-18) — drawer slide-right partagé entre dashboard + group-dashboard. Héberge un swap horizontal in-place entre 2 panels (`main` + `group-management`) via `absolute inset-0` + `transition-transform duration-300` + `translate-x-{-full,0,full}` dans un container `overflow-hidden`. Reset à 'main' 300ms après close (cleanup-friendly setTimeout). Props : `title`, `showProfileCard`, `showBankBalanceLine`, `bankBalance`, `onBankBalanceUpdate`, `onLogout`. Le bouton "Gestion du groupe" est stylé menu-item iOS (gradient bleu-indigo + icône en bulle dégradée 40px + label gras + sous-label + chevron `›`). **Path B closed-by-deletion** : `app/settings/page.tsx` supprimé (route full-route + `window.location.href` + `window.history.back()` éliminés — le bug intermittent "1 fois sur 2 retour au dashboard" disparaît mécaniquement). 8ᵉ application Path B closed-by-deletion (cf [@.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §1).
  settings/GroupManagementPanel.tsx # ✅ Sprint Rework-Group-Management (2026-05-19, dernière modification — initial extraction au Sprint Refactor-Settings-Drawer 2026-05-18) — 3 zones flex-col : header (back+close), content scrollable, footer pinned bottom. **Content branche `hasGroup`** : CTA prominent "Voir les membres" style iOS menu item (gradient bleu-indigo + bulle icône 40px + chevron) + section "Informations du groupe" en `<dl>` plat avec séparateurs `border-b border-gray-100 py-2` (nom/budget/membres/créé le) + badge "Créateur" inline. **Content branche `!hasGroup`** : 2 sections plates "Créer" + "Rejoindre" sans Card chrome (CreateGroupForm + Input search + GroupSearchList). **Footer pinned bottom** (`border-t border-gray-200 p-4`) : Button full-width orange "Quitter le groupe" + encart info ambré au-dessus si `isCreatorBlocked = is_creator && memberCount > 1` (creator avec membres → bouton désactivé + message "Les autres membres doivent d'abord quitter"). `handleLeaveClick` court-circuité défense-in-depth si bloqué. ConfirmationDialog message updated pour creator-alone case ("Vous êtes le seul membre, le groupe restera sans membre"). Patterns ❌ documentés [@.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §5 Modals & UI (sections plates / footer destructive / readonly+backend-match).
  groups/GroupMembersWithContributionsModal.tsx # ✅ Sprint Rework-Group-Management (2026-05-19) — hauteur fixe `h-[80vh] max-h-[80vh]` au lieu de `max-h-[90vh]` + content interne `flex-1 overflow-y-auto` (remplit l'espace entre header+footer dans les 80vh). 3 redondances avec parent panel retirées : header "Budget: X €/mois", footer "Résumé du groupe" Card (budget+total), compteur "Total: X €" inline. 1 info privée retirée per-member : "Basé sur un salaire de X €". Conservé per-member : avatar + prénom/nom + date joined + badge créateur + contribution amount + percentage. Destructuring `groupInfo` retiré (plus de consumer). Migration Radix Dialog + `<ModalCloseX variant="ghost" />` préservée (Sprint Zod-Rollout v8/v10).
contexts/AuthContext.tsx   # ✅ Sprint Hygiène-Code — split en `AuthUserContext` + `AuthActionsContext` ; hooks `useAuthUser()` / `useAuthActions()`. Sprint 2-followup-v5 — l'aggregator `useAuth()` (qui spread les deux contexts) a été supprimé : 0 consumer en prod. Si jamais un consumer en a besoin, recréer ad-hoc.
hooks/                     # 20 hooks React — ✅ Sprint 1.5 : 11 hooks fetcher migrés sur TanStack Query (useQuery + useMutation)
  useRavValidation.ts      # ✅ Sprint Refactor-Architecture — useMemo pur, validation { blocked, newRav } pour AddTransactionModal
  useStep1Data.ts          # ✅ Sprint 1.5 — useQuery({ queryKey: ['step1-data', context] }) ; { data, loading, error, refresh } shape preserved
  useBudgetProgress.ts     # ✅ Sprint Refactor-Architecture — dedupe state + sync effect → return useMemo direct
  useFinancialData.ts      # ✅ Sprint 1.5 — useQuery natif. Sprint 2 — bridge legacy `triggerFinancialRefresh`/`registerFinancialRefreshCallback` supprimé ; les mutations cross-domain invalident `['financial-summary']` + `['progress-data']` + `['budgets']` via [`invalidateFinancialRefreshes(qc)`](lib/query-client.ts) (single source of truth, Sprint 2-followup). Sprint 2-followup — bloc debug `console.log` ~17 lignes dans queryFn supprimé (dump du payload financier à chaque fetch ; data toujours visible via TanStack Query DevTools si besoin)
  useProgressData.ts       # ✅ Sprint 1.5 — useQuery({ queryKey: ['progress-data', context] }) ; le contextRef pattern C ref site est éliminé natif via queryKey. Sprint 2 — bridge effect supprimé (les mutations cross-domain invalident `['progress-data']` directement)
  useBudgets.ts            # ✅ Sprint 1.5 — useQuery + 3 useMutation (add/update/delete). Sprint 2 — bridge effect supprimé ; les mutations CRUD invalident `['financial-summary']` + `['progress-data']` + `['budgets']` directement via [`invalidateFinancialRefreshes`](lib/query-client.ts) (Sprint 2-followup — extraction du helper local vers single source of truth)
  useIncomes.ts            # ✅ Sprint 1.5 — useQuery + 3 useMutation
  useRealExpenses.ts       # ✅ Sprint 1.5 — useQuery + 3 useMutation (smart-allocation : mutation result peut être null si dépense couverte 100% par piggy/savings)
  useRealIncomes.ts        # ✅ Sprint 1.5 — useQuery + 3 useMutation
  useProfile.ts            # ✅ Sprint 1.5 — useQuery + 2 useMutation (create/update)
  useGroups.ts             # ✅ Sprint 1.5 — useQuery + 5 useMutation (create/update/delete/join/leave) avec optimistic updates via setQueryData
  useExpenseProgress.ts    # ✅ Sprint 1.5 — useQuery (fetcher pur) ; renvoie Record<budgetId, ExpenseProgress>
  useIncomeProgress.ts     # ✅ Sprint 1.5 — derived state via useMemo direct (pas Query, dépend de useRealIncomes)
lib/
lib/
  query-client.ts          # ✅ Sprint 1.5 — createQueryClient() factory (staleTime 30s, refetchOnWindowFocus false, retry 1) ; consommé par components/providers/QueryProvider.tsx
  supabase-server.ts       # client serveur (service_role) — BYPASS RLS
  supabase-client.ts       # client browser (anon key) — soumis à RLS
  database.types.ts        # types Supabase générés (pnpm db:types) — Sprint DB D6 (inclut désormais les 4 RPC C3 depuis le regen Sprint Cleanup-Legacy / C1, augmentation lib/database.ts supprimée en Sprint Polish-CI / D3)
  session.ts               # JWT (jose) pour cookie session
  session-server.ts        # validateSessionToken() — utilisé dans toutes les routes API
  debug-guard.ts           # blockInProduction() pour /api/debug/*
  expense-allocation.ts    # calculateBreakdown + applyAllocation (lecture, RPC à l'écriture)
  # NOTE: lib/financial-calculations.ts (1069 LOC god file) supprimé au Sprint Refactor-I4 —
  # tout le code a migré sous lib/finance/ (cf. ci-dessous). 18 importers ont basculé vers @/lib/finance.
  logger.ts                # ✅ Sprint Cleanup-I8 / Lot 1 — logger général level-aware Edge-safe (LOG_LEVEL gated, défaut warn prod / debug dev). Boundary `console.*` du repo ; tout le reste appelle logger.error/warn/info/debug
  # NOTE: lib/financial-logger.ts (288 LOC) supprimé au Sprint Refactor-I4 follow-up (warm-melody) —
  # son seul consumer (lib/api/finance/income-real.ts) utilisait 1 site, migré vers logger.debug.
  database-snapshot.ts     # createFullDatabaseSnapshot — utilise SnapshotPayloadV2 (Sprint Polish T4)
  recap-snapshot.types.ts  # ✅ SnapshotPayload v1/v2 discriminated union + isSnapshotV2() (Sprint Polish T4)
  recap/                   # ✅ Sprint Refactor-Architecture (check-status) + Sprint Refactor-I5 (step1 split)
    check-status.ts        # ✅ Sprint Refactor-Architecture — checkRecapStatus(userId, context) Edge-safe ; importé par proxy.ts ET app/api/monthly-recap/status/route.ts (au lieu d'un fetch HTTP self-call)
    types.ts               # ✅ Sprint Refactor-I5 — ProcessStep1Input/Snapshot/Decision/Output + BudgetAnalysis + AllocationOperation discriminated union. **5 membres post Sprint Refactor-I5-followup** ('1.1' | '2.2' | '2.3.1' | '2.4.1' | '2.4.2.2' — `consume_surplus` step '2.3' droppé, dead code prod).
    step1-algorithm.ts     # ✅ Sprint Refactor-I5 — decideStep1Allocation(snapshot) pure (0 I/O, 0 console, immutable, sort by id pour déterminisme). Préserve l'asymétrie ROUNDING_TOLERANCE (`<=` pour is_fully_balanced L566/L762). ~260 LOC post Sprint Refactor-I5-followup (drop step 2.3 block + unused `budgetsWithSurplus`).
    step1-persist.ts       # ✅ Sprint Refactor-I5 — processStep1(input) = loadSnapshot → decideStep1Allocation → applyDecision. Fix race L673 (raw UPDATE → updateBudgetCumulatedSavings RPC atomique). Préserve les 2 INSERT budget_transfers fail-soft (étapes 2.3.1 et 2.4.2, étape 2.3 supprimée Sprint Refactor-I5-followup). 0 console.* (logger.warn pour fail-soft + logger.error pour RPC fail + logger.info audit-trail). JSDoc explicite concurrent-invocation edge case sur `processStep1()` (Sprint Refactor-I5-followup — pipeline non-transactionnel, double-invocation peut laisser DB partiellement appliquée). ~350 LOC post Sprint Refactor-I5-followup-v2 (étape 2.4.2 réécrite via `transferWithSavingsDebit` atomique : INSERT + debit en une tx Postgres, deux appels fail-soft → un seul, `applyDecision` exporté comme surface de test).
    index.ts               # ✅ Sprint Refactor-I5 + I6 + Refactor-Auto-Balance — barrel re-export (checkRecapStatus, processStep1, processComplete, processAutoBalance, decideStep1Allocation, decideCompleteAllocation, decideAutoBalanceAllocation + types + RecapBudgetNotFoundError + RecapContextError + RecapNoBudgetsError + AutoBalanceAllocationOperation/AutoBalanceBudgetAnalysis aliases pour éviter collision avec step1)
    complete-types.ts      # ✅ Sprint Refactor-I6 — ProcessCompleteInput/Snapshot/Decision/Output + BudgetSnapshot/BudgetTransferSnapshot + AllocationOperation discriminated union + RecapBudgetNotFoundError/RecapContextError classes
    complete-algorithm.ts  # ✅ Sprint Refactor-I6 — decideCompleteAllocation(snapshot, input) pure (0 I/O, 0 console, immutable, sort by id pour déterminisme). Compose recapData (insert/update) + carryoverUpdates per budget + preTransfer/postTransferBudgetDeficit + exceptionalExpense (si adjustedDifference<0) + surplusTransfers + totalSurplus/Deficit + selectedBudgetName. Mirror step1-algorithm invariants. ~210 LOC.
    complete-persist.ts    # ✅ Sprint Refactor-I6 — processComplete(input) = loadCompleteSnapshot → decideCompleteAllocation → applyCompleteDecision. **Fix race L484** (raw SELECT-then-UPDATE on cumulated_savings → updateBudgetCumulatedSavings RPC atomique). Préserve 4 fail-soft branches (savings + cleanup + carryover + exceptional). N+1 query dedup (1 SELECT pour real_expenses + transfers, groupBy en JS). 0 console.* (logger.warn pour fail-soft + logger.error pour critique). Degenerate state improvement : bank missing → bankCurrent=0 + compute exceptional (was: skip silently). ~400 LOC.
    __tests__/step1-algorithm.test.ts  # ✅ Sprint Refactor-I5 — **28 cas** pure-unit non-gated post Sprint Refactor-I5-followup (était 33 pré-followup, −5 cas du describe `CAS 2 ÉTAPE 2.3` droppé + 1 obsolète `skip-decision asymmetry`) couvrant CAS 1, CAS 2 ÉTAPE 2.2/2.3.1/2.4.2, tolérance asymétrique, edge cases, déterminisme, ordering snapshot 2.2→2.3.1
    __tests__/step1-persist.test.ts    # ✅ Sprint Refactor-I5-followup-v2 — 8 cas mocked non-gated couvrant `applyDecision` orchestration (CAS 1 piggy push + zero ops ; CAS 2 2.4.2 happy path atomique + fail-soft mid-flight ; CAS 2 2.2 throw propage ; CAS 2 2.3.1 INSERT fail-soft ; isFullyBalanced true+empty / false+non-empty regression guards)
    __tests__/complete-algorithm.test.ts  # ✅ Sprint Refactor-I6 — 32 cas pure-unit non-gated (<0.5s) couvrant recapData composition (8) / Block 3 deficit + carryover (6) / Block 4 exceptional expense (7) / Block 5 surplus transfers (5) / summary totals (2) / recapOperation discriminator (2) / determinism (2)
    __tests__/complete-persist.test.ts    # ✅ Sprint Refactor-I6 — 18 cas mocked non-gated (~1s) couvrant applyCompleteDecision (4 happy + 5 fail-soft + 2 critique throw) + loadCompleteSnapshot (7 cas dont 4 SELECT fail mappés + RecapBudgetNotFoundError)
    auto-balance-types.ts  # ✅ Sprint Refactor-Auto-Balance (2026-05-16) — ProcessAutoBalanceInput/Snapshot/Decision/Output + BudgetAnalysis + AutoBalanceTransfer + AllocationOperation discriminated union ('0.piggy_distribute' | '1.savings_transfer' | '2.surplus_transfer') + ProcessAutoBalanceOutput discriminated union AutoBalanceSuccessOutput | AutoBalanceEmptyOutput + RecapNoBudgetsError class. 0 runtime.
    auto-balance-algorithm.ts # ✅ Sprint Refactor-Auto-Balance — decideAutoBalanceAllocation(snapshot) pure (0 I/O, 0 console, immutable, sort by id ASC pour déterminisme). 3 phases (piggy / savings / surplus). Self-transfer guard PHASE 1+2 (un budget ne se transfère pas à lui-même). Latent bug L314 cosmétique préservé verbatim (remainingDeficitToCover gating-only, PHASE 2 recompute per-budget correct). Return AutoBalanceAlgorithmResult discriminé (decision / no_deficit / no_resources / no_transfers). ~297 LOC.
    auto-balance-persist.ts   # ✅ Sprint Refactor-Auto-Balance — processAutoBalance(input) = loadAutoBalanceSnapshot → decideAutoBalanceAllocation → applyAutoBalanceDecision. Atomicité PHASE 0+1 via composite RPCs (transferPiggyToBudgetWithInsert + transferWithSavingsDebit, per-pair fail-soft logger.warn + continue mirror Sprint Auto-Balance-Atomic + Phase-B). PHASE 2 surplus via batched INSERT (no debit — surplus computed). buildTransferPayload helper TS-narrowing computed-key (pattern miroir step1-persist). 0 console.* (logger.warn fail-soft + logger.error critique + logger.info audit-trail). ~332 LOC.
    __tests__/auto-balance-algorithm.test.ts # ✅ Sprint Refactor-Auto-Balance — 37 cas pure-unit non-gated <0.5s couvrant 3 early-returns + 8 PHASE 0 + 8 PHASE 1 + 8 PHASE 2 + 5 mixed phases + 5 determinism+edge cases (negative savings filter, sort by id, no mutation, rounding 0-skip)
    __tests__/auto-balance-persist.test.ts   # ✅ Sprint Refactor-Auto-Balance — 17 cas mocked non-gated ~0.3s couvrant applyAutoBalanceDecision (4 happy PHASE 0/1/2/mixed + 3 fail-soft savings+piggy mid-flight + surplus batched INSERT hard error) + loadAutoBalanceSnapshot (7 cas happy + 3 SELECT-fail mappés + 2 piggy fail-soft + RecapNoBudgetsError) + processAutoBalance orchestration (3 cas happy + no_deficit early + no_resources early)
    recover-types.ts       # ✅ Sprint Refactor-Recover (2026-05-16) — ProcessRecoveryInput/Snapshot/Decision/Output + RecoveryResults (route shape) + RestorableTable (7 tables literal union) + CountResultKey/BooleanResultKey/ResultKey + RestorationAction discriminated union ('restore_table' | 'update_bank_balance_v1') + 4 error classes (RecoverContextError 400, RecoverSnapshotNotFoundError 404, RecoverSnapshotCorruptedError 500, RecoveryAppliedPartiallyError 500 carrying partialResults). JSDoc explicit sur 5 tables v2 NON-restaurées par design (profiles/groups/group_contributions/monthly_recaps/remaining_to_live_snapshots). 0 runtime.
    recover-algorithm.ts   # ✅ Sprint Refactor-Recover — decideRecoveryActions(snapshot) pure (0 I/O, 0 console, immutable). Dispatch v1|v2 via isSnapshotV2() predicate. Ordering FK-safe deterministe (estimated_incomes → estimated_budgets → real_income_entries → real_expenses → bank_balances → piggy_bank → budget_transfers). Skip-on-empty semantics (mirror route L128 early-return — decision contient seulement les actions qui vont muter la DB). Bank dispatch : V2 non-empty bank_balances → restore_table / V2 empty + scalar bank_balance:number → v1 fallback UPDATE / autres → skip. ~165 LOC.
    recover-persist.ts     # ✅ Sprint Refactor-Recover — processRecovery(input) = loadRecoverySnapshot → decideRecoveryActions → applyRecoveryDecision. Per-action fail-soft (errors push into RecoveryResults.errors[], flow continues mirror route L206-211). Snapshot deactivation (step 8) fail-soft via logger.warn. **CLEANUP-ATTEMPT CRITIQUE préservé verbatim** (route L286-288, Sprint Lot 5b 2026-05-10 KEEP+migrate) : unexpected exceptions → logger.error '[recover] rollback partiel impossible (snapshot may stay active)' + throw RecoveryAppliedPartiallyError carrying partialResults (HTTP handler retourne 500 + recovery_results in body). Strict boolean invariant `true`/`false` pour bank_balance/piggy_bank (Sprint Lint-Followups Item 1). Switch sur RestorableTable literal union avec TablesInsert<'X'>[] strict typing (0 `as any`). ~310 LOC.
    __tests__/recover-algorithm.test.ts # ✅ Sprint Refactor-Recover — **21 cas pure-unit non-gated** ~10ms couvrant V2 dispatch (8 — full happy 7 tables FK-ordered, bank dispatch non-empty vs empty+scalar vs null, piggy empty/non-empty, transfers, real_incomes resultKey quirk), V1 fallback (4 — full happy 5 actions, only bank update, bank=0 valid, snapshot_version undefined legacy), edge cases (5 — all empty 0 actions, single table, multiple rows pass-through, FK order budgets<expenses, FK order budgets<transfers), determinism (4 — same snapshot same decision, no mutation, fresh decision per call, shape contract).
    __tests__/recover-persist.test.ts   # ✅ Sprint Refactor-Recover — **16 cas mocked non-gated** ~600ms couvrant applyRecoveryDecision (4 happy V1/V2/empty/bank-v1-only + 3 fail-soft DELETE/INSERT/v1-update + 1 CLEANUP-ATTEMPT CRITIQUE preservation via logger.error + RecoveryAppliedPartiallyError + 1 step 8 fail-soft) + loadRecoverySnapshot (7 — happy, with snapshotId .eq query path, without snapshotId .order.limit path, snapshot not found → NotFoundError, missing estimated_incomes → CorruptedError, snapshot_data null → CorruptedError, group context missing contextId → ContextError). Strict boolean regression-guards toStrictEqual(true) sur V1+V2 bank/piggy paths.
  schemas/                 # ✅ Sprint Refactor-I5 — Zod schemas API
    recap.ts               # processStep1BodySchema (1er schema, premier morceau du chantier 07.8 Zod rollout)
  api/                     # ✅ Sprint Refactor-Architecture v1+v2 — handlers extraits, ré-exportés par app/api/finance/**/route.ts
    parse-body.ts          # ✅ Sprint Refactor-I5 — parseBody<T>(req, schema) + BadRequestError + handleBadRequest(error). Validation Zod centralisée pour les handlers
    __tests__/parse-body.test.ts  # ✅ Sprint Refactor-I5 — 6 cas non-gated (happy path, malformed JSON, schema mismatch, etc.)
    with-auth.ts           # ✅ Sprint Refactor-Architecture-v3+v4+v5 — withAuth(handler) + withAuthAndProfile(handler) higher-order helpers utilisés par 34 modules (12 finance + 21 Volet C + process-step1 depuis v5). Profile shape étendu en v4 à { id, group_id, first_name, last_name }. Signature étendue avec 2 overloads en v5 : (a) static-route signature sans routeContext, (b) dynamic-route signature avec generic `<TParams>` et routeContext NON-optionnel — élimine le `routeContext!` dans groups/[id]/** sans casser la cohabitation static. Tests gated `SUPABASE_API_TESTS=1` dans [lib/api/__tests__/with-auth.test.ts](lib/api/__tests__/with-auth.test.ts) (12 cas, Sprint v5).
    finance/               # 12 modules : summary, rav, budgets (POST/PUT/DELETE), budgets-estimated, incomes, income-{real,estimated,progress}, expenses-{real,add-with-logic,preview-breakdown,progress}
    __tests__/             # ✅ Sprint Refactor-Architecture-v5
      with-auth.test.ts    # gated SUPABASE_API_TESTS=1 — 12 cas withAuth + withAuthAndProfile (auth, expired payload, overloads, profile shape, isolation)
  constants/               # ✅ Sprint Hygiène-Code — magic numbers extraits
    auth.ts                # SESSION_EXPIRATION_SECONDS (3600), SESSION_EXPIRATION_JOSE ('1h'), SESSION_REFRESH_INTERVAL_MS (50min), AUTH_CHECK_INTERVAL_MS (5min)
    finance.ts             # ROUNDING_TOLERANCE (0.01) — utilisé dans process-step1 (6 sites)
  finance/                 # ✅ Sprint 0 C3 (RPC atomiques) + Sprint Refactor-I4 (split god file 1069 LOC)
    # Sprint 0 / C3 — atomic RPC helpers (single-call + retry-safe DB writes)
    context.ts             # ContextFilter type discriminé { profile_id } | { group_id } + asContextFilter() + resolveContextIds()
    piggy-bank.ts          # updatePiggyBank, transferFromPiggyToBudget, transferPiggyToBudgetWithInsert, ensurePiggyBankRow (Sprint Fix-Empty-Recap-Tirelire — idempotent INSERT amount=0 before RPC writes)
    bank-balance.ts        # updateBankBalance
    budget-savings.ts      # updateBudgetCumulatedSavings
    budget-transfers.ts    # ✅ Sprint Refactor-I5-followup-v2 — transferWithSavingsDebit (composite RPC : INSERT budget_transfers + debit cumulated_savings en une tx Postgres)
    expenses.ts            # ✅ Sprint Atomicity-Expenses — addExpenseWithBreakdown (composite RPC : debit piggy + debit cumulated_savings + INSERT real_expenses en une tx Postgres atomique)
    savings.ts             # ✅ Sprint Atomicity-Savings — transferSavingsBetweenBudgets (debit FROM + credit TO en 1 tx) + transferBudgetToPiggyBank (debit budget + UPSERT piggy_bank via partial unique index inference en 1 tx)
    # Sprint Refactor-I4 — modules extraits de l'ex-god file lib/financial-calculations.ts
    types.ts               # FinancialData, BudgetSavings interfaces
    constants.ts           # EMPTY_FINANCIAL_DATA (frozen, fallback fail-soft pour get*FinancialData)
    calc-rtl.ts            # 5 helpers PURS : calculateAvailableCash, calculateRemainingToLive{Profile,Group}, calculateBudgetSavings, calculateBudgetDeficit (no I/O)
    income-compensation.ts # calculateIncomeCompensation(filter: ContextFilter) — unifie les 95%-identiques profile/group
    rav-persistence.ts     # saveRavToDatabase + getRavFromDatabase (lecture/écriture RAV en bank_balances)
    financial-data.ts      # _loadFinancialData(filter, opts) factorisé + 2 wrappers getProfileFinancialData / getGroupFinancialData
    budget-savings-detail.ts # getBudgetSavingsDetail (profile-only, breakdown par budget)
    snapshots.ts           # saveRemainingToLiveSnapshot({profileId?, groupId?, reason}) — fail-soft Promise<boolean>, dispatcher + private inserter via ContextFilter
    index.ts               # barrel re-export — consumers : import { ... } from '@/lib/finance'
    __tests__/             # Sprint DB + Sprint Refactor-I4 + Sprint Refactor-I5-followup-v2 + Sprint Atomicity-Expenses
      rpc-concurrency.test.ts            # gated SUPABASE_RPC_CONCURRENCY_TESTS=1
      rls-isolation.test.ts              # gated SUPABASE_RLS_TESTS=1
      transfer-with-savings.test.ts      # ✅ Sprint Refactor-I5-followup-v2 — gated SUPABASE_RPC_CONCURRENCY_TESTS=1, 4 cas atomicité transfer_with_savings_debit (happy / insufficient savings rollback / 100× concurrent / XOR validation)
      add-expense-with-breakdown.test.ts # ✅ Sprint Atomicity-Expenses — gated SUPABASE_RPC_CONCURRENCY_TESTS=1, 6 cas atomicité add_expense_with_breakdown (happy / insufficient piggy / insufficient savings = piggy rolled back / 100× concurrent / XOR / no-op zero piggy zero savings)
      transfer-savings.test.ts           # ✅ Sprint Atomicity-Savings — gated SUPABASE_RPC_CONCURRENCY_TESTS=1, 8 cas (4 transfer_savings_between_budgets : happy / insufficient FROM / 100× concurrent / XOR + 4 transfer_budget_to_piggy_bank : happy UPDATE / happy INSERT via ON CONFLICT / insufficient budget = piggy unchanged / 100× concurrent)
      calc-rtl.test.ts                   # ✅ I4 — 19 cas pure-unit non-gated, formules RAV/budget/cash
      snapshots.test.ts                  # ✅ I4 — 5 cas mocked supabase non-gated, validation + R1 fail-soft contract
  __tests__/               # ✅ Sprint Polish T3
    api-regressions.test.ts  # gated SUPABASE_API_TESTS=1 — H1/H2/R2 regressions
  openapi/                 # ✅ Sprint OpenAPI-Schema-To-Docs — génération de la doc OpenAPI 3.1 depuis les schemas Zod
    registry.ts            # `RouteDef[]` — single source of truth (path, method, summary, tag, body/query schema, pathParams, requiresAuth) pour 36 paths / 63 opérations. Ajouter une entrée quand on ajoute une route API.
    generate.ts            # `generateOpenAPI()` — transforme le registry en OpenAPI 3.1 JSON via `z.toJSONSchema()` natif Zod 4 (zéro dep externe). Cache module-level. Refines droppés (limite JSON Schema), transforms → `{}` via `unrepresentable: 'any'`.
scripts/                   # Sprint DB outils API Management (sans Docker)
  export-schema.mjs        # snapshot prod schema → SQL baseline (⚠️ filtre trigger buggy, cf. Sprint Audit-Triggers v6)
  apply-sql.mjs            # applique un .sql via API Management (drift recovery, ou SELECT lecture seule)
  check-drift.mjs          # backend de pnpm db:check-drift
  check-rpcs.mjs           # backend de pnpm db:check-rpcs
  list-triggers.sql        # ✅ Sprint Polish T5 — SELECT pg_trigger pour inventaire
supabase/
  config.toml              # CLI config (lié au projet distant)
  migrations/              # ✅ baseline + RLS + perf + dedup (Sprint DB) + dedup R3 + recursive policy R6 + overdraft H3
    20260101000000_remote_schema.sql           # baseline hand-curated (D5) — ⚠️ -- (no user triggers) due to filter bug v6
    20260506000000_create_finance_rpcs.sql     # 4 RPC C3 — NE PAS MODIFIER
    20260507000000_enable_rls_piggy_bank.sql   # D1
    20260507000001_fix_group_contributions_policy.sql  # D2
    20260507000002_fix_remaining_to_live_insert.sql    # D3
    20260508000000_add_piggy_bank_indexes.sql  # D7
    20260508000001_add_piggy_bank_constraints.sql  # D8
    20260509000000_dedupe_profiles_policies.sql    # D10
    20260510000000_dedupe_indexes_constraints.sql  # R3
    20260510000001_drop_recursive_profiles_policy.sql  # R6 — fix infinite-recursion sur profiles SELECT
    20260511000000_align_bank_balance_overdraft.sql    # H3 — RAISE EXCEPTION dans update_bank_balance
    20260516000000_create_transfer_with_savings_debit_rpc.sql  # ✅ Sprint Refactor-I5-followup-v2 — RPC composite INSERT budget_transfers + debit cumulated_savings en une tx (atomicité étape 2.4.2)
    20260517000000_create_add_expense_with_breakdown_rpc.sql   # ✅ Sprint Atomicity-Expenses — RPC composite debit piggy + debit cumulated_savings + INSERT real_expenses en une tx
    20260518000000_create_savings_transfer_rpcs.sql            # ✅ Sprint Atomicity-Savings — 2 RPCs composites : transfer_savings_between_budgets (debit FROM + credit TO) + transfer_budget_to_piggy_bank (debit budget + UPSERT piggy_bank avec partial unique index inference)
docs/audit/                # Audit complet codebase 2026-04
  00-executive-summary.md  # vue d'ensemble + score
  06-action-plan.md        # plan multi-sprint
  RLS-FINDINGS.md          # snapshot RLS pré-Sprint DB (les 3 failles sont closes)
  POST-MORTEM-C3-DRIFT.md  # post-mortem du drift schema_migrations ↔ pg_proc (R0)
  07-deep-dive-*.md        # playbooks par chantier
docs/db/                   # ✅ Sprint DB / D11 + inventaire triggers Sprint Polish T5
  SCHEMA.md                # carte des tables, RPC, indexes, FK, hot path, triggers (post T5)
prompts/                   # prompts Claude Code par chantier
  prompt-00-executive-summary.md     # Sprint 0 (livré)
  prompt-00-executive-summary-v2.md  # Sprint DB (livré)
  prompt-00-executive-summary-v3.md  # Sprint Refactor (livré)
  prompt-00-executive-summary-v4.md  # Sprint Hardening (livré)
  prompt-00-executive-summary-v5.md  # Sprint Polish (livré 2026-05-07)
  prompt-00-executive-summary-v6.md  # Sprint Audit-Triggers (à exécuter)
```
