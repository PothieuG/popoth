# Prompt — Sprint 2-followup-v4 : Pure-unit tests pour `authReducer` + polish AuthContext

## Contexte

Sprint 2-followup-v3 (livré 2026-05-10, plan dans `C:\Users\gille\.claude\plans\prompt-sprint-smooth-abelson.md`, commits `8a9432f..f65c7ef`) a migré [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) de 3 `useState` (user, loading, error) vers 1 `useReducer` avec 10 actions (`INIT_START` / `INIT_SUCCESS` / `INIT_ERROR` / `AUTH_REQUEST` / `AUTH_SUCCESS` / `AUTH_FAILURE` / `LOGOUT_START` / `LOGOUT` / `REGISTER_SUCCESS` / `CLEAR_ERROR` / `SET_USER`). Cela a éliminé le dernier `eslint-disable react-hooks/set-state-in-effect` du codebase (compteur 1 → 0).

**Phase 1 du sprint v3 a confirmé** : zéro test n'existe pour `AuthContext` aujourd'hui. La verif v3 reposait uniquement sur (a) typecheck pour l'exhaustiveness via `never` default, (b) lint pour absence du disable, (c) smoke browser deferred to user. Aucun regression-guard pour les transitions `authReducer`.

C'est le pattern que Sprint 2-followup a appliqué à `invalidateFinancialRefreshes` ([lib/**tests**/query-client.test.ts](../lib/__tests__/query-client.test.ts)) : un test pure-unit non-gated, ~30-50 LOC, qui pin le comportement contre un futur drift. La migration `useReducer` du sprint v3 mérite le même traitement — surtout parce qu'un changement de transition (e.g. réorganiser les actions sous `useImmer`, ajouter un middleware d'audit, ou ajuster `LOGOUT` pour clear `loading`) passerait la CI sans aucun signal aujourd'hui.

Ce sprint ferme ce gap. Il propose aussi 2 polish optionnels qui ont émergé de la migration mais sont hors scope v3 :

- (b) Memoize `userValue` / `actionsValue` via `useMemo` — avec `useReducer`, le state object identity change à chaque dispatch, donc les littéraux `{ user, loading, error, isLoggedIn }` ligne 271-276 et `{ login, register, logout, clearError, refreshUserSession }` ligne 278-284 créent une nouvelle référence à chaque render, faisant re-rendre tout consumer de `useAuthUser()` ou `useAuthActions()` même quand la slice n'a pas changé. Pas une régression vs avant (le code antérieur était aussi un littéral non-mémoizé) mais une amélioration mesurable.
- (c) Renommer ou splitter [lib/**tests**/trigger-behavior.test.ts](../lib/__tests__/trigger-behavior.test.ts) — Case 5 ajouté en v3 teste un FK ON DELETE SET NULL (action FK, pas trigger). Le commentaire de tête du fichier dit "behavior tests for the trigger functions captured in supabase/migrations/20260512000000_capture_trigger_functions.sql" — Case 5 ne fit pas. Options : (i) renommer le fichier `group-deletion-cascade.test.ts` (englobe les 2 mécanismes), (ii) splitter en `trigger-behavior.test.ts` + `fk-cascade.test.ts`, (iii) laisser tel quel avec le comment scope-élargi (le plus simple).

---

## Item 1 (priorité haute, scope minimum) — Pure-unit tests pour `authReducer`

### 1.1 Cible

[lib/**tests**/auth-reducer.test.ts](../lib/__tests__/auth-reducer.test.ts) (NOUVEAU). Pattern miroir de [lib/**tests**/query-client.test.ts](../lib/__tests__/query-client.test.ts) — pure-unit, non-gated, vitest globals importés explicitement (CLAUDE.md §9 : "les globals vitest **ne sont PAS auto-imported** dans ce repo").

### 1.2 Surface à tester (10 cas, 1 par action)

Pour chaque transition, verify :

- L'output state est correct (deep-equal sur les 3 champs `user`, `loading`, `error`)
- L'identity du state object est NEW (pas un mutation in-place — important parce que useReducer s'attend à une nouvelle référence pour re-render)

```ts
import { describe, it, expect } from 'vitest'
import { authReducer, type AuthState } from '@/contexts/AuthContext'
// Note: AuthState + authReducer ne sont PAS exported aujourd'hui.
// Soit (a) les ré-exporter depuis AuthContext.tsx, soit (b) extraire
// le reducer dans un fichier dédié `contexts/auth-reducer.ts` puis
// re-importer dans AuthContext.

const baseState: AuthState = { user: null, loading: false, error: null }
const fakeUser = { id: 'user-1', email: 'a@b.test' /* ... */ } as AuthUser
```

Cas à couvrir :

