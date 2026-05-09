# Prompt — Sprint Refactor-Architecture v5 (withAuth hardening)

## Contexte

Le Sprint Refactor-Architecture-v3 (livré 2026-05-08) a introduit `withAuth` / `withAuthAndProfile` dans [lib/api/with-auth.ts](../lib/api/with-auth.ts). Le Sprint v4 (livré 2026-05-08, 7 commits `b16cca3 → e680514`) a étendu le pattern aux 21 routes hors finance — soit **33 modules** au total qui passent maintenant par ce wrapper (12 finance + 21 Volet C). Le wrapper est donc devenu le boundary auth canonique du repo.

Ce sprint v5 traite trois gaps concrets surfacés pendant v4 mais hors scope :

1. **Aucun test unitaire pour `lib/api/with-auth.ts`** alors que 33 modules en dépendent.
2. **Pas de JSDoc** sur les helpers — les nouveaux contributeurs doivent lire 5 routes pour comprendre les patterns (always-fetch / conditional-fetch / dynamic).
3. **Code smell `routeContext!.params`** : la non-null assertion apparaît dans les 5 handlers dynamiques (`groups/[id]` PUT/DELETE, `groups/[id]/members` GET/POST/DELETE) parce que la signature actuelle rend `routeContext` optionnel pour cohabiter avec les routes statiques. Une signature mieux typée éliminerait l'assertion.

Optionnel selon arbitrage Phase 3 :

4. **Migrer `app/api/monthly-recap/process-step1/route.ts` auth-only** vers `withAuthAndProfile`. La god route est exclue de l'extraction métier (chantier I5), mais sa **boilerplate auth + profile** (les 50 premières lignes du POST) est mécaniquement identique à celles déjà migrées. v4 a wrapped `complete` (qui a 4 globals), `recover` (qui a la dispatch v1/v2), et `balance` (qui a un `setTimeout(500)`) — le rationale pour exclure process-step1 _juste sur l'auth_ est faible. Reste séparé de I5 qui s'occupera d'extraire la logique métier.

## Pré-requis

1. v4 stable depuis ≥ 1 sprint d'observation prod (vérifier `git log --since='2026-05-09' --oneline cleanup` pour absence de revert sur les commits `b16cca3 → e680514`).
2. `pnpm verify` exit 0 (cf. CLAUDE.md §3).
3. `pnpm dev` smoke browser : login → dashboard → recap workflow → groupes → savings — aucun 401 spurious lié à v4.

## Périmètre — Item 1 : Test coverage pour `lib/api/with-auth.ts`

**Fichier à créer** : `lib/api/__tests__/with-auth.test.ts`

**Pattern à mirror** : [lib/finance/__tests__/rpc-concurrency.test.ts](../lib/finance/__tests__/rpc-concurrency.test.ts) — dynamic-import dans `beforeAll` pour ne pas charger `lib/supabase-server.ts` au module-eval, cleanup cascade dans `afterAll`. Cf. CLAUDE.md §9.

**Cas à couvrir** (ordre de priorité décroissante) :

### `withAuth(handler)` — auth seule
- ✅ Cookie session valide → handler appelé avec `{ userId }` correct, response du handler retournée telle quelle.
- ✅ Pas de cookie → 401 + `{ error: 'Session invalide' }`.
- ✅ Cookie présent mais JWT invalide (mauvaise signature, expiré) → 401 + `{ error: 'Session invalide' }`.
- ✅ Cookie présent, JWT valide, mais `userId` absent du payload → 401 + `{ error: 'Session invalide' }`.

### `withAuthAndProfile(handler)` — auth + profile
- ✅ Cookie valide + profil existant → handler appelé avec `{ userId, profile }`, profile shape `{ id, group_id, first_name, last_name }`.
- ✅ Cookie valide + profil absent → 404 + `{ error: 'Profil non trouvé' }` (pas 401).
- ✅ Profile fetch error transitoire (mock supabase error) → 404 (le wrapper conflate `error` et `!profile`).
- ✅ Profile shape complète : vérifier que `first_name` et `last_name` sont projetés (régression-guard contre une révision du select).

### Generic 2nd arg `routeContext`
- ✅ Static route (handler sans 3e arg) → wrapper ne crashe pas si `routeContext` n'est pas passé.
- ✅ Dynamic route (handler avec `routeContext`) → params flow-through correct, `await routeContext.params` retourne le shape attendu.
- ✅ `withAuthAndProfile<{ id: string }>` → typage générique fonctionne (test compile-time via `expectTypeOf` ou similaire).

