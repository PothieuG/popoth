# [06] — Endpoints flow positif (4.A) : surplus → tirelire / savings

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, écran 3A quand bilan ≥ 0 — l'utilisateur choisit de transférer (ou non) des surplus de budgets vers la tirelire, puis le reste devient des économies cumulées.
- Position dans la séquence : étape 06/17
- Dépend de : 05 (start endpoint, RPC start_monthly_recap)
- Débloque : 11 (UI screen 3A)

## Objectif
Créer deux endpoints qui réutilisent les RPCs atomiques existantes (`transfer_budget_to_piggy_bank` et `update_budget_cumulated_savings`) pour matérialiser les deux actions du flow positif. Maintenir la state machine : après ces actions, `current_step = 'salary_update'`.

## Fichiers concernés
- `app/api/monthly-recap/transfer-surpluses-to-piggy/route.ts` — à créer
- `app/api/monthly-recap/transform-remaining-surpluses-to-savings/route.ts` — à créer
- `lib/recap/actions-positive.ts` — à créer (helpers métier pour les 2 actions)
- `lib/finance/savings.ts` — à LIRE (`transferBudgetToPiggyBank` existant)
- `lib/finance/budget-savings.ts` — à LIRE (`updateBudgetCumulatedSavings` existant)
- `lib/schemas/recap.ts` — déjà étendu en 03 (schémas Zod prêts)
- `lib/recap/load-summary.ts` — à LIRE/RÉUTILISER

## Patterns et conventions à respecter
- **Réutilisation RPC atomiques** : pour chaque transfert budget→piggy, appeler `transferBudgetToPiggyBank(filter, { fromBudgetId, amount })` ([lib/finance/savings.ts](../lib/finance/savings.ts)). Pas de séquence `updateBudget + updatePiggy` séparée (cf. CLAUDE.md ❌ patterns non-atomiques).
- **`withAuthAndProfile` wrapper** + `parseBody` + `handleBadRequest` (cf. 05).
- **State transition** : à la fin de l'action, UPDATE `monthly_recaps SET current_step = X` (où X = 'salary_update' une fois les surplus traités).
- **Validation step courant** : avant d'exécuter, vérifier que `current_step` est compatible (doit être 'manage_bilan' OU 'summary' acceptable, mais pas 'salary_update' ou 'completed'). Retourner 409 si state invalide.
- **Loop pas atomique entre budgets** : un transfert atomic par budget. Si l'un échoue, on log + retourne 500 ; pas de rollback global (les transferts précédents persistent — c'est OK car chaque transfert est self-consistent).
- **Idempotency soft** : si l'utilisateur clique 2× rapidement, le 2e appel re-transférera 0€ pour des budgets sans surplus → no-op safe.

## Détail des endpoints

### `POST /api/monthly-recap/transfer-surpluses-to-piggy`

