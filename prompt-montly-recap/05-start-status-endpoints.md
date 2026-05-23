# [05] — Endpoints START + STATUS + proxy re-wiring

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, processus mensuel obligatoire, lock groupe par initiateur.
- Position dans la séquence : étape 05/17
- Dépend de : 03 (state lib), 04 (calculations)
- Débloque : 06 (positive endpoints), 07 (negative), 08 (salary+finalize), 10 (UI shell utilise status)

## Objectif
Créer deux endpoints serveur : `POST /api/monthly-recap/start` (claim lock atomic + create row monthly_recaps + return summary) et `GET /api/monthly-recap/status` (return current state + summary à chaque rafraîchissement UI). Re-wirer `proxy.ts` pour rediriger sur `/monthly-recap` quand statut requiert action (no_recap OU in_progress OU locked_by_other).

## Fichiers concernés
- `app/api/monthly-recap/start/route.ts` — à créer
- `app/api/monthly-recap/status/route.ts` — à créer
- `lib/recap/load-summary.ts` — à créer (helper async pour build le RecapSummary depuis Supabase, à utiliser par les 2 endpoints + d'autres dans 06/07)
- `proxy.ts` — à modifier (réintroduire le gating recap, supprimé en 01)
- `lib/api/with-auth.ts` — à LIRE (wrapper auth déjà existant)
- `lib/api/parse-body.ts` — à LIRE (Zod parsing)
- `lib/finance/financial-data.ts` — à LIRE (getProfileFinancialData / getGroupFinancialData pour le summary)

## Patterns et conventions à respecter
- **Wrapper `withAuth` / `withAuthAndProfile`** : cf. [lib/api/with-auth.ts](../lib/api/with-auth.ts). Tous les endpoints recap utilisent `withAuthAndProfile` (besoin de `profile.id`, `profile.group_id`).
- **`parseBody(request, schema)` + `handleBadRequest(error)` au top du catch** : cf. [.claude/conventions/zod-patterns.md](../.claude/conventions/zod-patterns.md) §2. Pour query params, `parseQuery(request.nextUrl.searchParams, schema)`.
- **Format réponse uniforme** : `{ data: T } | { error: string }`. 401 si session invalide (géré par withAuth). 400 si Zod fail. 500 sinon.
- **PostgREST UPSERT pour claim-lock atomique** : `.upsert({ profile_id, recap_month, recap_year, started_by_profile_id, started_at, current_step: 'summary' }, { onConflict, ignoreDuplicates: false })`. Si la row existe déjà avec `started_by_profile_id` différent et `completed_at IS NULL` → retourner 409 avec body { error: 'locked_by_other', startedBy: ... }.
- **Mais l'UPSERT classique va OVERWRITE le started_by** si on n'est pas l'initiateur — c'est mauvais. Utiliser plutôt **INSERT...ON CONFLICT DO NOTHING + SELECT** pour atomicité, ou créer un RPC dédié `start_monthly_recap(p_profile_id, p_group_id, p_month, p_year, p_started_by)` qui gère les 3 cas (insert / already-started-by-self / locked-by-other).
- **Recommandation** : créer un RPC `start_monthly_recap` PL/pgSQL pour atomicité. Voir migration ci-dessous.

## Détail des modules

### Nouveau RPC `start_monthly_recap`

À ajouter dans une migration `supabase/migrations/<TS>_create_recap_start_rpc.sql` :

```sql
CREATE OR REPLACE FUNCTION start_monthly_recap(
  p_profile_id uuid,            -- exactement 1 non-null
  p_group_id uuid,
  p_month smallint,
  p_year smallint,
  p_started_by_profile_id uuid  -- toujours user.id
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recap monthly_recaps%ROWTYPE;
BEGIN
  -- Try insert (returns the row if successful)
  INSERT INTO monthly_recaps (profile_id, group_id, recap_month, recap_year, current_step, started_by_profile_id, started_at)
  VALUES (p_profile_id, p_group_id, p_month, p_year, 'summary', p_started_by_profile_id, now())
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_recap;

  IF v_recap.id IS NOT NULL THEN
    RETURN json_build_object('result', 'created', 'recap', row_to_json(v_recap));
  END IF;

  -- Row déjà existante : la lire et discriminer
  SELECT * INTO v_recap FROM monthly_recaps
    WHERE (p_profile_id IS NOT NULL AND profile_id = p_profile_id AND recap_month = p_month AND recap_year = p_year)
       OR (p_group_id IS NOT NULL AND group_id = p_group_id AND recap_month = p_month AND recap_year = p_year);

  IF v_recap.completed_at IS NOT NULL THEN
    RETURN json_build_object('result', 'completed', 'recap', row_to_json(v_recap));
  END IF;

  IF v_recap.started_by_profile_id = p_started_by_profile_id THEN
    -- C'est l'initiateur qui revient : OK
    RETURN json_build_object('result', 'resumed', 'recap', row_to_json(v_recap));
  END IF;

  -- Locked by another user
  RETURN json_build_object('result', 'locked_by_other', 'recap', row_to_json(v_recap));
END;
$$;

REVOKE ALL ON FUNCTION start_monthly_recap FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_monthly_recap TO service_role;

NOTIFY pgrst, 'reload schema';
```

Ajouter `'start_monthly_recap'` à `EXPECTED_RPCS` dans [scripts/check-rpcs.mjs](../scripts/check-rpcs.mjs) (passe de 13 à 14).

### `lib/recap/load-summary.ts`

```ts
import { supabaseServer } from '@/lib/supabase-server'
import { getProfileFinancialData, getGroupFinancialData } from '@/lib/finance'
import { computeRecapSummary } from './calculations'
import type { RecapSummary } from './types'
import type { RecapContext } from './check-status'

export async function loadRecapSummary(input: { context: RecapContext, profileId: string, groupId: string | null }): Promise<RecapSummary> {
  // 1. Determine contextFilter
  // 2. Fetch financial data (getProfile/GroupFinancialData)
  // 3. Fetch budgets (estimated_budgets where context matches) + each budget's spent (sum real_expenses where applied_to_balance_at IS NOT NULL AND is_carried_over = false AND budget_id = X AND month matches)
  // 4. Fetch piggy_bank.amount
  // 5. Fetch bank_balances.balance
  // 6. Call computeRecapSummary(...)
}
```

### `app/api/monthly-recap/start/route.ts`

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = await parseBody(request, startRecapBodySchema)
    const contextId = context === 'profile' ? profile.id : profile.group_id
    if (context === 'group' && !contextId) return NextResponse.json({ error: "Pas de groupe" }, { status: 400 })

    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const { data, error } = await supabaseServer.rpc('start_monthly_recap', {
      p_profile_id: context === 'profile' ? profile.id : null,
      p_group_id: context === 'group' ? profile.group_id : null,
      p_month: month, p_year: year, p_started_by_profile_id: userId,
    })
    if (error) { logger.error('[recap/start] RPC failed', error); return NextResponse.json({ error: 'Erreur claim lock' }, { status: 500 }) }

    const { result, recap } = data as { result: 'created'|'resumed'|'completed'|'locked_by_other', recap: any }
    if (result === 'locked_by_other') return NextResponse.json({ error: 'locked_by_other', startedBy: recap.started_by_profile_id }, { status: 409 })
    if (result === 'completed') return NextResponse.json({ error: 'already_completed' }, { status: 410 })

    // Created or resumed : load summary
    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    return NextResponse.json({ data: { recap, summary } })
  } catch (e) {
    const handled = handleBadRequest(e); if (handled) return handled
    logger.error('[recap/start] failed', e); return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

### `app/api/monthly-recap/status/route.ts`

```ts
export const GET = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = parseQuery(request.nextUrl.searchParams, statusQuerySchema)
    const status = await checkRecapStatus(userId, context)
    if (status.status.kind === 'no_recap' || status.status.kind === 'locked_by_other') {
      return NextResponse.json({ data: { status: status.status, summary: null } })
    }
    if (status.status.kind === 'completed') {
      return NextResponse.json({ data: { status: status.status, summary: null } })
    }
    // in_progress : load summary
    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    return NextResponse.json({ data: { status: status.status, summary } })
  } catch (e) {
    if (e instanceof RecapStatusError) { ... }
    logger.error('[recap/status] failed', e); return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

### `proxy.ts` rewiring

Re-add les 2 blocs supprimés en 01 mais adaptés au nouveau `RecapStatusKind` :

```ts
// Block re-entry si completed (idem qu'avant)
if (isSpecialRoute && session?.userId) {
  const queryContext = ... // 'group' ou 'profile'
  const status = await checkRecapStatus(session.userId, queryContext)
  if (status.status.kind === 'completed') return NextResponse.redirect(...)
  // 'locked_by_other' on group : LAISSER passer pour afficher l'écran lock
  // 'no_recap', 'in_progress', 'locked_by_other' : laisser passer
}

// Redirect protected → /monthly-recap si requis
if (isProtectedRoute && session?.userId && !isSpecialRoute) {
  // Idem qu'avant : cookie cache 5min
  const status = await checkRecapStatus(session.userId, context)
  if (isRecapBlocking(status.status)) {
    return NextResponse.redirect(new URL(`/monthly-recap?context=${context}`, req.url))
  }
  // pose cookie cache si status.kind === 'completed'
}
```

## Étapes d'implémentation suggérées
1. **Créer la migration RPC** `start_monthly_recap` + appliquer + repair + re-export baseline + audit (`pnpm db:audit-functions`).
2. **Ajouter à `EXPECTED_RPCS`** dans `scripts/check-rpcs.mjs` (13 → 14).
3. **Mettre à jour CLAUDE.md §5.5** : `EXPECTED_RPCS` 13 → 14.
4. **Créer `lib/recap/load-summary.ts`** : fonction `loadRecapSummary` qui agrège financial data + budgets + piggy + bank, appelle `computeRecapSummary`.
5. **Créer `app/api/monthly-recap/start/route.ts`** : POST handler avec withAuthAndProfile + parseBody + RPC call + dispatch sur result.
6. **Créer `app/api/monthly-recap/status/route.ts`** : GET handler avec withAuthAndProfile + parseQuery + checkRecapStatus + summary conditionnel.
7. **Re-wire `proxy.ts`** : ré-importer `checkRecapStatus`, `isRecapBlocking` ; ré-ajouter les 2 blocs gating ; tester via dev.
8. **Tests gated `SUPABASE_RECAP_TESTS=1`** : start crée la row, resume si même user, locked_by_other si autre groupe member.
9. **Tests intégration status** : 4 cas (no_recap, in_progress, completed, locked_by_other).
10. **Smoke test manuel** : `pnpm dev` + login + naviguer à `/dashboard` → doit rediriger sur `/monthly-recap?context=profile` car no_recap.
11. **Commit** : `feat(recap): start + status endpoints + RPC start_monthly_recap + proxy gating`.

## Critères d'acceptation
- [ ] RPC `start_monthly_recap` créé, audité (`pnpm db:audit-functions` exit 0)
- [ ] `EXPECTED_RPCS = 14` dans `scripts/check-rpcs.mjs`, `pnpm db:check-rpcs` exit 0
- [ ] CLAUDE.md §5.5 mis à jour (EXPECTED_RPCS 13 → 14)
- [ ] `lib/recap/load-summary.ts` exporte `loadRecapSummary` async pure-server
- [ ] `app/api/monthly-recap/start/route.ts` POST avec status codes 200/400/409/410/500 corrects
- [ ] `app/api/monthly-recap/status/route.ts` GET avec body data conforme
- [ ] `proxy.ts` redirige correctement : protected → /monthly-recap si no_recap OR in_progress OR locked_by_other
- [ ] `proxy.ts` laisse passer si completed (et cache cookie 5min comme avant)
- [ ] Tests gated start (4+ cas) + status (4 cas) passants
- [ ] Smoke test manuel : workflow login → dashboard → redirect → POST start → page recap charge
- [ ] `pnpm typecheck` + `pnpm lint:check` + `pnpm verify` exit 0

## Tests à écrire

### `app/api/monthly-recap/start/__tests__/route.integration.test.ts` (gated SUPABASE_RECAP_TESTS=1)
- POST context=profile, no row existante → 200 + result='created', monthly_recaps row créée avec started_by=user.id
- POST profile, row in_progress same user → 200 + result='resumed', no change started_at
- POST group context, no row → 200 + result='created' avec group_id set
- POST group context, row started_by autre membre → 409 + body { error: 'locked_by_other', startedBy: ... }
- POST profile, row completed → 410 + body { error: 'already_completed' }
- POST context=group sans group_id → 400 + body { error: 'Pas de groupe' }
- POST sans session → 401 (géré par withAuthAndProfile)

### `app/api/monthly-recap/status/__tests__/route.integration.test.ts` (gated)
- GET sans row → kind='no_recap', summary=null
- GET avec row in_progress same user → kind='in_progress', summary populated
- GET avec row completed → kind='completed', summary=null
- GET group lock par autre → kind='locked_by_other', summary=null
- GET sans session → 401
- GET context=group sans group_id → erreur explicite

### Tests proxy (smoke manuel ou e2e Playwright si dispo)
- Navigation `/dashboard` sans row recap → redirect `/monthly-recap?context=profile`
- Navigation `/group-dashboard` quand groupe locked par autre → redirect `/monthly-recap?context=group` (l'UI affichera le lock screen)
- Navigation `/dashboard` quand recap completed → cookie posé, accès OK

## Pièges et points d'attention
- **RPC atomicity** : `INSERT ... ON CONFLICT DO NOTHING RETURNING *` retourne NULL si conflict. Vérifier avec `IF v_recap.id IS NOT NULL` plutôt que `IF FOUND` (subtilité PG).
- **Race condition** : 2 membres de groupe cliquent "Commencer" simultanément → 1 seul gagne (la transaction atomique). L'autre reçoit `result='locked_by_other'`. Aucun lock manuel nécessaire grâce à l'UPSERT atomique.
- **Status endpoint vs proxy** : le proxy déjà appelle `checkRecapStatus` à chaque navigation protégée. L'endpoint /status est utilisé par le front-end pour résume + polling. Les deux partagent le même `checkRecapStatus` lib.
- **Format des erreurs 409** : utiliser `{ error: 'locked_by_other', startedBy: profileId }` plutôt qu'un message texte — le front-end peut discriminer côté UI sans parsing string.
- **Cookie cache 5min du proxy** : ne PAS poser le cookie si status.kind != 'completed'. Sinon le user reste bloqué dans /monthly-recap. Pattern existant (cf. ancien proxy.ts ligne 113-128).
- **Pas de wrapper `blockInProduction()`** : ces routes ne sont PAS debug. Auth via withAuthAndProfile suffit.
- **Mid-flow re-entry** : si user F5 sur l'écran 3, status retourne kind='in_progress' + summary recomputed. Le front-end route alors sur l'écran 3 via `current_step`. Garanti par la state machine forward-only de step 03.
- **`loadRecapSummary` perf** : agrégat de plusieurs SELECT. Faire EN PARALLÈLE via Promise.all (financial-data + budgets + piggy + bank).
- **Spent par budget** : la spec dit "real expenses applied non-carried-over". Filtrer `applied_to_balance_at IS NOT NULL AND is_carried_over = false AND budget_id = X` — vérifier la sémantique du dashboard pour rester cohérent.

## Commandes utiles
```bash
# Migration RPC
node scripts/apply-sql.mjs supabase/migrations/<TS>_create_recap_start_rpc.sql
pnpm supabase migration repair --status applied <TS>
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:audit-functions

# Tests
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/start app/api/monthly-recap/status

# Smoke manuel
pnpm dev
# puis dans le browser : login → /dashboard (doit redirect /monthly-recap?context=profile)
```

## Definition of Done
- Tous les critères d'acceptation cochés
- RPC `start_monthly_recap` audited (présent dans pg_proc avec body verbatim)
- `EXPECTED_RPCS` à 14
- 8+ cas de test gated passants
- Smoke manuel ok : login → redirect /monthly-recap (et le proxy bloque /dashboard tant que row recap incomplete)
- Commit `feat(recap): start + status endpoints + RPC start_monthly_recap + proxy gating`
- `pnpm verify` exit 0