### Edge cases
- ✅ Le wrapper ne capture pas les erreurs du handler (vérifier qu'une erreur thrown dans le handler n'est PAS interceptée — c'est volontaire pour préserver les `try/catch` route-aware).
- ✅ Multiple invocations en parallèle ne croisent pas leurs contexts (closure isolation).

**Fixture** : créer un `auth.users` réel via `supabase.auth.admin.createUser`, signer un JWT via `jose` avec le `JWT_SECRET_KEY`, construire un `NextRequest` Mock avec le cookie. Cleanup cascade dans `afterAll`.

**Gating** : pas de gate. Le wrapper teste les 4 cas auth de base sans toucher de DB réelle (mock le `supabaseServer.from('profiles').select(...).single()` via `vi.spyOn`). Seul le test "profile shape complète" peut nécessiter un fixture `auth.users` réel — le marquer `describe.skipIf(!process.env.SUPABASE_API_TESTS)` si gated.

**LOC estimé** : 200-300 LOC.

## Périmètre — Item 2 : JSDoc sur `lib/api/with-auth.ts`

Ajouter au-dessus de chaque export un bloc JSDoc avec :
- Description courte (1 ligne).
- `@example` typé montrant les 3 patterns canoniques (always-fetch, conditional-fetch lazy, dynamic route).
- `@param` documenté pour le handler signature.
- `@returns` pour le wrapper signature.

**Cible attendue** :

```ts
/**
 * Wraps a route handler with session validation. Calls the handler with `{ userId }` if the session is valid; returns 401 + `{ error: 'Session invalide' }` otherwise.
 *
 * Use for **auth-only handlers** that don't need profile data (e.g. profile POST/PUT,
 * groups [id] PUT/DELETE) OR for **conditional-fetch handlers** that lazy-load the profile
 * inside the body when `forGroup` / `context==='group'` (matches the pattern of finance
 * `expenses-real`, `expenses-add-with-logic`, etc.).
 *
 * @param handler - The async route handler. Receives `(request, { userId }, routeContext?)`.
 *   `routeContext` is only present on Next.js dynamic routes.
 * @returns A Next.js route handler.
 *
 * @example Static route
 * export const POST = withAuth(async (request, { userId }) => {
 *   const body = await request.json()
 *   return NextResponse.json({ data: ... })
 * })
 *
 * @example Dynamic route
 * interface RouteParams { id: string }
 * export const DELETE = withAuth<RouteParams>(async (request, { userId }, routeContext) => {
 *   const { id } = await routeContext!.params
 *   return NextResponse.json({ deleted: id })
 * })
 */
export function withAuth<TParams = ...>(...) { ... }
```

Idem pour `withAuthAndProfile` (mentionner que le `select` est `'id, group_id, first_name, last_name'`, et que le 404 se déclenche sur `error` OU `!profile`).

**LOC estimé** : +30 lignes (un bloc par helper, plus 2-3 lignes sur les types exportés).

## Périmètre — Item 3 : Refiner la signature dynamic-route

**Problème actuel** :

```ts
export const DELETE = withAuth<RouteParams>(async (_request, { userId }, routeContext) => {
  const { id } = await routeContext!.params  // ← non-null assertion
})
```

Le `!` est nécessaire parce que `routeContext` est typé `RouteContext<TParams> | undefined` pour permettre l'omission sur les routes statiques.

**Options à arbitrer Phase 3** :

**Option A** : Surcharge de fonction (overloads) — typer 2 cas :
```ts
export function withAuth(
  handler: (request: NextRequest, ctx: AuthedContext) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse>
export function withAuth<TParams>(
  handler: (request: NextRequest, ctx: AuthedContext, routeContext: RouteContext<TParams>) => Promise<NextResponse>
): (request: NextRequest, routeContext: RouteContext<TParams>) => Promise<NextResponse>
```

Avantage : `routeContext` devient non-optionnel quand `TParams` est fourni → plus de `!`. Inconvénient : 2 surcharges au lieu d'1 generic, doc plus dense.

**Option B** : Helper séparé `withAuthDynamic<TParams>` / `withAuthAndProfileDynamic<TParams>` — 4 helpers au total.

Avantage : sémantique claire au call site. Inconvénient : duplication ~30 LOC entre les 4 helpers.

**Option C** : Garder l'état actuel — le `!` est acceptable, documenter via JSDoc qu'il est safe parce que Next.js garantit le 2e arg sur les dynamic routes.

**Recommandation Phase 1** : Option A. Surcharges TypeScript = zéro runtime cost, élimine le `!`, et la lecture au call site reste claire.

**Migration des 5 handlers** : si Option A retenue, retirer les 5 `routeContext!.params` → `routeContext.params` dans `groups/[id]/route.ts` (PUT, DELETE) et `groups/[id]/members/route.ts` (GET, POST, DELETE).

## Périmètre — Item 4 (OPTIONNEL) : process-step1 auth-only

**Si retenu Phase 3** : extraire les 50 premières lignes auth du POST de [app/api/monthly-recap/process-step1/route.ts](../app/api/monthly-recap/process-step1/route.ts) vers `withAuthAndProfile`. Le corps métier (>700 LOC) reste intact — c'est le chantier I5 séparé.

**Effort** : trivial (~10 lignes touchées), pattern miroir de `complete/route.ts` (déjà wrapped en v4).

**Risque** : la route a des particularités (cf. CLAUDE.md §5 : "Le cœur algorithmique est dans process-step1/route.ts (>700 LOC) — **ne pas extraire** chantier I5 séparé"). Vérifier qu'aucun snapshot/global/setTimeout n'est touché par le wrapping.

## Décisions à arbitrer Phase 3 (AskUserQuestion)

1. **Item 3 — signature dynamic-route** : Option A (overloads, élimine `!`) / Option B (4 helpers séparés) / Option C (statu quo).
2. **Item 4 — process-step1 auth-only** : inclus ou skipped ?
3. **Item 1 — fixture style** : `vi.spyOn` mock du supabase client (rapide, pas de DB) OU fixture `auth.users` réel (cohérence avec `rpc-concurrency.test.ts`) ?

## Critères de validation

1. `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` + `pnpm build` exit 0 après chaque commit.
2. `pnpm test:run` montre N tests verts pour `lib/api/__tests__/with-auth.test.ts` (où N ≈ 12-15).
3. Si Item 3 Option A : `rg "routeContext!" app/api/groups/` → 0 lignes.
4. Si Item 4 retenu : `rg "validateSessionToken" app/api/monthly-recap/process-step1/` → 0 lignes.
5. JSDoc visible dans VS Code IntelliSense au survol de `withAuth(...)`.

## Découpage en commits suggéré

1. `test(api): add unit tests for withAuth and withAuthAndProfile` — Item 1.
2. `docs(api): add JSDoc to withAuth helpers` — Item 2.
3. (si Option A) `refactor(api): use overloads for dynamic-route withAuth signature` + `refactor(api): drop routeContext! assertions in groups/**` — Item 3.
4. (si Item 4 retenu) `refactor(api): migrate process-step1 auth boilerplate to withAuthAndProfile` — Item 4.
5. `docs: closeout Sprint Refactor-Architecture-v5`.

## Hors scope

- **Migrer `/api/debug/**` et `/api/auth/**`** — décisions arbitrées en v4 Phase 3, inchangées.
- **Logger les 401/404 du wrapper** (telemetry) — chantier observabilité séparé.
- **Refactorer le god body de `process-step1`** — chantier I5 séparé. v5 Item 4 ne touche que les 50 premières lignes auth.
- **Audit des consumers client-side pour les changements de message d'erreur** (`'Profil utilisateur non trouvé'` → `'Profil non trouvé'`) — pas vu de regression en prod après v3+v4, mais à garder en tête si une page UI casse.

## Notes pour Claude Code

- **Lire en premier** : [CLAUDE.md](../CLAUDE.md) §11 (closeout v4), [lib/api/with-auth.ts](../lib/api/with-auth.ts), un handler always-fetch ([lib/api/finance/budgets-estimated.ts](../lib/api/finance/budgets-estimated.ts)) et un dynamic ([app/api/groups/[id]/route.ts](../app/api/groups/[id]/route.ts)).
- **Phase 1 obligatoire** : Explore agent pour confirmer qu'aucun test n'existe déjà sur le wrapper, et pour scanner les 5 dynamic-route callsites avant Item 3.
- **Pattern leçon Sprint v4** : ne pas créer de helper supplémentaire sans validation user (Phase 3). Préférer extension des helpers existants quand le ratio cas/code reste favorable.

LOC delta estimé : **+250 à +350 LOC** (tests + JSDoc + éventuellement Item 4) — pas de net negative cette fois (couverture vs refactor).
