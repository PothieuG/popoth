# Prompt — Sprint 2-followup-v3 : Server-side DELETE-group cleanup + last `set-state-in-effect` disable

## Contexte

Sprint 2-followup-v2 (livré 2026-05-10, plan dans `C:\Users\gille\.claude\plans\prompt-sprint-mossy-donut.md`, commits `3af2920..6999858`) a fermé deux gaps :

- [hooks/useGroups.ts](../hooks/useGroups.ts) — les 5 mutations invalident désormais `['profile']` + cascade financière (conditionnelle pour `updateGroup`).
- [contexts/AuthContext.tsx](../contexts/AuthContext.tsx) — block disable `react-hooks/set-state-in-effect` autour du `useEffect` remplacé par un single next-line disable sur la ligne `initializeAuth()`.

Au passage, deux items ont été flagués mais explicitement laissés hors scope. Ce sprint les ferme.

---

## Item 1 (priorité haute) — Fix server-side du DELETE group qui ne reset pas `profiles.group_id`

### Le bug

Phase 1 inventory du sprint v2 a surfacé un trou côté serveur :

> `DELETE /api/groups/[id]` cascade `group_contributions` (via le trigger `groups_cleanup_contributions`) **mais ne reset PAS `profiles.group_id` à NULL pour les members**. Tous les members (incluant le deleter) gardent un `group_id` pointant vers un groupe non-existant côté serveur.

Vérifier : [app/api/groups/[id]/route.ts](../app/api/groups/[id]/route.ts) DELETE handler à la ligne 103-145, et la migration capturant le trigger `groups_cleanup_contributions` dans [supabase/migrations/20260512000000_capture_trigger_functions.sql](../supabase/migrations/20260512000000_capture_trigger_functions.sql:148).

Côté client, Sprint 2-followup-v2 a workaround partiellement le bug en invalidant `['profile']` après deleteGroup → le cache local re-fetch et reflète honnêtement le state stale du serveur (qui retourne le `group_id` orphelin). Les consumers (group-dashboard) gate sur `useGroups().currentGroup` plutôt que sur `profile.group_id`, donc l'UX reste correcte. Mais le state DB est techniquement incohérent et peut surprendre tout futur consommateur direct de `profile.group_id` (RLS policies, autres requêtes server-side, audits).

### Décisions à arbitrer Phase 1

#### (a) Trigger BEFORE DELETE vs UPDATE explicite dans le handler

**Option A : trigger BEFORE DELETE sur `groups`**

Pattern miroir de `groups_cleanup_contributions` (qui cascade `group_contributions`) — un nouveau trigger qui null `profiles.group_id` pour tous les members avant le DELETE du group.

Avantages : (i) idiomatique Postgres, (ii) protège tout chemin DELETE (handler app, requête psql ad-hoc, migration future, RLS-bypass server, etc.), (iii) atomique avec le DELETE (transaction implicite).

Inconvénients : (i) ajoute une fonction PL/pgSQL custom à versionner + tester (workflow capture-then-deploy de CLAUDE.md §8), (ii) nécessite `pnpm db:check-functions` à update + `pnpm db:audit-functions` clean, (iii) ajoute 1 ligne au baseline schéma + 1 entrée à `EXPECTED_FUNCTIONS` dans [scripts/check-trigger-functions.mjs](../scripts/check-trigger-functions.mjs).

**Option B : `.update({ group_id: null })` explicite dans le handler avant le `.delete()`**

Patch côté app dans [app/api/groups/[id]/route.ts](../app/api/groups/[id]/route.ts) DELETE handler. Pré-requête `select('id').eq('group_id', groupId)` puis bulk update.

Avantages : (i) zéro changement DB, (ii) visible dans le diff du handler, (iii) facile à reverter.

Inconvénients : (i) ne protège que le chemin handler (un DELETE direct via psql ou migration bypass), (ii) 2 round-trips au lieu de 1, (iii) race possible si un user join le group entre le SELECT et le DELETE (à atténuer par un single UPDATE + DELETE en transaction, ce qui complique le code).

**Recommandation** : Option A (trigger). C'est plus propre et la dette est mineure (workflow capture-then-deploy maîtrisé).

#### (b) Tester le trigger avec un nouveau test gated `SUPABASE_TRIGGER_TESTS=1`

Étendre [lib/**tests**/trigger-behavior.test.ts](../lib/__tests__/trigger-behavior.test.ts) avec un cas : créer 2 users, l'un crée un group, l'autre join, le créateur DELETE le group → vérifier les 2 `profile.group_id` sont null en prod.

#### (c) Mise à jour côté client