1. `INIT_START` → `loading: true`, autres champs préservés
2. `INIT_SUCCESS` (user) → user set, loading false, error null
3. `INIT_SUCCESS` (null) → user null (logout-like), loading false, error null
4. `INIT_ERROR` → user null, loading false, error set
5. `AUTH_REQUEST` → loading true, error null, user préservé
6. `AUTH_SUCCESS` → user set, loading false, error null
7. `AUTH_FAILURE` → loading false, error set, user préservé (login fail ne logout pas)
8. `LOGOUT_START` → loading true, user et error préservés
9. `LOGOUT` → user null, error null, loading préservé (le LOGOUT_START a déjà flip loading)
10. `REGISTER_SUCCESS` → loading false, error null, user préservé (signUp ne login pas)
11. `CLEAR_ERROR` → error null, autres préservés
12. `SET_USER` (user) → user replaced, autres préservés

Plus 1 test "exhaustive" : passing une action invalide (cast via `as AuthAction`) → state inchangé via le `default` branch (le `never` exhaustiveness check est compile-time, pas runtime — vérifier que le runtime ne crash pas).

### 1.3 Décision Phase 1 à arbitrer — exporter le reducer ou extraire

**Option A** : ré-exporter `authReducer` + `AuthState` + `AuthAction` + `initialAuthState` depuis [contexts/AuthContext.tsx](../contexts/AuthContext.tsx). Modif : ajouter `export` aux déclarations existantes. Petite surface API mais expose des internals.

**Option B** : extraire le reducer dans [contexts/auth-reducer.ts](../contexts/auth-reducer.ts) (NOUVEAU). [AuthContext.tsx](../contexts/AuthContext.tsx) re-importe. Plus propre, encapsule mieux. ~20 lignes déplacées + 1 nouvel import. Aligne avec le découpage Sprint Hygiène-Code (split contexts).

**Recommandation** : Option B. Le reducer est testable en isolation et n'a pas de dépendance React (juste des types `AuthUser`). L'extraire clarifie la responsabilité.

### 1.4 Workflow

1. Phase 1 inventaire : lire [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) pour confirmer les transitions actuelles (verif vs ce prompt — le prompt peut driver si user a modifié AuthContext entre temps).
2. Phase 2 décision : option A vs B (cf. 1.3 + AskUserQuestion si user veut arbitrer).
3. Phase 3 exécution :
   - (Option B) extraire `auth-reducer.ts`.
   - Écrire `lib/__tests__/auth-reducer.test.ts` avec les 12+1 cas.
   - Verif `pnpm test:run` → 6 passed (was 5) / 34 skipped, le nouveau test fait passer le compteur non-gated de 5 à 6.
4. Phase 4 verif : `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` + `pnpm format:check` + `pnpm build` exit 0.

### 1.5 Critères de succès