Body : `{ context: 'profile'|'group', budgetIds: string[] }` (budgetIds sélectionnés via drawer UI).

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context, budgetIds } = await parseBody(request, transferSurplusesBodySchema)

    // 1. Validate recap row exists + user is started_by + step compatible
    const recap = await getActiveRecap({ context, userId, profile })  // helper privé
    if (!recap) return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    if (recap.started_by_profile_id !== userId) return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    if (!['summary', 'manage_bilan'].includes(recap.current_step)) return NextResponse.json({ error: 'invalid_step' }, { status: 409 })

    // 2. Load summary to know surplus per budget
    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    const targetBudgets = summary.budgets.filter(b => budgetIds.includes(b.budgetId) && b.surplus > 0)

    if (targetBudgets.length === 0) return NextResponse.json({ data: { transferred: [] } })

    // 3. Boucle : transferBudgetToPiggyBank pour chaque
    const filter = context === 'profile' ? { profile_id: profile.id } : { group_id: profile.group_id! }
    const transferred: Array<{ budgetId: string, amount: number }> = []
    for (const budget of targetBudgets) {
      try {
        await transferBudgetToPiggyBank(filter, { fromBudgetId: budget.budgetId, amount: budget.surplus })
        transferred.push({ budgetId: budget.budgetId, amount: budget.surplus })
      } catch (e) {
        logger.error('[recap/transfer-surpluses-to-piggy] transfer failed', { budgetId: budget.budgetId, error: e })
        // continue avec les autres budgets — fail-soft loop
      }
    }

    // 4. UPDATE monthly_recaps.current_step si tous les surplus traités (ou si user a explicitly demandé partiel)
    //    NE PAS avancer encore — le user peut revenir cliquer "transform remaining". L'avancement step se fait sur l'autre endpoint.

    // 5. Re-load summary fresh (avec surplus restants après transferts)
    const freshSummary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    return NextResponse.json({ data: { transferred, summary: freshSummary } })
  } catch (e) {
    const handled = handleBadRequest(e); if (handled) return handled
    logger.error('[recap/transfer-surpluses-to-piggy] failed', e); return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

### `POST /api/monthly-recap/transform-remaining-surpluses-to-savings`

Body : `{ context: 'profile'|'group' }` (no budgetIds — transforme TOUS les surplus restants).

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = await parseBody(request, contextOnlyBodySchema)  // un schema simple {context}

    const recap = await getActiveRecap({ context, userId, profile })
    if (!recap) return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    if (recap.started_by_profile_id !== userId) return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    if (!['summary', 'manage_bilan'].includes(recap.current_step)) return NextResponse.json({ error: 'invalid_step' }, { status: 409 })

    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    const surplusBudgets = summary.budgets.filter(b => b.surplus > 0)

    // Transform : updateBudgetCumulatedSavings(budgetId, delta=+surplus) pour chaque
    const transformed: Array<{ budgetId: string, amount: number }> = []
    for (const budget of surplusBudgets) {
      try {
        await updateBudgetCumulatedSavings(budget.budgetId, budget.surplus)
        transformed.push({ budgetId: budget.budgetId, amount: budget.surplus })
      } catch (e) {
        logger.error('[recap/transform-remaining-surpluses] failed', { budgetId: budget.budgetId, error: e })
      }
    }

    // Avancer state → 'salary_update'
    await supabaseServer.from('monthly_recaps').update({ current_step: 'salary_update' }).eq('id', recap.id)

    return NextResponse.json({ data: { transformed, nextStep: 'salary_update' } })
  } catch (e) {
    const handled = handleBadRequest(e); if (handled) return handled
    logger.error('[recap/transform-remaining-surpluses] failed', e); return NextResponse.json({ error: '...' }, { status: 500 })
  }
})
```

### `lib/recap/actions-positive.ts` — helpers

Extraire `getActiveRecap({ context, userId, profile })` pour réutilisation cross-endpoints :

```ts
export async function getActiveRecap(args: { context: RecapContext, userId: string, profile: { id: string, group_id: string | null } }): Promise<MonthlyRecapRow | null> {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const filter = args.context === 'profile' ? { profile_id: args.userId } : { group_id: args.profile.group_id! }
  const { data, error } = await supabaseServer.from('monthly_recaps')
    .select('*')
    .match({ ...filter, recap_month: month, recap_year: year })
    .is('completed_at', null)
    .maybeSingle()
  if (error) { logger.error(...) ; return null }
  return data
}
```

## Étapes d'implémentation suggérées
1. **Créer `lib/recap/actions-positive.ts`** : helper `getActiveRecap` + types associés.
2. **Créer `app/api/monthly-recap/transfer-surpluses-to-piggy/route.ts`** : POST avec withAuthAndProfile + boucle de transfers atomiques.
3. **Créer `app/api/monthly-recap/transform-remaining-surpluses-to-savings/route.ts`** : POST + update cumulated_savings + avance current_step.
4. **Ajouter schema `contextOnlyBodySchema`** dans `lib/schemas/recap.ts` (réutilisable pour les 2 endpoints sans args).
5. **Tests gated `SUPABASE_RECAP_TESTS=1`** : scénarios complets (cf. ci-dessous).
6. **Smoke test manuel** : seed scénario `happy-surplus` (cf. 09 dev tools, OU pour l'instant via Supabase Studio direct), call les 2 endpoints via curl, vérifier piggy.amount + cumulated_savings.
7. **Commit** : `feat(recap): positive flow endpoints (transfer surpluses + transform to savings)`.

## Critères d'acceptation
- [ ] 2 endpoints créés, POST handlers, withAuthAndProfile wrap, parseBody + Zod
- [ ] `lib/recap/actions-positive.ts` exporte `getActiveRecap` + types
- [ ] Endpoint /transfer-surpluses-to-piggy : retourne `{ data: { transferred, summary } }` avec re-load fresh summary
- [ ] Endpoint /transform-remaining-surpluses-to-savings : avance `current_step` à 'salary_update'
- [ ] Validation `started_by_profile_id === userId` (403 sinon)
- [ ] Validation `current_step IN ('summary','manage_bilan')` (409 sinon)
- [ ] Fail-soft loop : un budget qui échoue n'arrête pas la boucle, mais loggé
- [ ] Tests gated ≥10 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0
- [ ] Aucun `as any`, aucun `console.log` (logger.error uniquement)

## Tests à écrire

### `app/api/monthly-recap/transfer-surpluses-to-piggy/__tests__/route.integration.test.ts` (gated)
- Happy : 3 budgets surplus, body budgetIds=[id1,id2,id3] → 3 transferts, piggy.amount += sum(surplus), response transferred.length=3
- Partial : budgetIds=[id1] sur 3 budgets surplus → 1 transfert seulement, les 2 autres surplus restent
- Budget sans surplus dans budgetIds → filter out, no-op pour ce budget
- Recap completed → 409
- Recap absent → 404
- Recap started_by autre user → 403
- Step 'salary_update' → 409 (invalid_step)
- Body vide → 400 (Zod fail)
- Body budgetIds=[] → 400 (Zod min(1))

### `app/api/monthly-recap/transform-remaining-surpluses-to-savings/__tests__/route.integration.test.ts` (gated)
- Happy : 3 surplus, post → cumulated_savings de chaque budget += surplus, current_step='salary_update'
- Aucun surplus restant → 200, transformed=[], current_step avance quand même
- Step 'salary_update' déjà → 409
- Recap absent → 404
- Recap started_by autre user → 403

## Pièges et points d'attention
- **`transferBudgetToPiggyBank` signature** : vérifier dans [lib/finance/savings.ts](../lib/finance/savings.ts) la signature exacte (filter, args). Probablement `{ fromBudgetId, amount }`.
- **`updateBudgetCumulatedSavings` signature** : `updateBudgetCumulatedSavings(budgetId, delta)` retourne le nouveau total. Delta positif pour ajouter.
- **Idempotence non garantie sur double-clic rapide** : si user clique 2× le bouton, 2 requêtes peuvent partir. Le 2ème call relit fresh summary → 0 surplus restant → no-op. **MAIS** entre la lecture summary et le transfert, race possible. Acceptable car les RPCs sont atomiques (UPDATE piggy.amount += X) — au pire on transfère 2× les surplus partiels. Mitigation propre : disable le bouton côté UI pendant la requête (cf. pattern Sprint Sprint Modal-Forms-Block-Enter-Submit).
- **Loop non-atomique** : si transfert budget #2 échoue, budgets #1 et #3 sont déjà commits. Acceptable (`fail-soft` loop). Logger explicit pour traçabilité.
- **`current_step` strict** : ne PAS accepter 'salary_update' ou 'final_recap' ou 'completed' pour ces 2 endpoints. Le user a déjà passé l'étape — retour 409 explicite.
- **Filter context (profile vs group)** : `transferBudgetToPiggyBank` accepte `ContextFilter = { profile_id?: string, group_id?: string }`. Choisir exactement un selon le context.
- **Re-load summary après transfert** : essentiel pour que l'UI affiche les surplus RESTANTS (le user peut transférer une partie puis vouloir transformer le reste). Le response inclut `summary` post-transfert.
- **Surplus float-precision** : `b.surplus` vient de `computeBudgetSurplus` qui round2. Le transfert RPC accepte numeric à 2 decimals.

## Commandes utiles
```bash
# Tests gated
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/transfer-surpluses-to-piggy
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/transform-remaining-surpluses-to-savings

# Smoke curl (avec session cookie)
curl -X POST http://localhost:3000/api/monthly-recap/transfer-surpluses-to-piggy \
  -H "Content-Type: application/json" -b "session=..." \
  -d '{"context":"profile","budgetIds":["uuid1","uuid2"]}'
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 2 endpoints opérationnels via curl + tests gated
- Loop fail-soft testé (forcer un budget à échouer via input invalide, vérifier que les autres passent)
- Commit `feat(recap): positive flow endpoints (transfer surpluses + transform to savings)`
- `pnpm verify` exit 0
