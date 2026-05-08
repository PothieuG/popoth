# Prompt — Sprint Refactor-Architecture v3 (auth boilerplate extraction)

## Contexte

Le Sprint Refactor-Architecture v2 (livré 2026-05-08, commits `0b1e44b → 96a39d7`) a fini le cleanup des routes deprecated et résolu les ambiguïtés v1. Pendant l'exécution de v2, j'ai observé un autre axe d'amélioration **non couvert par la roadmap actuelle** : la duplication massive du pattern auth + profile + ownership-check dans les 12 modules de [`lib/api/finance/`](../lib/api/finance/).

Concrètement : **41 callsites de `validateSessionToken`** dans 12 fichiers (`budgets-estimated.ts: 5`, `budgets.ts: 4`, `expenses-real.ts: 5`, `income-real.ts: 5`, `income-estimated.ts: 5`, `incomes.ts: 5`, `rav.ts: 2`, `summary.ts: 2`, `expenses-add-with-logic.ts: 2`, `expenses-preview-breakdown.ts: 2`, `expenses-progress.ts: 2`, `income-progress.ts: 2`). Chacun reproduit la même ouverture de handler :

```ts
export async function POST(request: NextRequest) {
  try {
    const sessionData = await validateSessionToken(request)
    const userId = sessionData?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    // — fetch profile —
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, group_id')
      .eq('id', userId)
      .single()
    if (!profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }
    // — ownership check via or() —
    let ownershipCondition = `profile_id.eq.${userId}`
    if (profile.group_id) {
      ownershipCondition += `,group_id.eq.${profile.group_id}`
    }
    // ... real work ...
  } catch (error) {
    console.error('Erreur dans POST /api/finance/...:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
```

Les **3 phases** boilerplate (auth → profile → ownership) représentent ~12-15 LOC répétées dans chaque handler, soit ~400-500 LOC de duplication brute. Outre la verbosité, ce pattern :
- introduit des **divergences subtiles** entre handlers (ex: `'Non autorisé'` vs `'Session invalide'` selon les routes — les 2 messages coexistent), inconsistance qui rend l'API moins prévisible côté client.
- **complique les futurs ajouts** (ajouter un log de tentative d'accès non-authentifié = toucher 41 sites)
- **brouille la lecture** des 30+ handlers : 60-80% de chaque fonction est plumbing identique au handler voisin.
- est un **pré-requis utile** au chantier Zod rollout (validation runtime des inputs) — extraire d'abord le auth/profile boilerplate fait ressortir la frontière où Zod doit s'insérer.

## Périmètre — chantier focal

**Volet A — Helper `withAuth(handler)` higher-order function.**

Créer [`lib/api/with-auth.ts`](../lib/api/with-auth.ts) qui exporte un wrapper fonction. Forme proposée :

```ts
import { NextRequest, NextResponse } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

export interface AuthedContext {
  userId: string
  profile: { id: string; group_id: string | null }
}

type AuthedHandler<TArgs = void> = (
  request: NextRequest,
  ctx: AuthedContext,
  args?: TArgs
) => Promise<NextResponse>

export function withAuth<TArgs = void>(handler: AuthedHandler<TArgs>): (request: NextRequest, args?: TArgs) => Promise<NextResponse> {
  return async (request, args) => {
    try {
      const sessionData = await validateSessionToken(request)
      const userId = sessionData?.userId
      if (!userId) {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
      }
      const { data: profile } = await supabaseServer
        .from('profiles')
        .select('id, group_id')
        .eq('id', userId)
        .single()
      if (!profile) {
        return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
      }
      return handler(request, { userId, profile }, args)
    } catch (error) {
      console.error('[withAuth] Erreur non gérée:', error)
      return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
    }
  }
}
```

**Choix techniques à arbitrer Phase 3** :
1. **Profile fetch toujours-on vs opt-in** ? Certains handlers (e.g. `summary.ts`) refetchent le profile via `getProfileFinancialData(userId)` qui le récupère lui-même. Forcer un fetch dans `withAuth` ajoute un round-trip si le handler ne s'en sert pas. **Option** : `withAuth(handler)` → auth seul ; `withAuthAndProfile(handler)` → auth + profile (compose). À décider.
2. **Try/catch global** dans le wrapper vs laissé au handler ? Aujourd'hui chaque handler a son `try/catch`. Centraliser le catch supprime ~5 LOC × 41 sites mais perd le `console.error` route-spécifique. **Option** : laisser le handler logger en path-aware dans son try interne, et le wrapper ne catche qu'en filet ultime. Pattern à confirmer.
3. **Format de réponse erreur** : aujourd'hui `'Non autorisé'` (12 sites) et `'Session invalide'` (CLAUDE.md §6 le documente comme convention) coexistent. **Décision** : harmoniser sur `'Session invalide'` au passage (s'aligner sur la convention §6).
4. **Mock-friendly pour tests** ? Le helper `withAuth` lit `supabaseServer` directement — pour tester le wrapper isolément, il faut un dependency injection ou un mock global. À voir si on en fait un test unitaire séparé ou si on le teste via les API regression tests existants.