Si on choisit Option A : peut-on simplifier `useGroups.deleteGroup.onSuccess` ? Aujourd'hui on fait `invalidateQueries(['profile'])` qui re-fetch et lit (correctement, post-trigger) `group_id: null`. Aucune simplification nécessaire — l'invalidation reste utile pour propager le changement au cache local.

### Workflow d'exécution (CLAUDE.md §8 capture-then-deploy)

1. Écrire la fonction PL/pgSQL `cleanup_group_members_on_delete()` + le trigger `groups_cleanup_members` BEFORE DELETE dans une nouvelle migration `<TS>_add_group_members_cleanup_trigger.sql`.
2. `node scripts/apply-sql.mjs supabase/migrations/<TS>_add_group_members_cleanup_trigger.sql` (HTTP 201 attendu).
3. `pnpm supabase migration repair --status applied <TS>` (sinon prochain `db push` retentera).
4. `node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql` puis `pnpm db:check-drift` → exit 0 attendu.
5. Update `EXPECTED_FUNCTIONS` dans [scripts/check-trigger-functions.mjs](../scripts/check-trigger-functions.mjs) avec le nouveau nom.
6. `pnpm db:audit-functions` → 10 fonctions versionnées (vs 9 actuellement).
7. Test gated : `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` → nouveau cas vert.
8. Smoke browser : créer un group, le delete, observer que le `useGroups().currentGroup` est null + un fetch `/api/profile` retourne `group_id: null`.

### Critères de succès

- Migration `<TS>_add_group_members_cleanup_trigger.sql` ajoutée + appliquée + migration repair fait + baseline ré-exporté.
- `pnpm db:audit-functions` retourne 10/10 versionnées.
- `EXPECTED_FUNCTIONS` mis à jour dans `scripts/check-trigger-functions.mjs`.
- Test gated dans [lib/**tests**/trigger-behavior.test.ts](../lib/__tests__/trigger-behavior.test.ts) couvrant le cas (2 users, JOIN, DELETE group, both profile.group_id NULL).
- Suppression de la mention "out of scope" dans CLAUDE.md §11 (Sprint 2-followup-v2 entry) → remplacer par "fixé en Sprint 2-followup-v3".
- `pnpm verify` exit 0 + `pnpm run ci` exit 0.

---

## Item 2 (priorité moyenne, optionnel) — Migration `useReducer` de AuthContext pour éliminer le dernier `set-state-in-effect` disable

### Contexte

Sprint 2-followup-v2 a narrowed le block disable autour de l'effet à un single next-line disable sur la ligne `initializeAuth()` dans [contexts/AuthContext.tsx](../contexts/AuthContext.tsx). Compteur disables `react-hooks/set-state-in-effect` : **1** (relocalisé, scope minimal).

Pour aller à **0**, il faut convertir les 3 `useState` (user, loading, error) en un seul `useReducer`. La règle ne flag PAS `dispatch` — donc les `dispatch({ type: 'AUTH_RESOLVED', user })` à l'intérieur de `initializeAuth()` ne déclencheraient plus le warning.

### Décisions à arbitrer Phase 1

#### (a) Vérifier que `dispatch` est exempté de la règle `react-hooks/set-state-in-effect`

À tester avant de s'engager : créer un useReducer, l'utiliser dans un useEffect → confirmer que ESLint ne flag pas. Si la règle flag aussi `dispatch` (cas improbable mais possible), ce sprint pivote en no-op (revenir au statu quo, le disable reste à 1).

Test rapide : ajouter un `const [, dispatch] = useReducer((s, a) => s, null)` + `useEffect(() => dispatch({}), [])` dans un fichier dummy, lancer `pnpm lint:check`, observer.

#### (b) Surface du reducer

```ts
type AuthState = {
  user: AuthUser | null
  loading: boolean
  error: string | null
}

type AuthAction =
  | { type: 'INIT_START' }
  | { type: 'AUTH_RESOLVED'; user: AuthUser | null }
  | { type: 'AUTH_ERROR'; message: string | null }
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthUser }
  | { type: 'LOGIN_ERROR'; message: string }
  | { type: 'LOGOUT' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_USER'; user: AuthUser }
```

Le reducer fonctionne pure. Les transitions implicites (loading=false en cas de succès/erreur) sont explicites.

#### (c) Re-render scope

Aujourd'hui `AuthUserContext` value est `{ user, loading, error, isLoggedIn }`. Avec useReducer, `state` est un objet stable entre renders identiques → `userValue` doit être memo'd via `useMemo` pour éviter la nouvelle référence à chaque render. Idem pour `actionsValue`.

### Critères de succès

