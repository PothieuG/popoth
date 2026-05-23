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

> ⚠️ **Note historique (Sprint Clean-Slate-Recap — 2026-05-23)** : Tout le code V1+V2 du Monthly Recap (routes, libs, components, hooks, schemas, dev tools, tables DB) a été supprimé. V3 en cours d'implémentation, spec sous `prompt-montly-recap/` untracked. Détail dans CLAUDE.md §5.

> ⚠️ **Note historique (chantier 16 + Mission-suppression-audits — 2026-05-16)** : 2 cleanup massifs ont archivé la doc audit. Chantier 16 (2026-05-15) : `docs/audit/` + `prompts/`. Mission-suppression-audits (2026-05-16) : `audit_2/` + `audit_3/` (working set des prompts une fois tous les sprints livrés). Les 2 survivants doc migrés : `docs/db/SCHEMA.md` → [`doc2/db/SCHEMA.md`](./doc2/db/SCHEMA.md) et `docs/api/README.md` → [`doc2/api/README.md`](./doc2/api/README.md). Les références `docs/audit/*.md`, `prompts/*.md`, `audit_2/*.md`, `audit_3/*.md` qui persistent dans cette doc (§4 inventaire + §11 roadmap narrative) sont historiques — recovery via `git show <sha>:<path>` à partir du commit correspondant.