**Volet B — Migration des 12 modules `lib/api/finance/*.ts`.**

Pour chaque handler, remplacer le boilerplate par :

```ts
export const POST = withAuth(async (request, { userId, profile }) => {
  // ... real work, use userId and profile.group_id ...
})
```

Le re-export `route.ts` reste inchangé : `export { POST } from '@/lib/api/finance/budgets'`. Le handler typé via `withAuth` reste un `(request: NextRequest) => Promise<NextResponse>` côté Next.js.

**Verif post-migration** :
- `pnpm typecheck` exit 0
- `pnpm lint:check` exit 0
- `pnpm build` exit 0 — tous les paths `/api/finance/**` toujours présents
- `pnpm test:run` (gated `SUPABASE_API_TESTS=1` si possible) — les 6 tests régression doivent rester verts (cumulated_savings round-trip, total_real_*, availableBalance, recover v1/v2/v2-empty)
- Smoke browser : login → dashboard → AddTransactionModal → monthly-recap step1 → équilibrage. Aucun 401/500 inattendu.

**Volet C (optionnel, à arbitrer)** — étendre `withAuth` aux routes hors `/api/finance/*` :
- `app/api/profile/route.ts`
- `app/api/groups/**/route.ts` (5 routes)
- `app/api/savings/**/route.ts` (2 routes)
- `app/api/monthly-recap/**/route.ts` (14 routes — **except** `process-step1` qui reste god route, hors scope)

Le coût marginal est faible une fois `withAuth` en place. À choisir : Volet C dans le même sprint (cohérence) ou différé Sprint v4 (commits plus petits, observation avant généralisation).

## Pré-requis avant exécution

- Aucun. Le sprint est strictement code-side, aucun changement DB/migration.
- Pas de bloqueur dépendances : Zod rollout et console.log cleanup sont **indépendants** et peuvent suivre dans n'importe quel ordre.

## Fichiers à analyser en priorité (Phase 1)

- [`lib/api/finance/budgets.ts`](../lib/api/finance/budgets.ts) (~395 LOC) — 4 handlers POST/PUT/DELETE, **example principal de duplication** (le boilerplate fait 12+ LOC dans chaque, vs ~30 LOC de logique métier)
- [`lib/api/finance/expenses-real.ts`](../lib/api/finance/expenses-real.ts) (~522 LOC) — 5 handlers, plus complexe (filtres temporels)
- [`lib/api/finance/income-real.ts`](../lib/api/finance/income-real.ts) (~473 LOC) — pattern miroir des expenses-real
- [`lib/api/finance/summary.ts`](../lib/api/finance/summary.ts) (~141 LOC) — handler GET unique, **cas où le profile fetch est redondant** avec `getProfileFinancialData` (à confirmer)
- [`lib/session-server.ts`](../lib/session-server.ts) — `validateSessionToken` interface (probablement inchangée)
- [`docs/api/README.md`](../docs/api/README.md) — référence canonique des endpoints à mettre à jour si le format de réponse change

**À ne PAS toucher** :
- `app/api/monthly-recap/process-step1/route.ts` — god route, chantier I5 séparé
- `app/api/debug/**` — bloquées en prod, scope différent (`blockInProduction()` est leur middleware)
- `lib/financial-calculations.ts` — god file, chantier I4 séparé
- `app/api/finance/**/route.ts` — restent des thin re-exports d'1 ligne, pas de logique à toucher

## Contraintes techniques

- **Aucun changement de comportement runtime** observable côté client. Le format `{ data: T } | { error: string }` reste identique. Les status codes restent identiques (401, 404, 500).
- **Harmoniser les messages d'erreur** : tous les `'Non autorisé'` → `'Session invalide'` (s'aligner sur CLAUDE.md §6 convention).
- **Préserver le `console.error` route-spécifique** dans chaque handler (ne pas centraliser tout dans `withAuth`) — utile au debug, et le chantier console.log cleanup les balayera plus tard.
- **TypeScript strict** : pas de `any` introduit, pas de regression sur la rule no-unused-vars (le `request` parameter peut être inutilisé dans certains handlers — utiliser `_` si toléré, sinon `void request`).
- **Pas de Zod dans ce sprint** — c'est le sprint suivant (Chantier Zod rollout).

## Critères de validation