- 12+1 cas dans [lib/**tests**/auth-reducer.test.ts](../lib/__tests__/auth-reducer.test.ts) tous verts.
- Compteur tests non-gated : 5 → 6 passed (5 / 33 skipped → 6 / 33 skipped — la nouvelle suite n'est pas gated).
- (Option B retenu) [contexts/auth-reducer.ts](../contexts/auth-reducer.ts) extrait, [AuthContext.tsx](../contexts/AuthContext.tsx) re-importe.
- `pnpm verify` exit 0 + `pnpm run ci` exit 0.

---

## Item 2 (priorité moyenne, optionnel) — Memoize `userValue` / `actionsValue`

### 2.1 Pourquoi

Avec `useReducer`, le state object identity change à chaque dispatch. Les littéraux ligne 271-276 et 278-284 dans [AuthContext.tsx](../contexts/AuthContext.tsx) créent une nouvelle référence d'objet à chaque render — même si dispatch ne change PAS la slice consommée par un consumer. React Context fait un shallow-equal sur le value prop pour déclencher les re-renders ; un nouvel objet litéral ≠ même contenu = tous les consumers re-rendent.

**Cas concret** : `useLogin()` ([hooks/useAuth.ts:120](../hooks/useAuth.ts)) destructure `error` de `useAuthUser()` + `login` de `useAuthActions()`. Si AuthContext dispatch `INIT_START` (loading flip true), `userValue` est recréé → `useLogin()` re-render même si `error` n'a pas bougé.

### 2.2 Implementation

```ts
const userValue: AuthUserValue = useMemo(
  () => ({ user, loading, error, isLoggedIn }),
  [user, loading, error, isLoggedIn],
)

const actionsValue: AuthActionsValue = useMemo(
  () => ({ login, register, logout, clearError, refreshUserSession }),
  [login, register, logout, clearError, refreshUserSession],
)
```

Les 5 fonctions actions (`login`, `register`, etc.) sont déjà `useCallback` (cf. [contexts/AuthContext.tsx:188-258](../contexts/AuthContext.tsx)) donc leurs identités sont stables — la `useMemo` sur `actionsValue` est essentiellement un no-op après le premier render mais reste utile pour la lisibilité et pour signaler "cet objet est stable".

### 2.3 Risk

Aucun. Memo est strictement additif au comportement existant — même valeur, identité plus stable.

### 2.4 Critères de succès

- 2 `useMemo` ajoutés.
- `import { useMemo, ... }` ajouté au top.
- `pnpm verify` + `pnpm run ci` exit 0.

---

## Item 3 (priorité basse, optionnel) — Renommer ou re-organiser le test file

### 3.1 Décision

**Option A (recommandé)** : laisser [lib/**tests**/trigger-behavior.test.ts](../lib/__tests__/trigger-behavior.test.ts) tel quel. Case 5 a un comment dédié expliquant le scope-élargissement ("Not a trigger function strictly speaking, but lives in this file because it covers the same surface — what happens when a group is deleted"). Pas de bénéfice à renommer.

**Option B** : renommer en `lib/__tests__/group-deletion-cascade.test.ts`. Plus précis sémantiquement, englobe trigger + FK. Mais nécessite update du commentaire de tête + de [scripts/check-trigger-functions.mjs](../scripts/check-trigger-functions.mjs) (`MIGRATION_PATH` + le source comment) pour refléter le path.

**Option C** : splitter en 2 fichiers (`trigger-behavior.test.ts` + `fk-cascade.test.ts`). Maximise la séparation conceptuelle mais double les fixtures (chaque suite a son propre `beforeAll` / `afterAll`) et complique le shared state entre Cases 1-3 et Case 5 (Case 5 dépend implicitement de `groupId` ayant été deleted dans Case 3 pour que les profile.group_id soient null avant la fixture du fresh `groupId2`).

**Recommandation** : Option A. Le coût de B/C dépasse le bénéfice. Si on ajoute plus de tests FK dans le futur, repenser à ce moment-là.

### 3.2 Critère de succès

Selon l'option retenue.

---

## Décomposition commits proposée

Si Items 1+2 retenus, Item 3 = Option A (skip) :

1. **`refactor(auth-context): extract authReducer to dedicated module`** (Option B 1.3) — [contexts/auth-reducer.ts](../contexts/auth-reducer.ts) NEW + [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) modifié pour importer.
2. **`test(auth): cover authReducer transitions`** — [lib/**tests**/auth-reducer.test.ts](../lib/__tests__/auth-reducer.test.ts) NEW.
3. **`refactor(auth-context): memoize userValue and actionsValue`** — Item 2.
4. **`docs(claude): closeout Sprint 2-followup-v4`** — update CLAUDE.md §11.

Si Items 1 only :

1. Refactor + extract.
2. Test.
3. Closeout.

---

## Hors scope

- **Console.log cleanup général** (1331 occurrences ; baseline lint 991 warnings) — chantier dédié.
- **Sprint Tailwind-v4** / **Sprint Supabase-Strict-Types** / **Chantiers I4 + I5 + Zod rollout** — sprints séparés.
- **Refactor full outer/inner split de `AuthProvider`** (option C de v2) — risque trop élevé pour le gain.
- **Tests d'intégration `AuthProvider` + React Testing Library** — out of scope. Le reducer pure-unit suffit comme regression-guard. Tests d'intégration sur le component nécessiteraient renderer setup + mocking de `lib/auth.ts` + `localStorage` — gros effort pour faible incremental value.

---

## Phase 0 — Pré-flight

- `pnpm verify` exit 0 attendu (baseline post-v3).
- `git log --oneline -8` doit montrer Sprint v3 closeout `f65c7ef`.
- `grep -n "set-state-in-effect" contexts/AuthContext.tsx` retourne **0 hits** (post-v3).
- `pnpm test:run` retourne **5 passed / 33 skipped** (le compteur non-gated post-v3 ; le 6e du sprint v4 sera le nouveau test).

---

## Phase 1 — Inventaire (obligatoire)

- Lire [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) lignes 22-78 (les types + reducer) — confirmer les 10 actions et leurs transitions correspondent à ce prompt.
- Lire [lib/**tests**/query-client.test.ts](../lib/__tests__/query-client.test.ts) en intégralité — c'est le pattern à mirror (vitest globals importés explicitement, pas de Supabase, deterministic).
- Lire [hooks/useAuth.ts](../hooks/useAuth.ts) pour confirmer les 4 hooks composés (`useRequireAuth`, `useRequireGuest`, `useLogin`, `useRegister`, `useLogoutAndRedirect`) et lesquels subscribent à quel context — informe la décision Item 2 memoize.

---

## Verification end-to-end

- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0 (0 errors / 991 warnings stable, le test file ne touche aucune règle)
- `pnpm test:run` 6 passed / 33 skipped (Item 1 retenu)
- `pnpm format:check` exit 0
- `pnpm build` exit 0 (56/56 routes)
- `pnpm verify` exit 0
- `pnpm run ci` exit 0

---

## Score attendu

~97.5/100 → ~98/100 (Items 1+2). Coverage du reducer + perf marginale du memoize.

---

## Liens

- Sprint 2-followup-v3 plan : `C:\Users\gille\.claude\plans\prompt-sprint-smooth-abelson.md`
- Sprint 2-followup-v3 closeout : commit `f65c7ef`
- Pattern test pure-unit non-gated : [lib/**tests**/query-client.test.ts](../lib/__tests__/query-client.test.ts) (Sprint 2-followup, livré 2026-05-09)
- React `useReducer` docs : https://react.dev/reference/react/useReducer
- React Context perf : https://react.dev/reference/react/useContext#optimizing-re-renders-when-passing-objects-and-functions (recommandation explicite de memoize les value props pour Context)
