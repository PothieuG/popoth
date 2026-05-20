# Roadmap détaillée — Part 15 : Skeleton-Refetch-Loaders

> Créée 2026-05-21 — Part 14 ayant atteint le plafond 38k chars (cf. [@.claude/guardrails/size-policy.md](../guardrails/size-policy.md)), le sprint Skeleton-Refetch-Loaders s'ouvre dans une nouvelle part.
> Navigation : [← Part précédente](roadmap-detailed-14-modal-uniformize-polish-dropdown.md) | (pas de partie suivante)

---

## 11. Roadmap — Part 15

- ✅ **Sprint Skeleton-Refetch-Loaders** (livré 2026-05-21, déclenché par "check tous les endroits du frontend où des données chargent et où un loader localisé devrait être visible — changer de groupe = pas de loader navbar, update budget = RAV sans loader, etc. fait que tout soit harmonieux"). Audit + harmonisation de 15 surfaces consumer + 11 hooks fetcher pour fermer le pattern "refetch silencieux post-mutation" (TanStack Query refetch en arrière-plan invisible car composants n'écoutent que `isLoading`, jamais `isFetching`). Choix utilisateur : "skeleton remplace" (animate-pulse bg-gray-200) à la place des chiffres pendant `isLoading || isFetching`, scope "tout d'un coup", boutons submit harmonisés inclus.

  **(1) Primitives UI créées** : [components/ui/skeleton.tsx](../../components/ui/skeleton.tsx) (shadcn standard `<div className="animate-pulse rounded-md bg-gray-200">` + prop `className` pour shape/size, `aria-hidden="true"`) ; [components/ui/InlineSpinner.tsx](../../components/ui/InlineSpinner.tsx) (wrapper lucide `Loader2` avec variants `sm` (h-4 w-4 défaut bouton) / `md` (h-5 w-5) + `className` override). Pas de `<StaleWrap>` dim/spinner overlay — le choix utilisateur "skeleton remplace" remplace la valeur conditionnellement, pas un overlay.

  **(2) 11 hooks fetcher exposent `isFetching`** : `useFinancialData`, `useProfile`, `useGroupContributions`, `useBudgets`, `useIncomes`, `useRealExpenses`, `useRealIncomes`, `useBudgetProgress`, `useIncomeProgress`, `useGroups` + le `useQuery` local de `SavingsDistributionDrawer`. Ajout `isFetching` à la déstructuration de `useQuery` + au return + à l'interface `UseXReturn` quand elle existait. `useBankBalance` et `useGroupMembers` restent legacy `useState` (sprint dédié futur pour migration TanStack — ils exposent déjà un `isLoading` équivalent fonctionnel car ils ne distinguent pas initial vs refetch).

  **(3) 15 composants consument skeleton** :
  - **Dashboards** : `app/(dashboards)/dashboard/page.tsx` + `group-dashboard/page.tsx` — retrait du `<CentralLoader>` global pour `financialLoading` car `<FinancialIndicators>` gère son propre skeleton interne. `<CentralLoader>` reste pour le profile `isLoading` (premier mount sans structure à montrer) et redirections transitoires.
  - **Indicators** : `FinancialIndicators` (RAV/balance/savings : `<Skeleton className="mx-auto h-6 w-20" />` aux mêmes dimensions que les chiffres) ; `RemainingToLivePreview` + `UserContributionCard` (déjà animate-pulse manual pré-sprint, ajout consume `isFetching` pour couvrir refetch post-mutation).
  - **Navbar** : `DashboardHeader` propage `isFetching: contributionsFetching` à `<UserInfoNavbar>` (skeleton sur contribution amount + skeleton sur les 2 % salaire/budget) et `isFetching: membersLoading` à `<GroupInfoNavbar>` (skeleton h-3 w-32 sur liste membres). C'est le cas-exemple cité par l'utilisateur : changer de groupe → contribution + membres se rechargent avec skeleton visible.
  - **Listes** : `TransactionTabsComponent` (3 `<Skeleton className="h-14 w-full" />` rows à la place des transactions pendant `expensesLoading || expensesFetching`) ; `PlanningDrawer` (`isBudgetsBusy = loading || fetching || progressLoading || progressFetching` → 3 rows `h-16` pour budgets, idem pour incomes) ; `SavingsDistributionDrawer` (3 cards `h-32`/`h-44`/`h-24` pour stat globale + budgets-avec-savings + budgets-sans-savings).
  - **Settings** : `GroupManagementPanel` (skeleton 4 blocks pour le panel entier pendant `groupsLoading || groupsFetching`) ; `ProfileSettingsCard` (skeleton avatar circle + fields blocks).

  **(4) 8 surfaces boutons submit harmonisés `<InlineSpinner>`** : `AddBudgetDialog` (Ajouter le budget), `AddIncomeDialog` (Ajouter le revenu), `CreateGroupForm` (Créer le groupe), `GroupManagementPanel` (Rechercher + Quitter le groupe), `ProfileSettingsCard` (Enregistrer), `UserContributionCard` (Actualiser + Calculer maintenant), `SavingsDistributionDrawer` wizard (Confirmer), `MonthlyRecapStep1` (Continuer) + `MonthlyRecapStep2` (Auto-répartition + Terminer + Confirmer/Récupérer). Les SVG spinners custom inline dans MonthlyRecap (`<svg className="h-4 w-4 animate-spin"><circle.../><path.../></svg>` ~10 lignes) remplacés par `<InlineSpinner />` (1 ligne import).

  **(5) Fix infinite refetch loop** (régression post-`isFetching` exposé, détectée par le user au browser test) : exposer `isFetching` au return des hooks faisait re-render à chaque oscillation true/false du refetch → arrow functions inline `refreshBudgets/Incomes/Expenses` recréées à chaque render → `useEffect(..., [isOpen, refreshBudgets, refreshIncomes, refreshBudgetProgress, refreshIncomeProgress])` du [PlanningDrawer.tsx:154](../../components/dashboard/PlanningDrawer.tsx) re-firait → `refetch()` imperatif (qui bypass staleTime à la différence de `invalidateQueries`) → `isFetching: true` → re-render → boucle. Console montrait `GET /api/finance/incomes?context=profile` + `GET /api/finance/income/real?limit=100` en loop sans fin.

  Fix : wrapper les 4 `refresh*` dans `useCallback(async () => { await refetch() }, [refetch])` dans `useBudgets`, `useIncomes`, `useRealExpenses`, `useRealIncomes`. `refetch` from TanStack Query est déjà stable, donc le `useCallback` produit une référence stable across renders. Les downstream `useBudgetProgress`/`useIncomeProgress` ont déjà leurs `refreshProgress` en `useCallback` qui dépendent de `refreshExpenses`/`refreshIncomes` — héritent automatiquement de la stabilité.

  Important : les autres functions inline du return (`addBudget`, `updateBudget`, `deleteBudget`, etc.) NE SONT PAS wrappées useCallback parce qu'elles ne sont pas utilisées en deps de useEffect ailleurs. Si un futur consumer les passe en deps, il faudra wrapper aussi.

  **(6) Fix HTML invalide** (régression post-Skeleton dans `<p>`, détectée par le user au browser : "In HTML, `<div>` cannot be a descendant of `<p>`. This will cause a hydration error.") : 2 `<p className="text-sm text-orange-700">Total estimé: {isBudgetsBusy ? <Skeleton .../> : ...}</p>` dans `PlanningDrawer` provoquaient hydration error car `<Skeleton>` rend un `<div>`. Le HTML spec interdit `<div>` (block-level) à l'intérieur d'un `<p>` (qui se ferme implicitement à la rencontre d'un block-level child, créant un mismatch SSR↔CSR).

  Fix : remplacer les `<p>` wrappers par `<div className="flex flex-wrap items-center gap-x-1 text-sm text-{orange|green}-700">` avec `<span>` enfants pour les fragments de texte. Visuel identique (mêmes classes typo, `gap-x-1` rend le espacement entre éléments naturel comme l'espace insécable du `<p>`). Les autres 9 fichiers consumers de `<Skeleton>` ont été vérifiés via Grep cross-codebase — tous dans des parents `<div>` (sibling de `<p>` quand applicable, jamais à l'intérieur).

  Pattern : **un wrapper `<p>` qui peut contenir un `<Skeleton>` doit être un `<div>` ou un `<span>`**. Le `<p>` est réservé aux paragraphes purement textuels (avec `<span>`, `<strong>`, `<em>`, `<a>` inline tolérés mais pas `<div>`).

  **(7) Convention installée** dans [.claude/conventions/operational-rules-ui-modals.md](../conventions/operational-rules-ui-modals.md) : +3 règles ❌ (22 → 25 règles totales).
  - **Règle 1** : interdit de consume un hook TanStack en écoutant seulement `isLoading` (refetch silencieux invisible 200-500ms post-mutation/switch-context) → hook expose `isFetching`, consumer écoute `isLoading || isFetching`, valeur remplacée par `<Skeleton>` aux mêmes dimensions. Choix "skeleton remplace" vs "dim + spinner" vs "badge Actualisation..." documenté.
  - **Règle 2** : interdit de `disabled + texte` sans `<InlineSpinner>` sur un bouton submit (vocabulaire unifié `<Loader2>` lucide + texte loading).
  - **Règle 3** : interdit de `if (financialLoading) return <CentralLoader>` global pour le RAV — le composant gère son skeleton interne, le `<CentralLoader>` global ferait disparaître la structure visuelle.

  [.claude/guardrails/size-policy.md](../guardrails/size-policy.md) inventaire updated : `operational-rules-ui-modals.md` 20k → 24k, 22 → 25 règles.

  **(8) Test mock fix** : `components/__tests__/a11y-audit.test.tsx` ligne 207 — le mock global `vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data, isLoading, error }) }))` ne retournait ni `refetch` ni `isFetching`. Le `useEffect(() => { if (isOpen) void refetch() }, [isOpen, refetch])` de `SavingsDistributionDrawer.tsx:128` faisait `void undefined()` → `TypeError: refetch is not a function` qui faisait fail le test `SavingsDistributionDrawer: Esc keydown invokes onClose` après mes ajouts (le test passait pré-sprint parce que… mystère React du fonctionnement de `void refetch()` quand `refetch` undefined dans certains paths d'effect dispatch).

  Fix : ajouter `isFetching: false` et `refetch: vi.fn()` au mock. Le test passe maintenant. **Action items** pour les futurs hooks TanStack-mockés : toujours retourner les 4 champs `{ data, isLoading, isFetching, error, refetch }` minimum, même si le test ne les utilise pas directement.

  **Vérification end-to-end** :
  - `pnpm typecheck` exit 0
  - `pnpm lint:check` 0 errors / 0 warnings
  - `pnpm test:run` **501 passed / 98 skipped** stable (avant et après le sprint)
  - `pnpm format:check` exit 0 (après `pnpm prettier --write` sur `FinancialIndicators.tsx` + un fichier roadmap-detailed-14.md pré-existant trailing whitespace)
  - `pnpm build` succeed (Proxy Middleware + 54 routes, 0 erreurs)
  - `pnpm verify` (typecheck + format:check + test:run + 6 db:\* checks) exit 0 ~36s

  **Test browser manuel** (par l'user, itératif) :
  1. Ouvrir PlanningDrawer → erreurs hydration HTML détectées (`<div>` dans `<p>`) → fix immédiat (point 6).
  2. Re-test → boucle infinie de fetches détectée (`/api/finance/incomes` et `/api/finance/income/real` en loop) → fix immédiat (point 5).
  3. Re-test → drawer fetche une seule fois, skeleton apparaît brièvement, puis liste affichée. ✅ OK.

  **Files livrés** :
  - **Créés** (2) : `components/ui/skeleton.tsx`, `components/ui/InlineSpinner.tsx`.
  - **Modifiés** (11 hooks) : `useFinancialData`, `useProfile`, `useGroupContributions`, `useBudgets`, `useIncomes`, `useRealExpenses`, `useRealIncomes`, `useBudgetProgress`, `useIncomeProgress`, `useGroups` + ajout `useCallback` sur 4 d'entre eux.
  - **Modifiés** (15 composants UI) : `app/(dashboards)/dashboard/page.tsx`, `app/(dashboards)/group-dashboard/page.tsx`, `components/dashboard/FinancialIndicators.tsx`, `DashboardHeader.tsx`, `TransactionTabsComponent.tsx`, `PlanningDrawer.tsx`, `SavingsDistributionDrawer.tsx`, `RemainingToLivePreview.tsx`, `components/ui/UserInfoNavbar.tsx`, `GroupInfoNavbar.tsx`, `components/contributions/UserContributionCard.tsx`, `components/settings/GroupManagementPanel.tsx`, `components/profile/ProfileSettingsCard.tsx`.
  - **Modifiés** (5 boutons submit) : `AddBudgetDialog.tsx`, `AddIncomeDialog.tsx`, `CreateGroupForm.tsx`, `MonthlyRecapStep1.tsx`, `MonthlyRecapStep2.tsx`.
  - **Modifiés** (1 test) : `components/__tests__/a11y-audit.test.tsx` (mock useQuery).
  - **Modifiés** (3 conventions) : `.claude/conventions/operational-rules-ui-modals.md` (+3 règles), `.claude/guardrails/size-policy.md` (inventaire), `.claude/history/roadmap-detailed-14-modal-uniformize-polish-dropdown.md` (cross-ref).

  **Trade-off** :
  - Le pattern "skeleton remplace" (vs "dim + petit spinner top-right" ou "badge Actualisation...") fait perdre l'ancienne valeur pendant 200-500ms. L'user a choisi ce trade-off pour minimiser l'ambiguïté UX ("skeleton" = "ces données ne sont pas à jour, attends"). L'oscillation `isFetching` true/false sur refetch < 100ms peut théoriquement créer un flicker skeleton court ; pas observé en pratique (les fetches Supabase prennent 100-500ms typiquement). Si flicker surface plus tard, ajouter un debounce visuel `useDebouncedFlag(isFetching, 100ms)` dans `<Skeleton>` ou via hook utility.
  - Le wrap `useCallback` ajoute une légère overhead React (création de ref + comparison shallow des deps) mais c'est négligeable vs le coût de la loop infinie qu'on évite.
  - `useBankBalance` + `useGroupMembers` restent legacy `useState`. Leurs `isLoading` couvrent initial + post-action puisqu'ils ne distinguent pas refetch (un seul flag). Pas de régression UX, juste un peu moins fine-grained. Migration TanStack programmable dans sprint dédié si besoin.

  **Pattern à retenir** :
  - Pour tout nouveau hook TanStack Query exposé à des consumers UI : **toujours retourner `isFetching` en plus de `isLoading`** ; **toujours wrapper les `refresh*` exposés en `useCallback([refetch])`** pour stabilité (sinon useEffect deps loops chez les consumers).
  - Pour tout nouveau composant consumer qui affiche une valeur du hook : **écouter `isLoading || isFetching`** et **rendre `<Skeleton className="h-N w-N">`** aux dimensions visuelles équivalentes au texte/valeur.
  - Pour tout bouton submit avec `isSubmitting`/`isPending`/`isProcessing` : **toujours `<InlineSpinner>` inline + texte loading** — jamais texte seul grisé.
  - Pour les wrappers `<p>` qui pourraient contenir du `<Skeleton>` : **changer le wrapper en `<div className="flex">`** ou `<span>` (Skeleton rend un div invalide dans p).
  - Pour les mocks TanStack Query dans les tests RTL : **toujours retourner `{ data, isLoading, isFetching, error, refetch }`** au minimum.