- 3 `useState` (user, loading, error) → 1 `useReducer`.
- Le next-line disable `react-hooks/set-state-in-effect` sur la ligne `initializeAuth()` retiré (compteur 1 → 0).
- `pnpm lint:check` exit 0, warnings stable.
- `pnpm typecheck` + `pnpm test:run` + `pnpm build` exit 0.
- Smoke browser : login / logout / page refresh → comportement inchangé. Polling refresh + auth-check intervals tournent post-login.

---

## Découpage commits proposé

1. `feat(supabase): add cleanup_group_members_on_delete trigger` — la migration + apply + repair + baseline re-export.
2. `chore(scripts): add cleanup_group_members_on_delete to EXPECTED_FUNCTIONS`.
3. `test(triggers): cover BEFORE DELETE on groups nulls members.group_id` — le nouveau cas dans `trigger-behavior.test.ts`.
4. (si Item 2 retenu) `refactor(auth-context): migrate useState trio to useReducer, remove last set-state-in-effect disable`.
5. `docs(claude): closeout Sprint 2-followup-v3` — update §11 (sortir l'observation, ajouter l'entry), §8 (le pattern trigger BEFORE DELETE).

---

## Hors scope

- **Console.log cleanup général** (1331 occurrences) — chantier dédié [prompt/prompt-07-deep-dive-console-log-cleanup.md](prompt-07-deep-dive-console-log-cleanup.md).
- **Sprint Tailwind-v4** / **Sprint Supabase-Strict-Types** / **Chantiers I4 + I5 + Zod rollout** — sprints séparés roadmappés CLAUDE.md §11.
- **Refactor full outer/inner split de AuthProvider** (option C de v2) — risque trop élevé pour le gain (1 disable). Le useReducer (option A de v2) est l'angle le plus propre.

---

## Phase 0 — Pré-flight

- `pnpm verify` exit 0 attendu.
- `git log --oneline -5` doit montrer Sprint 2-followup-v2 closeout (`6999858 docs(claude): closeout Sprint 2-followup-v2 ...`).
- `pnpm db:audit-functions` exit 0, **9 fonctions versionnées** (post-Sprint Cleanup-Legacy / C1).
- `grep -n "set-state-in-effect" contexts/AuthContext.tsx` retourne 1 hit (la next-line disable sur la ligne `initializeAuth()`).
- Lecture rapide de [supabase/migrations/20260512000000_capture_trigger_functions.sql](../supabase/migrations/20260512000000_capture_trigger_functions.sql:140) (le bloc `groups_cleanup_contributions` qui sert de modèle pour le nouveau trigger).

---

## Phase 1 — Inventaire (obligatoire pour Item 1)

- Confirmer le bug : `node scripts/apply-sql.mjs` avec un `SELECT count(*) FROM profiles WHERE group_id NOT IN (SELECT id FROM groups);` — devrait retourner > 0 si des groups ont été deletés historiquement avec des members orphelins encore en DB. (Si 0, c'est que personne n'a jamais delete un group historiquement — bug latent mais pas observable en prod aujourd'hui.)
- Confirmer Edge-safety : ce trigger ne change rien Edge-side (côté server uniquement).
- Pour Item 2 : confirmer que `useReducer` + `dispatch` n'est pas flag par la règle (test dummy).

---

## Verification end-to-end

Standard sweep :

- `pnpm typecheck` exit 0.
- `pnpm lint:check` exit 0 — warnings stable ou en baisse (Item 2 retire 1 disable mais c'est un commentaire, pas un warning visible).
- `pnpm test:run` exit 0 — 5 passed / 33 skipped (inchangé) ou +1 si `SUPABASE_TRIGGER_TESTS=1` est déjà set localement.
- `pnpm format:check` exit 0.
- `pnpm build` exit 0 (56/56 routes).
- `pnpm verify` exit 0 — `db:check-drift` doit passer après le re-export du baseline ; `db:audit-functions` à 10/10.
- `pnpm run ci` exit 0.
- **Tests gated** : `SUPABASE_TRIGGER_TESTS=1 pnpm test:run` → nouveau cas vert (BEFORE DELETE sur groups nulls members.group_id).
- **Smoke browser** : créer un group, le delete, observer immediate state cleanup côté client + côté serveur.

---

## Score attendu

~97/100 → ~97.5-98/100 (selon Item 2 inclus ou non). Cleanup chirurgical d'un bug DB latent + élimination potentielle du dernier disable.

---

## Liens

- Sprint 2-followup-v2 plan : `C:\Users\gille\.claude\plans\prompt-sprint-mossy-donut.md`
- Sprint 2-followup-v2 closeout : commit `6999858`
- Capture-then-deploy workflow : CLAUDE.md §8
- ProfileSettingsCard split (pattern référence pour reducer-style refactor) : commit `f3913d0`
- React `useReducer` docs : https://react.dev/reference/react/useReducer
