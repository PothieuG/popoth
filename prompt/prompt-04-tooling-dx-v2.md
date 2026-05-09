# Sprint 1.5 — React Hooks v7 anti-patterns refactor

## Contexte

Le **Sprint 1** (Industrialisation tooling, livré 2026-05-09) a upgradé `eslint-config-next` de 15.0.0 à 16.2.6 et `eslint-plugin-react-hooks` est passé en v7 par transitivité. v7 introduit **deux nouvelles règles** que la codebase pré-existante ne satisfait pas :

- **`react-hooks/set-state-in-effect`** — flag `useEffect(() => { setState(...) })` synchrone (cascading renders, anti-pattern React 19). **24 sites** dans la codebase actuelle.
- **`react-hooks/refs`** — flag les lectures de `ref.current` pendant le render (component body), accès uniquement autorisé dans `useEffect` / event handlers. **1 site** dans `hooks/useProgressData.ts`.

**Total : 25 violations** réparties sur **18 fichiers**. Le Sprint 1 a downgradé les deux règles à `warn` (au lieu d'`error`) pour ne pas dépasser le seuil d'abort (>20 sites) défini dans le plan — la baseline `lint:check` reste verte. La dette est traquée mais non bloquante.

**Objectif de Sprint 1.5** : remonter les deux règles à `error` une fois les 25 sites refactorés.

## Inventaire complet (à valider en Phase 1)

À la livraison Sprint 1, `pnpm lint:check` produit ce mapping (extrait du run du closeout) :

```
react-hooks/set-state-in-effect (24)
  app/monthly-recap/page.tsx:35
  components/dashboard/AddTransactionModal.tsx:125
  components/dashboard/EditBudgetDialog.tsx:40
  components/dashboard/EditIncomeDialog.tsx:37
  components/dashboard/EditTransactionModal.tsx:113
  components/dashboard/ExpenseBreakdownPreview.tsx:44
  components/dashboard/PlanningDrawer.tsx:103, 111
  components/dashboard/SavingsDistributionDrawer.tsx:152, 190
  components/profile/ProfileSettingsCard.tsx:46
  components/ui/UserAvatar.tsx:31
  contexts/AuthContext.tsx:261
  hooks/useBudgets.ts:223
  hooks/useExpenseProgress.ts:69, 120
  hooks/useGroups.ts:234
  hooks/useIncomeProgress.ts:131
  hooks/useIncomes.ts:216
  hooks/useProfile.ts:149
  hooks/useProgressData.ts:99, 104
  hooks/useRealExpenses.ts:241  (approx — à confirmer)
  hooks/useRealIncomes.ts:228   (approx — à confirmer)

react-hooks/refs (1)
  hooks/useProgressData.ts:41
```

Lancer `pnpm lint:check 2>&1 | grep -E "react-hooks/(set-state-in-effect|refs)"` pour le mapping exact à l'instant T.

## Patterns à refactorer

### Pattern A — `useEffect(() => { setState(derivedFromProps); })`

**Anti-pattern** : recalcule un état dérivé à chaque render qui voit changer un prop. Causal chain `prop change → render 1 → effect run → setState → render 2`.

**Refactor** :

- Si l'état dérivé est purement calculé : remplacer par `useMemo` direct, supprimer le state.
- Si l'état dérivé tracke une transition (e.g. mode édition activé sur ouverture du modal) : utiliser `useState(() => init)` lazy + `key` prop sur le composant pour forcer le reset (pattern React 19 idiomatique).
- Si vraiment besoin d'un side-effect : déplacer dans un event handler (`onClick`, `onOpenChange`) plutôt que `useEffect`.

**Exemple — `useBudgetProgress.ts:5e ligne` (Sprint Refactor-Architecture chantier 5 a déjà fait ce refactor)** : 3 sources redondantes (state + memo + sync effect) collapsées en un `useMemo` retourné directement. Modèle à reproduire.

### Pattern B — `useEffect(() => { fetcher() })` mount-only / context-change-only

**Anti-pattern fréquent** : les hooks fetchers `useBudgets`, `useIncomes`, `useGroups`, `useProfile`, `useRealExpenses`, etc. déclenchent un fetch initial via `useEffect(() => { fetch(...).then(setData) }, [])`. Le `setData` synchrone dans le `.then` callback du fetch est ce que la règle flag. Mais ces effects sont **conceptuellement nécessaires** : on ne peut pas faire le fetch en pur render.

**Refactor recommandé** :

- Migrer vers une lib de data-fetching qui externalise le state (TanStack Query, SWR). C'est le bon outil pour ce cas — Sprint Refactor-Architecture l'a explicitement skippé pour rester en custom hooks.
- Alternative tactique sans dep : utiliser `useSyncExternalStore` ou `Promise` resource + `use()` (React 19) — mais c'est plus de cérémonie qu'un TanStack Query.
- Compromis intermédiaire : extraire un `useFetchOnMount(fn, deps)` helper qui encapsule le pattern + `// eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only fetch, idempotent` ; documenter le pattern une seule fois.

**Décision à prendre Phase 1** : TanStack Query (couvre des dizaines de hooks d'un coup, +1 dep stable, breaking change UX si mauvaise gestion de cache) ou `useFetchOnMount` helper (pas de dep, mais reste de la dette `eslint-disable` documentée).

### Pattern C — `ref.current` lu pendant render (`useProgressData.ts:41`)

**Anti-pattern** : `if (refContext.current === ...)` dans le body. La règle `react-hooks/refs` enforce que `ref.current` n'est lu/écrit qu'à l'intérieur d'un `useEffect` ou d'un event handler. Le rationale React : le ref n'est pas reactive, lire pendant render peut renvoyer une valeur stale après une mise à jour concurrente.

**Refactor** : déplacer la lecture dans un `useEffect` ou repenser la logique pour ne pas dépendre du ref pendant le render. À voir au cas-par-cas (1 seul site).

## Fichiers concernés (impact)

- **Hooks fetchers** (~10 sites, pattern B) : `useBudgets.ts`, `useIncomes.ts`, `useGroups.ts`, `useProfile.ts`, `useRealExpenses.ts`, `useRealIncomes.ts`, `useExpenseProgress.ts`, `useIncomeProgress.ts`, `useProgressData.ts`. Si TanStack Query : impact API consumer-side (return shape change).
- **Modals / Dialogs** (~6 sites, pattern A) : `AddTransactionModal.tsx`, `EditBudgetDialog.tsx`, `EditIncomeDialog.tsx`, `EditTransactionModal.tsx`, `ExpenseBreakdownPreview.tsx`, `SavingsDistributionDrawer.tsx`. Refactor avec `useState(() => init)` lazy ou `key` prop.
- **Components singletons** (~4 sites) : `monthly-recap/page.tsx`, `ProfileSettingsCard.tsx`, `UserAvatar.tsx`, `AuthContext.tsx`, `PlanningDrawer.tsx`. Cas-par-cas, principalement initialisation ou form state sync.
- **`useProgressData.ts:41`** (1 site, pattern C) : seul site `react-hooks/refs`.

## Critères de succès

- `pnpm lint:check` exit 0, **0 occurrence** de `react-hooks/set-state-in-effect` ou `react-hooks/refs` dans la sortie (hors `eslint-disable` documentés en pattern B).
- [eslint.config.mjs](eslint.config.mjs) : remonter les 2 rules à `error` (supprimer le bloc downgrade `'react-hooks/set-state-in-effect': 'warn'` + `'react-hooks/refs': 'warn'`). La règle finale enforce qu'aucun nouveau site ne peut être introduit sans `eslint-disable-next-line` justifié.
- `pnpm typecheck` + `pnpm test:run` + `pnpm build` exit 0 après chaque commit.
- Pour les `eslint-disable-next-line react-hooks/set-state-in-effect` qui resteraient (pattern B fetchers si TanStack Query non choisi) : **chaque** disable doit avoir le `-- <raison>` explicite (mount-only, fetch idempotent, etc.) per pattern Sprint Lint-Baseline-Cleanup.
- Smoke browser manuel : ouvrir / dashboard / group-dashboard / settings + add transaction → vérifier qu'aucun re-render infinite loop ou warning console n'a été introduit (les refactors `useMemo` direct peuvent shifter le timing de certains rendus).

## Hors scope

- **Pas de migration Tailwind 4** (chantier Sprint Tailwind-v4 séparé per CLAUDE.md §11).
- **Pas de refactor `process-step1`** (chantier I5 séparé).
- **Pas de cleanup console.log** (chantier console.log cleanup séparé). Tu peux laisser les warnings `no-console` tels quels.
- **Pas de migration TanStack Query si non arbitré Phase 1** — fallback `useFetchOnMount` helper acceptable.
- **Pas de touch sur `lib/financial-calculations.ts`** (chantier I4 séparé).

## Approche recommandée

1. **Phase 1 inventaire** : lancer `pnpm lint:check 2>&1 | grep "react-hooks/" > tmp_violations.txt` pour le mapping exact à l'instant T (peut différer légèrement de l'extrait Sprint 1). Lire les 25 sites pour catégoriser pattern A / B / C. Décider TanStack Query vs `useFetchOnMount` helper vs `eslint-disable` documenté pour pattern B (idéalement avec l'utilisateur via `AskUserQuestion`).

2. **Phase 2 design** : si TanStack Query, plan de migration des ~9 hooks fetchers + impact consumer-side. Sinon, design du `useFetchOnMount(fn, deps)` helper.

3. **Phase 3 exécution** : grouper les commits par pattern :
   - 1 commit par hook fetcher refactoré (pattern B) — atomique, testable individuellement.
   - 1 commit pour les 6 modals (pattern A) — cohérent, refactor uniforme.
   - 1 commit pour les 4 components singletons (pattern A divers).
   - 1 commit pour `useProgressData.ts` (pattern C, 1 site).
   - 1 commit final : remonter les 2 rules à `error` dans `eslint.config.mjs` + closeout CLAUDE.md.

4. **Tests** : après chaque commit, `pnpm verify` exit 0. Si tests gated `SUPABASE_API_TESTS=1` couvrant les hooks refactorés existent, les lancer manuellement (le PR gate ne les lance pas).

5. **Smoke** : dev server + browser manuel après le commit final, comme documenté dans CLAUDE.md (section "Pour UI/frontend changes").

## Score attendu

~94/100 → ~95/100 (+1 point dette react-hooks éliminée). Pas de gain DB-side ni testing-side dans ce sprint.

## Liens

- Sprint 1 prompt original : [prompt/prompt-04-tooling-dx.md](prompt-04-tooling-dx.md)
- Sprint 1 closeout commit : `0e27c29 docs(claude): closeout Sprint 1 (tooling industrialization)`
- Plan d'exécution Sprint 1 : `C:\Users\gille\.claude\plans\sprint-1-soft-lovelace.md`
- React 19 docs sur `set-state-in-effect` : https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
- `eslint-plugin-react-hooks` v7 changelog : https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md