```
app/                       # App Router (pages + API routes)
  (dashboards)/            # ✅ Sprint Fix-Dashboards-Navbar-Switch (2026-05-20) — Next.js route group (les `()` n'affectent PAS les URLs). `layout.tsx` client component owne header + footer + drawer + add-modal (persistent à la nav soeur), déduit `context` via `usePathname()`. Pages allégées 381+281→143+124 LOC. Détails [@.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) (5 règles ❌ navigation).
  api/
    debug/                 # 4 routes seed/reset — BLOQUÉES en prod via blockInProduction(). Post Clean-Slate-Recap : retrigger-recap et recap-v2/ supprimés.
    finance/               # ✅ Sprint Refactor-Architecture v1+v2 — namespace canonique unifié (12 routes)
                           #   summary, rav, budgets (POST/PUT/DELETE only), budgets/estimated, incomes,
                           #   income/{real,estimated,progress}, expenses/{real,add-with-logic,preview-breakdown,progress}
                           #   Toutes ré-exportent les handlers depuis lib/api/finance/<route>.ts
    savings/transfer/      # transferts budget↔budget et budget↔tirelire
    docs/                  # ✅ Sprint OpenAPI-Schema-To-Docs — `/api/docs` sert un HTML Swagger UI (chargé via CDN unpkg, zéro dep) ; `/api/docs/openapi.json` sert le doc OpenAPI 3.1 généré depuis le registry. Public (pas d'auth) — DX gain pour les API consumers + onboarding nouveaux devs.
components/                # UI (shadcn/ui sous components/ui/)
  dashboard/BottomNav.tsx  # ✅ Sprint Fix-Dashboards-Navbar-Switch (2026-05-20) — navbar bottom 3-tabs partagée par /dashboard et /group-dashboard. `useRouter().push()` au lieu de `window.location.href` (soft nav). Variante "Aucun groupe" si `!hasGroup`.
  dashboard/DashboardHeader.tsx # ✅ Sprint Fix-Dashboards-Navbar-Switch (2026-05-20) — header sticky partagé. Props `context`, `onOpenMenu`. Rend `<UserInfoNavbar>` (profile) OU `<GroupInfoNavbar>` (group) + `<UserAvatar>`. Hooks dédupés TanStack Query.
  ui/CentralLoader.tsx     # ✅ Sprint Fix-Dashboards-Navbar-Switch (2026-05-20) — loader inline `flex flex-1` (PAS `min-h-screen`, PAS `fixed inset-0`). Rendu dans `<main>` d'un layout parent `flex-1` — n'écrase pas le chrome. Prop `message?`.
  ui/skeleton.tsx          # ✅ Sprint Skeleton-Refetch-Loaders (2026-05-21) — primitif shadcn standard `<div className="animate-pulse rounded-md bg-gray-200">` + prop `className` pour shape/size + `aria-hidden`. Consommé par 10 fichiers consumer pendant `isLoading || isFetching` pour remplacer les chiffres/listes pendant fetch.
  ui/InlineSpinner.tsx     # ✅ Sprint Skeleton-Refetch-Loaders (2026-05-21) — wrapper lucide `Loader2` avec variants `sm` (h-4 w-4 défaut bouton) / `md` (h-5 w-5) + `className` override. Pour tout bouton submit avec `isSubmitting`/`isPending`/`isProcessing`, importer + `<InlineSpinner className="mr-1.5" />` inline + texte loading. Évite la duplication du raw `<Loader2 className="...animate-spin..." />`.
  ui/DecimalFormInput.tsx  # ✅ Sprint Zod-Rollout v4 — composant générique <T extends FieldValues> qui wrap Controller + shadcn Input + regex décimal + comma→dot. Consommé par 8 sites post-v4 (EditBalance/AddIncome/EditIncome/AddBudget/EditBudget/AddTransaction/EditTransaction/CreateGroup). Pour tout nouveau form décimal validé via `z.coerce.number()`, utiliser ce composant plutôt que de réécrire le pattern inline.
  ui/modal-close-x.tsx     # ✅ Sprint Zod-Rollout v10 — composant `<ModalCloseX onClose disabled? variant='circle'|'ghost' className? svgClassName? ariaLabel?>` qui centralise le SVG path `M6 18L18 6M6 6l12 12` + `aria-label="Fermer"` + `aria-hidden` sur le `<svg>`. Consommé par 11 sites dans 10 fichiers post-v10 (Edit/Add Budget/Income + Add/EditTransaction + Planning/SavingsDistribution drawers + nested transfer + GroupMembers + DeleteGroup). Variantes : `circle` h-8 w-8 rounded-full bg-gray-100 (6 sites), `ghost` h-8 w-8 rounded-md hover:bg-accent (4 sites). Pour tout nouveau modal Radix-migré, utiliser ce composant plutôt que de dupliquer le raw button + SVG inline.
  ui/drawer-content-classes.ts # ✅ Sprint Zod-Rollout v9 — `DRAWER_CONTENT_CLASSES` constant single source of truth pour le drawer bottom-up fullscreen override de `<DialogContent>`. Consommé par PlanningDrawer + SavingsDistributionDrawer (2 sites). Pour tout nouveau drawer fullscreen bottom-up, importer cette constante plutôt que dupliquer l'override className inline.
  ui/modal-content-classes.ts # ✅ Sprint Modal-Uniformize + Modal-Polish (2026-05-21) — `MODAL_CONTENT_CLASSES` constant mirror de `DRAWER_CONTENT_CLASSES` mais pour les modales centrées (non drawer). Définit `bottom-auto! flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-xl sm:max-w-md sm:rounded-2xl`. Le `bottom-auto!` (`!` postfix Tailwind v4) override le `inset-4` de Radix DialogContent qui forçait la hauteur à ~50vh sur mobile (top:50% + bottom:16px définis tous deux → height calculée = vh/2 - 16). Avec bottom:auto, height devient content-determined capée par max-h-[85vh]. Consommé par 14 surfaces modal (13 modals + 1 nested transfer modal dans SavingsDistributionDrawer). Pour tout nouveau modal centré, importer cette constante + structurer en `shrink-0` header / `flex-auto min-h-0` body / `shrink-0` footer (NE PAS utiliser `flex-1` sur le wrapper form/body — collapse à 0 en parent height-auto, cf. [@.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md)).
  ui/CustomDropdown.tsx    # ✅ Sprint Modal-Dropdown-Portal (2026-05-21) — refactor pour utiliser `React.createPortal(menu, document.body)` au lieu de `<div className="absolute z-50">` enfant du button. Raison : les dropdowns à l'intérieur d'un modal étaient clipped par 3 cascades (DialogContent `overflow-hidden`, body `overflow-y-auto`, et surtout DialogContent `transform: translateY(-50%)` qui crée un containing-block pour les descendants `position: fixed`). Le portal vers `document.body` est le SEUL moyen d'échapper le clipping. Position calculée via `getBoundingClientRect()` sur le button trigger, re-mesurée sur events `scroll` (capture phase) + `resize`. Max-height = `viewport.height - button.bottom - 10vh - 4px` (10% margin du bas du viewport, plancher 120px). Anti-Radix-close via `stopPropagation` sur `pointerdown` + `mousedown` du menu (Radix DismissableLayer écoute pointerdown bubble sur document — sans stopProp, clic sur option du menu portaled → "outside click" détecté → modal parente fermée). A11y : `role="listbox"` + `role="option"` + `aria-selected` ajoutés. Pas de fallback "open above" (à ajouter si futur user report sur button près du bas du viewport).
  __tests__/a11y-helpers.ts # ✅ Sprint Zod-Rollout v10 — helper test `expectEscClose(element, onClose, titleText: string | RegExp)` centralise le 5-line boilerplate focus-trap regression-guard (render + waitFor getByText + user.keyboard Escape + expect onClose called). Consommé par 10/12 cas dans a11y-audit.test.tsx (2 cas spéciaux restent manuels : EditTransactionModal heading level 2 + nested-stacking PlanningDrawer+AddBudget). Pour tout nouveau modal Radix-migré, ajouter un cas focus-trap via ce helper.
  providers/QueryProvider.tsx # ✅ Sprint 1.5 — 'use client' wrapper QueryClientProvider + ReactQueryDevtools (dev only). Mounted outermost in app/layout.tsx
  settings/SettingsDrawer.tsx # ✅ Sprint Refactor-Settings-Drawer (2026-05-18) — drawer slide-right partagé entre dashboard + group-dashboard. Héberge un swap horizontal in-place entre 2 panels (`main` + `group-management`) via `absolute inset-0` + `transition-transform duration-300` + `translate-x-{-full,0,full}` dans un container `overflow-hidden`. Reset à 'main' 300ms après close (cleanup-friendly setTimeout). Props : `title`, `showProfileCard`, `showBankBalanceLine`, `bankBalance`, `onBankBalanceUpdate`, `onLogout`. Le bouton "Gestion du groupe" est stylé menu-item iOS (gradient bleu-indigo + icône en bulle dégradée 40px + label gras + sous-label + chevron `›`). **Path B closed-by-deletion** : `app/settings/page.tsx` supprimé (route full-route + `window.location.href` + `window.history.back()` éliminés — le bug intermittent "1 fois sur 2 retour au dashboard" disparaît mécaniquement). 8ᵉ application Path B closed-by-deletion (cf [@.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §1).
  settings/GroupManagementPanel.tsx # ✅ Sprint Rework-Group-Management (2026-05-19, dernière modification — initial extraction au Sprint Refactor-Settings-Drawer 2026-05-18) — 3 zones flex-col : header (back+close), content scrollable, footer pinned bottom. **Content branche `hasGroup`** : CTA prominent "Voir les membres" style iOS menu item (gradient bleu-indigo + bulle icône 40px + chevron) + section "Informations du groupe" en `<dl>` plat avec séparateurs `border-b border-gray-100 py-2` (nom/budget/membres/créé le) + badge "Créateur" inline. **Content branche `!hasGroup`** : 2 sections plates "Créer" + "Rejoindre" sans Card chrome (CreateGroupForm + Input search + GroupSearchList). **Footer pinned bottom** (`border-t border-gray-200 p-4`) : Button full-width orange "Quitter le groupe" + encart info ambré au-dessus si `isCreatorBlocked = is_creator && memberCount > 1` (creator avec membres → bouton désactivé + message "Les autres membres doivent d'abord quitter"). `handleLeaveClick` court-circuité défense-in-depth si bloqué. ConfirmationDialog message updated pour creator-alone case ("Vous êtes le seul membre, le groupe restera sans membre"). Patterns ❌ documentés [@.claude/conventions/operational-rules.md](../conventions/operational-rules.md) §5 Modals & UI (sections plates / footer destructive / readonly+backend-match).
  groups/GroupMembersWithContributionsModal.tsx # ✅ Sprint Rework-Group-Management (2026-05-19) — hauteur fixe `h-[80vh] max-h-[80vh]` au lieu de `max-h-[90vh]` + content interne `flex-1 overflow-y-auto` (remplit l'espace entre header+footer dans les 80vh). 3 redondances avec parent panel retirées : header "Budget: X €/mois", footer "Résumé du groupe" Card (budget+total), compteur "Total: X €" inline. 1 info privée retirée per-member : "Basé sur un salaire de X €". Conservé per-member : avatar + prénom/nom + date joined + badge créateur + contribution amount + percentage. Destructuring `groupInfo` retiré (plus de consumer). Migration Radix Dialog + `<ModalCloseX variant="ghost" />` préservée (Sprint Zod-Rollout v8/v10).
contexts/AuthContext.tsx   # ✅ Sprint Hygiène-Code — split en `AuthUserContext` + `AuthActionsContext` ; hooks `useAuthUser()` / `useAuthActions()`. Sprint 2-followup-v5 — l'aggregator `useAuth()` (qui spread les deux contexts) a été supprimé : 0 consumer en prod. Si jamais un consumer en a besoin, recréer ad-hoc.
hooks/                     # 18 hooks React (post Clean-Slate-Recap) — ✅ Sprint 1.5 : hooks fetcher migrés sur TanStack Query (useQuery + useMutation)
  useRavValidation.ts      # ✅ Sprint Refactor-Architecture — useMemo pur, validation { blocked, newRav } pour AddTransactionModal
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
  query-client.ts          # ✅ Sprint 1.5 — createQueryClient() factory (staleTime 30s, refetchOnWindowFocus false, retry 1) ; consommé par components/providers/QueryProvider.tsx. ✅ Sprint 2 — `invalidateFinancialRefreshes(qc)` helper export (single source of truth, 4 keys initialement) + ✅ Sprint Group-Budget-Auto-Sync (2026-05-19) ajout `['group-contributions']` (5 keys totales pré-Delete-Budget) + ✅ Sprint Fix-Savings-Drawer-Stale-Cache (2026-05-20) ajout `['savings-data']` (5 keys finales : financial-summary / progress-data / budgets / group-contributions / savings-data)
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
  # NOTE: Sprint Clean-Slate-Recap (2026-05-23) — lib/database-snapshot.ts + lib/recap-snapshot.types.ts + lib/recap/ + lib/recap-legacy/ + lib/dev/ supprimés.
  recap/                   # ✅ Sprint State-Lock-Schemas-V3 (sub-task 03/17 Monthly Recap V3, 2026-05-24) — fondations pure-async, 0 endpoint
    state.ts               # RecapStep + RECAP_STEP_ORDER (6 étapes : welcome → summary → manage_bilan → salary_update → final_recap → completed) + isAdvanceAllowed (forward-only, skip permis) + nextRequiredStep (null sur terminal). Pure sync, 0 I/O.
    check-status.ts        # checkRecapStatus(userId, context) async → RecapStatusResult avec discriminated union RecapStatusKind (kind: 'no_recap' | 'in_progress' | 'locked_by_other' | 'completed'). Lit monthly_recaps via .maybeSingle() (jamais .single() — sinon PGRST116 sur compte fresh). Orphan row (started_by_profile_id NULL) classée 'no_recap' (laisse /start re-claim). Group lock detection via JOIN PostgREST FK-hinted `starter:profiles!monthly_recaps_started_by_profile_id_fkey(first_name, last_name)`. RecapStatusError code: 'PROFILE_NOT_FOUND' | 'NO_GROUP'.
    lock.ts                # isUserLocked(status) + isRecapBlocking(status) — helpers purs sync. isRecapBlocking returns false on 'completed' (le reste du mois est libre).
    index.ts               # barrel — consumers : import { checkRecapStatus, isRecapBlocking, RECAP_STEP_ORDER, type RecapStep, ... } from '@/lib/recap'
    __tests__/state.test.ts        # ✅ 17 cas non-gated pure : 8+ isAdvanceAllowed (forward/backward/skip/self-loop/terminal) + 6 nextRequiredStep + 1 RECAP_STEP_ORDER snapshot
    __tests__/check-status.test.ts # gated SUPABASE_RECAP_TESTS=1 — 8 cas (no_recap profile + in_progress avec step=summary + completed + orphan row=no_recap + group in_progress initiator + group locked_by_other avec startedByName fetched + PROFILE_NOT_FOUND throw + NO_GROUP throw)
  schemas/                 # ✅ Sprint Refactor-I5 — Zod schemas API
    # NOTE: recap.ts ajouté Sprint State-Lock-Schemas-V3 (sub-task 03/17, 2026-05-24) — 8 schémas (start, transferSurpluses, refloatFromPiggy, refloatFromSavings, saveBudgetSnapshot, updateSalaries, complete, statusQuery) réutilisant contextSchema/uuidSchema/nonNegativeMoneySchema de common.ts. Tests : __tests__/recap.test.ts ≥40 cas non-gated. Barrel index.ts étendu (`export * from './recap'`).
  api/                     # ✅ Sprint Refactor-Architecture v1+v2 — handlers extraits, ré-exportés par app/api/finance/**/route.ts
    parse-body.ts          # ✅ Sprint Refactor-I5 — parseBody<T>(req, schema) + BadRequestError + handleBadRequest(error). Validation Zod centralisée pour les handlers
    __tests__/parse-body.test.ts  # ✅ Sprint Refactor-I5 — 6 cas non-gated (happy path, malformed JSON, schema mismatch, etc.)
    with-auth.ts           # ✅ Sprint Refactor-Architecture-v3+v4+v5 — withAuth(handler) + withAuthAndProfile(handler) higher-order helpers utilisés par ~20 modules (12 finance + Volet C : profile/savings/bank-balance/groups). Profile shape étendu en v4 à { id, group_id, first_name, last_name }. Signature étendue avec 2 overloads en v5 : (a) static-route signature sans routeContext, (b) dynamic-route signature avec generic `<TParams>` et routeContext NON-optionnel — élimine le `routeContext!` dans groups/[id]/** sans casser la cohabitation static. Tests gated `SUPABASE_API_TESTS=1` dans [lib/api/__tests__/with-auth.test.ts](lib/api/__tests__/with-auth.test.ts) (12 cas, Sprint v5).
    finance/               # 12 modules : summary, rav, budgets (POST/PUT/DELETE), budgets-estimated, incomes, income-{real,estimated,progress}, expenses-{real,add-with-logic,preview-breakdown,progress}
    __tests__/             # ✅ Sprint Refactor-Architecture-v5
      with-auth.test.ts    # gated SUPABASE_API_TESTS=1 — 12 cas withAuth + withAuthAndProfile (auth, expired payload, overloads, profile shape, isolation)
  constants/               # ✅ Sprint Hygiène-Code — magic numbers extraits
    auth.ts                # SESSION_EXPIRATION_SECONDS (3600), SESSION_EXPIRATION_JOSE ('1h'), SESSION_REFRESH_INTERVAL_MS (50min), AUTH_CHECK_INTERVAL_MS (5min)
    finance.ts             # ROUNDING_TOLERANCE (0.01) — currently orphan post Clean-Slate-Recap (était utilisé par process-step1), conservé pour V3 cascade tolerance
  finance/                 # ✅ Sprint 0 C3 (RPC atomiques) + Sprint Refactor-I4 (split god file 1069 LOC)
    # Sprint 0 / C3 — atomic RPC helpers (single-call + retry-safe DB writes)
    context.ts             # ContextFilter type discriminé { profile_id } | { group_id } + asContextFilter() + resolveContextIds()
    piggy-bank.ts          # updatePiggyBank, transferFromPiggyToBudget, transferPiggyToBudgetWithInsert, ensurePiggyBankRow (Sprint Fix-Empty-Recap-Tirelire — idempotent INSERT amount=0 before RPC writes)
    bank-balance.ts        # updateBankBalance
    budget-savings.ts      # updateBudgetCumulatedSavings
    budget-transfers.ts    # ✅ Sprint Refactor-I5-followup-v2 — transferWithSavingsDebit (composite RPC : INSERT budget_transfers + debit cumulated_savings en une tx Postgres)
    expenses.ts            # ✅ Sprint Atomicity-Expenses — addExpenseWithBreakdown (composite RPC : debit piggy + debit cumulated_savings + INSERT real_expenses en une tx Postgres atomique)
    savings.ts             # ✅ Sprint Atomicity-Savings — transferSavingsBetweenBudgets (debit FROM + credit TO en 1 tx) + transferBudgetToPiggyBank (debit budget + UPSERT piggy_bank via partial unique index inference en 1 tx) + ✅ Sprint Delete-Budget-Savings-Transfer (2026-05-20) deleteBudgetWithSavingsTransfer (UPSERT piggy + DELETE budget en 1 tx, skip-UPSERT si cumulated_savings=0)
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
      delete-budget-with-savings-transfer.test.ts # ✅ Sprint Delete-Budget-Savings-Transfer (2026-05-20) — gated SUPABASE_RPC_CONCURRENCY_TESTS=1, 8 cas atomicité delete_budget_with_savings_transfer (happy profile UPDATE/INSERT/no-savings skip + group context + budget not found + XOR violation + ownership mismatch + 50× concurrent distincts budgets aggregate piggy exactement)
      calc-rtl.test.ts                   # ✅ I4 — 19 cas pure-unit non-gated, formules RAV/budget/cash
      snapshots.test.ts                  # ✅ I4 — 5 cas mocked supabase non-gated, validation + R1 fail-soft contract
  forms/                   # ✅ Sprint Modal-Forms-Block-Enter-Submit (2026-05-21) — helpers de comportement des forms modaux
    prevent-enter-submit.ts            # onKeyDown handler à brancher sur les <form> des modals/drawers : intercepte Enter (sans modificateurs) sur input/select, preventDefault + blur, passe-droit textarea/button/a. Empêche submit HTML5 implicite déclenché par Return mobile, force le clic sur le bouton de validation.
    __tests__/prevent-enter-submit.test.tsx  # 7 cas non-gated (env jsdom via `.tsx`) — Enter input → preventDefault+blur, Enter textarea/button/a → no-op, Tab/Escape → no-op, modificateurs Shift/Ctrl/Meta/Alt → no-op, target null safe.
  __tests__/               # ✅ Sprint Polish T3
    api-regressions.test.ts  # gated SUPABASE_API_TESTS=1 — H1/H2/R2 regressions
  openapi/                 # ✅ Sprint OpenAPI-Schema-To-Docs — génération de la doc OpenAPI 3.1 depuis les schemas Zod
    registry.ts            # `RouteDef[]` — single source of truth (path, method, summary, tag, body/query schema, pathParams, requiresAuth) pour 36 paths / 63 opérations. Ajouter une entrée quand on ajoute une route API.
    generate.ts            # `generateOpenAPI()` — transforme le registry en OpenAPI 3.1 JSON via `z.toJSONSchema()` natif Zod 4 (zéro dep externe). Cache module-level. Refines droppés (limite JSON Schema), transforms → `{}` via `unrepresentable: 'any'`.
scripts/                   # Sprint DB outils API Management (sans Docker)
  export-schema.mjs        # snapshot prod schema → SQL baseline (⚠️ filtre trigger buggy, cf. Sprint Audit-Triggers v6)
  apply-sql.mjs            # applique un .sql via API Management (drift recovery, SELECT, ou clone-data.mjs base)
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
    20260520120000_create_delete_budget_with_savings_transfer_rpc.sql # ✅ Sprint Delete-Budget-Savings-Transfer (2026-05-20) — RPC composite delete_budget_with_savings_transfer (SELECT FOR UPDATE cumulated_savings + UPSERT piggy si > 0 via partial unique index + DELETE budget en 1 tx). FK cascades : real_expenses SET NULL, budget_transfers CASCADE
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
