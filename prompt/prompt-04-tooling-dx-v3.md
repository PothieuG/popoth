# Sprint 2 — TanStack Query bridge cleanup + Sprint 1 followups

## Contexte

Le **Sprint 1.5** (livré 2026-05-09) a migré 11 hooks fetcher vers TanStack Query et refactoré les modals/components flagués par `react-hooks/set-state-in-effect`. Pour minimiser le risque, **3 dettes intentionnelles** ont été laissées en place (toutes documentées) :

1. **Bridge legacy `triggerFinancialRefresh()` / `registerFinancialRefreshCallback()`** dans [hooks/useFinancialData.ts](hooks/useFinancialData.ts) — préservé pour back-compat avec les 5 hooks CRUD encore non-Query au moment du Sprint 1.5. Désormais TOUS les hooks utilisent Query, donc le bridge est devenu un wrapper redondant autour de `queryClient.invalidateQueries()`.
2. **`if (!isOpen) return null` dans 4 modals** ([EditBudgetDialog](components/dashboard/EditBudgetDialog.tsx), [EditIncomeDialog](components/dashboard/EditIncomeDialog.tsx), [EditTransactionModal](components/dashboard/EditTransactionModal.tsx), [AddTransactionModal](components/dashboard/AddTransactionModal.tsx)) — dead code depuis Sprint 1.5 (parents font `{isOpen && <Modal />}`), conservé pour que la modal reste défensive si réutilisée par un autre parent.
3. **2 `eslint-disable react-hooks/set-state-in-effect`** documentés ([ProfileSettingsCard:44](components/profile/ProfileSettingsCard.tsx#L44) async profile init, [AuthContext:260](contexts/AuthContext.tsx#L260) async pipeline init) — false positives du linter v7.

Ce sprint nettoie la dette de polish post-Sprint 1.5 et clôt le **commitlint** différé du Sprint 1.

---

## Décisions à arbitrer Phase 1 (avec utilisateur via `AskUserQuestion`)

### Question 1 — Stratégie de cleanup du bridge

Trois options :

- **(a) Suppression totale** : delete les exports `triggerFinancialRefresh()` / `registerFinancialRefreshCallback()` de [hooks/useFinancialData.ts](hooks/useFinancialData.ts), remplacer les ~11 callsites dans 5 hooks (useBudgets, useIncomes, useRealIncomes, useRealExpenses, useProfile) par `queryClient.invalidateQueries({ queryKey: [...] })` directement dans les `onSuccess` des mutations. Supprimer les 3 bridge effects (dans useFinancialData, useProgressData, useBudgets). **Net : ~−50 LOC, ~5 fichiers touchés.** Migration nette, plus aucune mention de `triggerFinancialRefresh` dans le repo.
- **(b) Garder le bridge mais remplacer son corps** : `triggerFinancialRefresh()` devient un thin wrapper qui appelle `queryClient.invalidateQueries({ queryKey: ['financial-summary'] })` directement (pas de callback registry). Simpler que (a) mais laisse la surface API intacte. Préserve les callsites tels quels.
- **(c) Statu quo, no-op** : le bridge fonctionne, pas de besoin urgent de cleanup. Skip.

**Critères pour arbitrer** :

- Coût d'erreur : (a) refactor 11 callsites + 3 effects, augmente la surface de régression. Mitigation : `pnpm dev` smoke test après chaque hook modifié.
- Bénéfice : (a) supprime ~50 LOC de code mort + clarté sur le data-flow. (b) rationalise l'implémentation sans toucher les consumers. (c) zéro effort.
- Recommandation : (a) si la session a la charge, (b) sinon, (c) seulement si on veut ajouter d'autres choses au sprint.

### Question 2 — Scope sur les autres dettes Sprint 1.5

- **(a) Inclure dans le sprint** :
  - Modal `if (!isOpen) return null` retrait (4 fichiers, ~4 lignes supprimées). Bénéfice marginal mais cohérent avec la migration parent-conditional-render.
  - ProfileSettingsCard sub-component split pour retirer le `eslint-disable` (~50 LOC redécoupage). Permet d'avoir 1 disable au lieu de 2 dans le repo.
- **(b) Skip ces deux items** — laisser comme dette acceptée, le scope reste bridge cleanup + commitlint.

### Question 3 — commitlint (Sprint 1 deferred)

- **(a) Inclure** : `pnpm add -D @commitlint/cli @commitlint/config-conventional` + `commitlint.config.mjs` + `.husky/commit-msg` (`pnpm exec commitlint --edit "$1"`). Documenté dans CLAUDE.md §6 comme contraint à `feat:`, `fix:`, `chore:`, `docs:`, `perf:`, `test:`, optionnellement avec scope.
- **(b) Skip** : l'arbitrage Sprint 1 disait que la convention était documentée par confiance et qu'un repo solo n'a pas besoin de hook auto. Si rien n'a changé (toujours solo), skip à nouveau.

---

## Phase 0 — Pré-flight

- `pnpm lint:check` exit 0 attendu (Sprint 1.5 closeout).
- `pnpm verify` exit 0 attendu.
- `git log --oneline -2` doit montrer le closeout Sprint 1.5 (`979bebc`).
- Confirmer que les exports `triggerFinancialRefresh` / `registerFinancialRefreshCallback` sont toujours dans [hooks/useFinancialData.ts](hooks/useFinancialData.ts) (sinon le sprint a déjà été fait, abort).
- Compter les callsites : `grep -rn "triggerFinancialRefresh\(\)" hooks/` doit retourner ~11 lignes (3 dans useBudgets, 3 dans useIncomes, 3 dans useRealIncomes, 3 dans useRealExpenses, 1 dans useProfile).

---

## Phase 1 — Inventaire + arbitrages

Lancer 1 Explore agent pour :

1. Lister tous les callsites de `triggerFinancialRefresh()` (mutations onSuccess hooks).
2. Lister tous les callsites de `registerFinancialRefreshCallback(handler)` (bridge effects dans useFinancialData / useProgressData / useBudgets).
3. Catégoriser : quel `queryKey` chaque appelant impacte (financial-summary ? progress-data ? budgets ? real-incomes ? etc.).
4. Vérifier que les 4 modals (`if (!isOpen) return null`) sont seulement consommés par les parents Sprint 1.5 (PlanningDrawer, dashboard, group-dashboard).

Rapport : tableau (file:line, callsite type, query key impacté). Décisions arbitrage via `AskUserQuestion` (3 questions ci-dessus).

---

## Phase 2 — Bridge cleanup (si option (a))

### Migration callsite-par-callsite

Pour chaque hook (useBudgets, useIncomes, useRealIncomes, useRealExpenses, useProfile) :

```ts
// Before — Sprint 1.5 état
const addMutation = useMutation({
  mutationFn: ...,
  onSuccess: (newItem) => {
    queryClient.setQueryData<T[]>(queryKey, (prev = []) => [newItem, ...prev])
    triggerFinancialRefresh()  // ← bridge
  },
})

// After — Sprint 2 cleanup
const addMutation = useMutation({
  mutationFn: ...,
  onSuccess: (newItem) => {
    queryClient.setQueryData<T[]>(queryKey, (prev = []) => [newItem, ...prev])
    // Direct invalidate — bridge supprimé
    queryClient.invalidateQueries({ queryKey: ['financial-summary'] })
    queryClient.invalidateQueries({ queryKey: ['progress-data'] })
  },
})
```

**Trade-off** : `invalidateQueries()` (sans key) invalide tout le cache — plus large mais plus simple. `invalidateQueries({ queryKey: ['x'] })` est précis mais nécessite de connaître la liste exacte des queries impactées par chaque mutation.

**Recommandation** : utiliser `invalidateQueries()` (broad) pour la simplicité, sauf si une mutation impacte clairement une seule query.

### Suppression des bridge effects

Dans **useFinancialData**, **useProgressData**, **useBudgets** : supprimer le `useEffect` qui registre un callback. Avec les invalidateQueries directs dans les onSuccess des mutations, le bridge n'a plus de raison d'exister.

### Suppression des exports

Dans [hooks/useFinancialData.ts](hooks/useFinancialData.ts) :

- Supprimer `financialRefreshCallbacks` Set, `registerFinancialRefreshCallback`, `triggerFinancialRefresh`.
- Supprimer les imports correspondants dans les 5 hooks CRUD.

### Acceptance

- `grep -rn "triggerFinancialRefresh\|registerFinancialRefreshCallback" hooks/` retourne 0 lignes (aussi `app/`, `components/`).
- `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` + `pnpm build` exit 0.
- `pnpm dev` smoke test : ajouter une dépense / un revenu / un budget → vérifier que le dashboard refresh automatiquement (via TanStack DevTools : observer les invalidations).

**~3-5 commits** : (1) useBudgets + useRealExpenses, (2) useIncomes + useRealIncomes, (3) useProfile + bridge effects, (4) delete bridge exports + imports, (5) closeout.

---

## Phase 3 — Cleanup dettes mineures (si option (a) Q2)

### Modal `if (!isOpen) return null` retrait

Pour les 4 modals ([EditBudgetDialog](components/dashboard/EditBudgetDialog.tsx), [EditIncomeDialog](components/dashboard/EditIncomeDialog.tsx), [EditTransactionModal](components/dashboard/EditTransactionModal.tsx), [AddTransactionModal](components/dashboard/AddTransactionModal.tsx)) : supprimer la garde défensive `if (!isOpen || !budget) return null`. Sprint 1.5 a fait que les parents conditionnent le rendu via `{isOpen && editing && <Modal ... />}`, donc la modal ne reçoit jamais `isOpen=false`.

**Risque** : si un nouveau parent oubliait de conditionner et passait `isOpen=false` directement, la modal afficherait son backdrop+container sans contenu. Mitigation : préserver le check `if (!editing && transaction-required-prop) return null` (validation de prop, pas d'isOpen).

**1 commit** : retrait des 4 gardes en bloc, vérif `pnpm build` exit 0.

### ProfileSettingsCard sub-component split

Refactorer [components/profile/ProfileSettingsCard.tsx](components/profile/ProfileSettingsCard.tsx) :

- Composant outer `ProfileSettingsCard` : appelle `useProfile()`, early return Loading si `!profile`, sinon `<ProfileSettingsForm key={profile.id} profile={profile} ... />`.
- Composant inner `ProfileSettingsForm` : prend `profile` comme prop required (non-null), lazy `useState(() => profile.first_name)`, etc.
- Supprimer le `eslint-disable react-hooks/set-state-in-effect` block — plus nécessaire car la sync de prop devient un mount-time-only via key prop.

**~50 LOC de redécoupage**, 1 commit. Le compteur de disables passe de 2 à 1 dans le repo.

---

## Phase 4 — commitlint (si option (a) Q3)

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional
```

Créer [commitlint.config.mjs](commitlint.config.mjs) :

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],  // permet la capitalisation française
    'header-max-length': [2, 'always', 100],
  },
}
```

Créer [.husky/commit-msg](.husky/commit-msg) :

```bash
pnpm exec commitlint --edit "$1"
```

Verifier `chmod +x .husky/commit-msg` (Husky 9 ne le fait plus auto).

Test : `git commit -m "test"` → doit échouer avec "subject may not be empty" ; `git commit -m "test: foo"` → OK.

**1 commit** : feat(deps) commitlint setup + closeout.

---

## Phase 5 — Closeout

- Update [CLAUDE.md](CLAUDE.md) §11 roadmap : add Sprint 2 entry.
- Update [CLAUDE.md](CLAUDE.md) §6 ESLint suppressions : si Phase 3 ProfileSettingsCard split, mention du retrait du disable (1 disable restant : AuthContext).
- Update [CLAUDE.md](CLAUDE.md) §8 conventions : si Phase 4 commitlint, ajouter une note "commit message validation via .husky/commit-msg".
- Update [README.md](README.md) Stack table si commitlint ajouté.
- Score estimé ~95 → ~96.

---

## Verification end-to-end

1. `pnpm typecheck` exit 0.
2. `pnpm lint:check` exit 0.
3. `pnpm test:run` exit 0.
4. `pnpm format:check` exit 0.
5. `pnpm build` exit 0 (57/57 routes).
6. `pnpm verify` exit 0 (~36s).
7. `pnpm run ci` exit 0.
8. **Smoke browser** : ajouter/éditer/supprimer une transaction (toutes les invalidations Query doivent firer en regardant TanStack DevTools).
9. Si Phase 4 : `git commit -m "test"` rouge ; `git commit -m "feat: test"` vert.
10. Si Phase 3 : `pnpm lint:check 2>&1 | grep "react-hooks/set-state-in-effect"` retourne 1 ligne (AuthContext) au lieu de 2.

---

## Risques + open questions

- **Bridge → invalidateQueries broadening** : si on remplace `triggerFinancialRefresh()` (qui invalidait spécifiquement `financial-summary`) par `queryClient.invalidateQueries()` (broad), on invalide aussi `expense-progress`, `progress-data`, `step1-data`, `step2-data`, etc. Cela cause des refetch inutiles mais préserve la sémantique. Trade-off acceptable pour la simplicité.
- **Modal `key` prop side-effect** : si un consumer oublie de passer `key={editing.id}` après le retrait du `if (!isOpen) return null` defensive, la modal pourrait afficher des données obsolètes. Audit grep nécessaire.
- **commitlint hook bypass** : `git commit --no-verify` reste toujours possible. Le hook pre-push (lint:check + typecheck) reste le filet final.
- **Aucune migration DB** dans ce sprint. Aucun test gated nécessaire.

---

## Hors scope

- Migration TanStack Query persistence (localStorage offline) — chantier séparé si désiré.
- Optimistic updates via `onMutate` — chantier UX si désiré.
- TanStack Query devtools en production — pas de demande utilisateur.
- Refactor ProfileSettingsCard si Phase 3 (a) skip — laisser l'1 disable restant.
- AuthContext disable retrait — le pattern est trop complexe à refactor (mount-only effect avec async cleanup), reste un `eslint-disable` justifié.

---

## Score attendu

~95/100 → ~96/100 si bridge cleanup + commitlint + dettes Phase 3.
~95/100 → ~95.5/100 si bridge cleanup uniquement.

Le score capture la propreté du code mais le bénéfice principal est cognitif : il ne reste plus aucune mention du legacy callback registry dans le repo, le data-flow est entièrement géré par TanStack Query.

---

## Liens

- Sprint 1.5 prompt : [prompt/prompt-04-tooling-dx-v2.md](prompt-04-tooling-dx-v2.md)
- Sprint 1.5 plan : `C:\Users\gille\.claude\plans\sprint-1-5-peaceful-glade.md`
- Sprint 1.5 closeout commit : `979bebc docs(claude): closeout Sprint 1.5 (react-hooks v7 refactor + TanStack Query)`
- Sprint 1 prompt : [prompt/prompt-04-tooling-dx.md](prompt-04-tooling-dx.md)
- TanStack Query Mutations + Cache Invalidation : https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
- commitlint config-conventional : https://commitlint.js.org/reference/configuration.html
