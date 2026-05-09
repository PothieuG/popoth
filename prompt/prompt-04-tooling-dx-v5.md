# Prompt — Sprint 2-followup-v2 : useGroups invalidation + AuthContext split

## Contexte

Sprint 2 (livré 2026-05-09, closeout `c8094ab`) a remplacé le bridge legacy `triggerFinancialRefresh()` par un helper local `invalidateFinancialRefreshes(qc)` répété dans 5 hooks. Sprint 2-followup (livré 2026-05-09, commits `877fe89..9788567`) a extrait ce helper vers [lib/query-client.ts](lib/query-client.ts) en single source of truth, ajouté un test régression, et nettoyé un bloc debug `console.log`.

Au passage de Sprint 2-followup, deux gaps ont été surfacés mais explicitement laissés hors scope. Ce sprint les ferme.

---

## Gap 1 — `useGroups.ts` ne déclenche pas `invalidateFinancialRefreshes`

### Le bug

[hooks/useGroups.ts](hooks/useGroups.ts) expose 5 mutations : `createGroup`, `updateGroup`, `deleteGroup`, `joinGroup`, `leaveGroup`. **Aucune** n'appelle `invalidateFinancialRefreshes(queryClient)`. Or :

- **`joinGroup`** modifie `profiles.group_id` server-side. Le contexte d'authentification du browser change effectivement après join : les calls suivants à `/api/finance/summary?context=group` retournent désormais des données réelles (au lieu de `{ error: 'NO_GROUP' }`). Le `['financial-summary']` cache pour le contexte `group` doit être invalidé. Idem pour `['progress-data']` et `['budgets']`.
- **`leaveGroup`** symétrique : retire le `group_id`. Les caches `group` deviennent stale (l'utilisateur ne devrait plus voir les données du groupe).
- **`deleteGroup`** : si l'utilisateur est créateur, supprime le groupe + les contributions associées. Les agrégats financiers du groupe disparaissent.
- **`createGroup`** + **`updateGroup`** : moins critiques (ne modifient pas le `profile.group_id` du créateur côté API), mais `updateGroup` peut changer la signature affichée du groupe — vérifier si `['profile']` doit être invalidé aussi.

Aujourd'hui, l'utilisateur qui join/leave un groupe doit forcer un refresh manuel (F5) pour voir les bonnes données. C'est un **bug de fraîcheur** silencieux : pas de crash, juste des données incohérentes jusqu'au prochain `staleTime` (30s par défaut, [lib/query-client.ts](lib/query-client.ts)) ou jusqu'à un refetch manuel.

### Côté serveur

Vérifier également : est-ce que `joinGroup` / `leaveGroup` updates le `profile.group_id` réellement, ou juste les `group_contributions` ? Si seul `group_contributions` change, l'invalidation à propager peut différer. **Phase 1 inventaire obligatoire** sur [app/api/groups/[id]/members/route.ts](app/api/groups/%5Bid%5D/members/route.ts) (POST = join, DELETE = leave) — vérifier le SET `profile.group_id = ...` et la cascade trigger `cleanup_group_contributions`.

### Fix proposé

Importer `invalidateFinancialRefreshes` depuis `@/lib/query-client` dans `useGroups.ts` et l'invoquer dans les 5 `onSuccess`. Pour les 2 mutations qui changent `profile.group_id` (join, leave) **et** pour deleteGroup, invalider AUSSI `['profile']` (sinon le `useProfile` cache restera avec l'ancien `group_id` jusqu'au prochain refetch/staleTime).

```ts
// hooks/useGroups.ts
import { invalidateFinancialRefreshes } from '@/lib/query-client'

const joinMutation = useMutation<void, Error, string>({
  // ...
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] })
    queryClient.invalidateQueries({ queryKey: ['profile'] }) // group_id changed
    invalidateFinancialRefreshes(queryClient)
  },
})
```

### Décisions à arbitrer Phase 1

- (a) Invalider `['profile']` sur join/leave/delete → peut-il causer un re-render race où `profile.group_id` est `null` puis l'utilisateur est redirigé du group-dashboard avant que le re-fetch trouve le nouveau group_id ? Vérifier le flow consumer (probablement [app/group-dashboard/page.tsx](app/group-dashboard/page.tsx) ou le router). Alternative : `setQueryData(['profile'], (prev) => prev ? { ...prev, group_id: newId } : prev)` pour patcher localement sans round-trip serveur.
- (b) `createGroup` invalide-t-il les vues financières ? Si le créateur devient automatiquement membre (UPSERT sur `group_contributions`), oui. Sinon non. **Lire [app/api/groups/route.ts](app/api/groups/route.ts) POST** pour confirmer le comportement serveur.
- (c) `updateGroup` (rename, etc.) — probablement non, sauf si l'API touche `group_contributions`. Default to NO unless inventory shows otherwise.

### Test à ajouter

Pas obligatoire pour ce gap (pas de regression-guard évident sans test E2E). Mais si on veut, on peut :

- Étendre [lib/**tests**/query-client.test.ts](lib/__tests__/query-client.test.ts) pour couvrir un nouveau helper `invalidateFinancialRefreshesAndProfile(qc)` si on en crée un (cf. décision arbitrale).
- Ou rester silencieux sur le test (le pattern existe — chaque hook l'invoque comme attendu, le helper testé pin la cascade).

### Critères de succès

- [hooks/useGroups.ts](hooks/useGroups.ts) importe `invalidateFinancialRefreshes` depuis `@/lib/query-client`.
- 3 ou 5 mutations (selon décisions Phase 1) invoquent le helper dans `onSuccess`.
- `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` + `pnpm build` exit 0.
- Smoke browser : join un groupe → la dashboard `/group-dashboard` affiche les nouvelles données sans F5. Leave un groupe → le redirect / l'état "no group" prend effet sans F5.

---

## Gap 2 — Refactor de l'unique `eslint-disable react-hooks/set-state-in-effect` restant

### État actuel

Sprint 2 Phase 4 (ProfileSettingsCard split) a fermé 1 des 2 disables `react-hooks/set-state-in-effect`. Il en reste **1** dans [contexts/AuthContext.tsx](contexts/AuthContext.tsx) avec la justification :

> initializeAuth() est async pipeline, setStates fire dans la continuation, pas dans le body de l'effet — false positive

Le disable est techniquement valide (le linter ne distingue pas un `setState` dans le body de l'effet vs dans une `await`-ée continuation). Mais le code reste fragile : tout futur dev qui ajoute un `setState` direct dans l'effet body bypass la règle silencieusement (le disable est block-style, pas next-line).

### Pattern Sprint 2 Phase 4 (ProfileSettingsCard) à mirror

ProfileSettingsCard a été split en :

- **Outer** `ProfileSettingsCard` : data-fetching + loading skeleton.
- **Inner** `ProfileSettingsForm` : reçoit `profile: ProfileData` non-null en prop + `key={profile.id}` au site d'instanciation. Le state est lazy-init `useState(() => profile.first_name ?? '')` — le sync effect form-state-from-prop disparaît.

Pour AuthContext, le split serait :

- **Outer** `AuthProvider` : exécute `initializeAuth()` (la pipeline async qui lit cookie / call `/api/auth/session`), retourne soit un `<AuthLoadingFallback />` soit `<AuthInnerProvider initialUser={user} />`.
- **Inner** `AuthInnerProvider` : reçoit `initialUser` non-null en prop, lazy-init `useState(() => initialUser)`, monte les 2 contextes (AuthUserContext + AuthActionsContext), expose les actions `login`/`register`/`logout`/`refreshUserSession`. Pas d'effet d'init dans cette inner — l'init est déjà fait par le parent.

Le `set-state-in-effect` disable disparaît : l'inner ne fait plus de setState dans un effet (l'init est dans le constructeur via `useState(init)`).

### Décisions à arbitrer Phase 1

- (a) **Comportement pendant le loading** : le pattern actuel rend l'arbre entier avec `loading: true` jusqu'à `initializeAuth()` complete. Le pattern split rendrait un `<AuthLoadingFallback />` — ça peut casser des consumers qui attendent un `useAuth()` toujours monté. Vérifier consumers de `useAuthUser()` / `useAuthActions()` / `useAuth()` agrégateur (cf. CLAUDE.md §4 — ils sont nombreux).
- (b) **Polling auth-check / refresh** : les 2 `setInterval` (`SESSION_REFRESH_INTERVAL_MS`, `AUTH_CHECK_INTERVAL_MS`) doivent rester dans l'inner (ils dépendent de l'user authentifié). C'est compatible avec le split.
- (c) **Erreurs d'init** : si `initializeAuth()` lève / rejette, l'outer doit afficher un état "guest" (la page login peut s'auto-render). Aujourd'hui le pattern set `error` via state — à reproduire dans l'outer.
- (d) **Trade-off** : c'est un refactor non-trivial. Si jamais les consumers cassent en cascade, le coût peut dépasser le bénéfice (élimination d'1 disable). Option de fallback : laisser le disable en place et juste **passer du block-style au next-line-style** sur la ligne précise du `setState` async — plus chirurgical, garde l'invariant linter sur les autres setStates futurs.

### Critères de succès

- Le block `/* eslint-disable react-hooks/set-state-in-effect ... */ ... /* eslint-enable */` dans [contexts/AuthContext.tsx](contexts/AuthContext.tsx) disparaît (option pleine refactor) **ou** est remplacé par un `// eslint-disable-next-line react-hooks/set-state-in-effect -- <raison>` ciblé sur la ligne précise (option chirurgicale).
- `pnpm lint:check` exit 0.
- Compteur disables `set-state-in-effect` : 1 → 0 (ou 1 → 1 si option chirurgicale).
- `pnpm typecheck` + `pnpm test:run` + `pnpm build` exit 0.
- Smoke browser : login / logout / refresh page sur `/dashboard` → comportement inchangé. Le polling refresh + auth-check tourne après login (vérifier dans le Network panel, requêtes périodiques sur `/api/auth/session`).

---

## Découpage commits proposé

1. `refactor(useGroups): invalidate financial views on join/leave/delete` (+ profile si Phase 1 confirme).
2. `refactor(auth-context): split into outer Provider + inner stateful Provider` (option pleine) **OU** `refactor(auth-context): scope set-state-in-effect disable to the async setState` (option chirurgicale).
3. `docs(claude): closeout Sprint 2-followup-v2`.

---

## Hors scope

- **Helper extension** (`invalidateFinancialRefreshes(qc, options?: { extra?: QueryKey[] })`) — speculative, low-priority. Le repo n'a aucune raison aujourd'hui d'invalider plus de 3 keys cross-domain. Si Phase 1 du Gap 1 conclut que `['profile']` doit être invalidé, on peut l'inliner dans les 3 mutations concernées de `useGroups` (3 lignes en plus) plutôt que créer un helper élargi.
- **Console.log cleanup général** — chantier dédié [prompt/prompt-07-deep-dive-console-log-cleanup.md](prompt/prompt-07-deep-dive-console-log-cleanup.md), pas la peine de scope-creep ici.
- **Sprint Tailwind-v4** / **Sprint Supabase-Strict-Types** — sprints séparés roadmappés CLAUDE.md §11.

---

## Phase 0 — Pré-flight

- `pnpm verify` exit 0 attendu.
- `git log --oneline -5` doit montrer Sprint 2-followup closeout (`9788567 docs(claude): closeout Sprint 2-followup`).
- `grep -rn "function invalidateFinancialRefreshes" hooks/` retourne 0 hits (post-Sprint 2-followup, le helper est dans `lib/query-client.ts`).
- `grep -rn "invalidateFinancialRefreshes" hooks/useGroups.ts` retourne 0 hits — confirme le gap.

---

## Phase 1 — Inventaire (obligatoire pour Gap 1, recommandé pour Gap 2)

Lancer 1 Explore agent (ou 2 Greps directs) pour confirmer côté serveur :

1. **`POST /api/groups/[id]/members`** (join) : que set-il ? `profile.group_id`, `group_contributions`, ou les deux ? Vérifier aussi le trigger `trigger_recalculate_contributions` qui auto-create un `group_contributions` row sur join.
2. **`DELETE /api/groups/[id]/members`** (leave) : que set-il ? Probablement `profile.group_id = NULL` + DELETE du `group_contributions`. Cascade `cleanup_group_contributions` ?
3. **`DELETE /api/groups/[id]`** (deleteGroup) : que set-il ? Tous les membres récupèrent `group_id = NULL` ?
4. **`POST /api/groups`** (createGroup) : le créateur est-il automatiquement membre ? Si oui, son `group_id` change → invalidation requise.
5. **`PUT /api/groups/[id]`** (updateGroup) : quelles colonnes sont touchées ? Si juste le nom/description, pas d'invalidation financière requise.

Pour Gap 2 — auditer les consumers de `useAuthUser()` / `useAuthActions()` / `useAuth()` (5 pages : `app/page.tsx`, `app/dashboard/page.tsx`, `app/group-dashboard/page.tsx`, `app/settings/page.tsx`, `app/connexion/page.tsx` et toutes les pages qui passent par les wrappers `useRequireAuth` / `useRequireGuest`). Confirmer qu'aucun n'attend explicitement un `useAuth()` toujours-monté pendant le loading.

---

## Verification end-to-end

Standard sweep (cf. CLAUDE.md §3) :

- `pnpm typecheck` exit 0.
- `pnpm lint:check` exit 0 — compteur warnings stable ou décroissant (pas d'augmentation).
- `pnpm test:run` exit 0 — 5 passed / 33 skipped (inchangé), ou +1 si test ajouté.
- `pnpm format:check` exit 0.
- `pnpm build` exit 0 (56/56 routes).
- `pnpm verify` exit 0.
- `pnpm run ci` exit 0.
- **Smoke browser** : flow join + leave d'un groupe (test d'E2E manuel par user — pas automatisé).
- **Smoke browser AuthContext** : login / logout / page refresh + monitoring du polling refresh (requêtes périodiques `/api/auth/session` toutes les 50min, `/api/auth/session` validation toutes les 5min).

---

## Score attendu

~96.5/100 → ~97/100. Cleanup chirurgical de 2 gaps réels (correctness + lint hygiene).

---

## Liens

- Sprint 2-followup prompt : [prompt-04-tooling-dx-v4.md](prompt-04-tooling-dx-v4.md)
- Sprint 2-followup plan : `C:\Users\gille\.claude\plans\prompt-sprint-zippy-glacier.md`
- ProfileSettingsCard split (pattern référence) : commit `f3913d0 refactor(profile): split ProfileSettingsCard for stable form init` + Sprint 2 closeout `c8094ab`
- TanStack Query — Invalidations from Mutations : https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