1. `lib/api/with-auth.ts` existe, exporte `withAuth` et `AuthedContext`, ~30 LOC ± 10.
2. Tous les 12 modules `lib/api/finance/*.ts` utilisent `withAuth` au lieu du boilerplate inline.
3. `grep -rn "validateSessionToken" lib/api/finance/` ne retourne plus que **0 ligne** (toutes les invocations sont passées via le helper).
4. `grep -rn "'Non autorisé'" lib/api/finance/` retourne 0 ligne (tous harmonisés sur `'Session invalide'`).
5. `pnpm typecheck` + `pnpm lint:check` + `pnpm test:run` + `pnpm build` exit 0.
6. Le LOC delta est **négatif** (~−300 LOC nets attendus).
7. Le `git log --oneline cleanup` du sprint montre 3-4 commits propres avec Conventional Commits.

## Découpage en commits

1. `refactor(api): introduce withAuth higher-order function for finance handlers`
2. `refactor(api): migrate budgets + budgets-estimated to withAuth`
3. `refactor(api): migrate incomes + income-{real,estimated,progress} to withAuth`
4. `refactor(api): migrate expenses-{real,add-with-logic,preview-breakdown,progress} to withAuth`
5. `refactor(api): migrate summary + rav to withAuth`
6. (optionnel, si Volet C exécuté) `refactor(api): extend withAuth to /api/{profile,groups,savings}/**`
7. `docs: closeout Sprint Refactor-Architecture-v3`

## Verification end-to-end

À la fin (avant closeout) :

1. **Sanity sweep** : `pnpm verify` exit 0 (typecheck + tests + 6 db checks).

2. **Build inspection** : `pnpm build` exit 0, liste de routes `/api/finance/**` identique à celle d'avant le sprint.

3. **Grep négatifs** :
   ```
   grep -rn "validateSessionToken" lib/api/finance/   # → 0 lignes
   grep -rn "Non autorisé" lib/api/finance/           # → 0 lignes
   grep -rn "Profil non trouvé" lib/api/finance/      # → 0 lignes (centralisé dans withAuth)
   ```

4. **Smoke browser** :
   - `pnpm dev` → http://localhost:3000
   - Login → dashboard charge (preuve : useFinancialData via `/api/finance/summary` traverse `withAuth`)
   - AddTransactionModal → ajouter une dépense (preuve : useBudgets POST + useRealExpenses POST traversent `withAuth`)
   - Monthly-recap step1 (preuve : aucune régression sur les routes monthly-recap restées hors `withAuth` ce sprint)
   - DevTools Network tab : 401 sur `/api/finance/summary` quand le cookie est invalide (preuve que `withAuth` rejette correctement) ; 200 sinon.

5. **Tests gated** : `SUPABASE_API_TESTS=1 pnpm test:run` — les 6 régressions H1/H2/R2 + recover v1/v2 doivent rester vertes. Si une casse, c'est probablement le profile fetch redondant dans `summary.ts` qui a divergé.

## Hors scope (à documenter pour suite)

- **Chantier Zod rollout** ([prompts/prompt-07-deep-dive-zod-rollout.md](prompt-07-deep-dive-zod-rollout.md)) — la validation runtime des inputs (body POST/PUT, query strings) est un sprint séparé. `withAuth` lui pose les fondations en libérant le handler du auth boilerplate, mais ne fait pas le travail de Zod.
- **Chantier console.log cleanup** ([prompts/prompt-07-deep-dive-console-log-cleanup.md](prompt-07-deep-dive-console-log-cleanup.md)) — les ~5-10 `console.log` debug par handler restent en place ; ils seront balayés par le chantier dédié.
- **Chantier I4** (financial-calculations.ts) et **I5** (process-step1.ts) restent indépendants.
- **Volet C** (extension du pattern aux autres surfaces) — si non fait dans ce sprint, à scoper Sprint v4.

## Notes pour Claude Code

- **Lire en premier** : `CLAUDE.md` §11 (roadmap) + ce prompt + le commit message de `0b1e44b` (Sprint Refactor-Architecture-v2 Volet A) pour le contexte.
- **Phase 1 obligatoire** : avant de coder, lancer 1-2 Explore agents pour valider :
  (a) que `validateSessionToken` retourne toujours la même shape `{ userId } | null` partout
  (b) que la profile fetch query (`from('profiles').select('id, group_id').eq('id', userId).single()`) est bien identique partout (sans variation cachée style `select('id, group_id, email')`)
  (c) que les ownership-check patterns (`or(profile_id.eq.X,group_id.eq.Y)`) sont bien dans le handler-side, pas dans le boilerplate front (ils restent dans le handler après extraction).
- **Pattern leçon Sprint Refactor-Architecture v1** : si tu trouves une variation surprise au Phase 1 (handler qui ne fait PAS le profile fetch, handler qui retourne `'Session invalide'` au lieu de `'Non autorisé'`, handler qui re-fetche le profile via une RPC), arbitre avec l'utilisateur via `AskUserQuestion` avant de te lancer dans la migration. Préférer un wrapper plus narrow (auth-only sans profile) à un wrapper qui force des fetches inutiles.
