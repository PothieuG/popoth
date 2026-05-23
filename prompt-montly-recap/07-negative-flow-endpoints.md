# [07] — Endpoints flow négatif (4.B) : refloat piggy / savings / budget snapshot

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, écran 3B quand bilan < 0 — l'utilisateur renfloue le déficit via 3 lignes en cascade (tirelire → économies budgets → puisage proportionnel dans budgets futurs).
- Position dans la séquence : étape 07/17
- Dépend de : 04 (calculations : computeProportionalSavingsRefloat + computeProportionalBudgetSnapshot), 05 (start endpoint et helpers)
- Débloque : 12 (UI screen 3B)

## Objectif
Créer 3 endpoints : `refloat-from-piggy` (immédiat, débite piggy), `refloat-from-savings` (immédiat, proportional sur cumulated_savings), `save-budget-snapshot` (différé, écrit snapshot dans `budget_snapshot_data` JSONB — applied seulement au finalize en sous-tâche 08). Tracker les refloats cumulés dans `monthly_recaps.refloated_from_piggy` + `refloated_from_savings`. Avancer current_step → 'salary_update' une fois déficit = 0.

## Fichiers concernés
- `app/api/monthly-recap/refloat-from-piggy/route.ts` — à créer
- `app/api/monthly-recap/refloat-from-savings/route.ts` — à créer
- `app/api/monthly-recap/save-budget-snapshot/route.ts` — à créer
- `lib/recap/actions-negative.ts` — à créer (helpers : `computeCurrentDeficitRemaining`, `applyRefloatToRecap`)
- `lib/recap/calculations.ts` — à LIRE (`computeProportionalSavingsRefloat`, `computeProportionalBudgetSnapshot` déjà fait en 04)
- `lib/finance/piggy-bank.ts` — à LIRE (`updatePiggyBank` existant)
- `lib/finance/budget-savings.ts` — à LIRE (`updateBudgetCumulatedSavings` existant)
- `lib/schemas/recap.ts` — déjà étendu en 03

## Patterns et conventions à respecter
- **Réutilisation RPCs atomiques** : `updatePiggyBank(filter, -amount)` pour débiter ; boucle `updateBudgetCumulatedSavings(budgetId, -share)` pour le savings refloat. Pas de séquence non-atomique.
- **Tracking refloats** : à chaque action, `UPDATE monthly_recaps SET refloated_from_piggy = refloated_from_piggy + X` (ou ...savings). Ces valeurs servent à recalculer le déficit restant à la prochaine load_summary.
- **Recap déficit dynamique** : `currentDeficitRemaining = abs(initialBilan) - refloated_from_piggy - refloated_from_savings - sum(budget_snapshot_data.values())`. Quand 0 → user peut continuer.
- **Snapshot différé** : `save-budget-snapshot` écrit dans `budget_snapshot_data` JSONB SANS toucher aux `estimated_budgets.carryover_spent_amount`. L'application se fait au finalize (08).
- **Clamping** : ne JAMAIS over-refloat. Si amount > deficit_remaining, retourner 400 + clamp côté server.
- **Pattern Zod** : `refloatFromPiggyBodySchema` + `refloatFromSavingsBodySchema` (juste { context }, l'algo détermine le montant à puiser) + `saveBudgetSnapshotBodySchema` (avec snapshot record).

## Détail des endpoints

### `POST /api/monthly-recap/refloat-from-piggy`

Body : `{ context, amount }` où amount = combien l'utilisateur veut puiser (typiquement = min(piggy.amount, deficit_remaining)).

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context, amount } = await parseBody(request, refloatFromPiggyBodySchema)
    const recap = await getActiveRecap({ context, userId, profile })
    if (!recap) return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    if (recap.started_by_profile_id !== userId) return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    if (!['summary','manage_bilan'].includes(recap.current_step)) return NextResponse.json({ error: 'invalid_step' }, { status: 409 })

    // Vérifier deficit_remaining
    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    if (summary.bilanSign !== 'negative') return NextResponse.json({ error: 'no_deficit' }, { status: 409 })

    const deficitRemaining = Math.abs(summary.bilan) - Number(recap.refloated_from_piggy) - Number(recap.refloated_from_savings) - sumSnapshotValues(recap.budget_snapshot_data)
    if (amount > deficitRemaining + 0.01) return NextResponse.json({ error: 'overflow', deficitRemaining }, { status: 400 })
    if (amount > summary.piggyAmount + 0.01) return NextResponse.json({ error: 'piggy_insufficient', available: summary.piggyAmount }, { status: 400 })

    // Action atomique : débit piggy + update refloated_from_piggy
    const filter = context === 'profile' ? { profile_id: profile.id } : { group_id: profile.group_id! }
    await updatePiggyBank(filter, -amount)
    await supabaseServer.from('monthly_recaps').update({
      refloated_from_piggy: Number(recap.refloated_from_piggy) + amount,
    }).eq('id', recap.id)

    // Re-compute deficit
    const newDeficit = round2(deficitRemaining - amount)

    // Si deficit == 0 ET piggy a généré surplus restant (i.e. user a refloat depuis piggy alors qu'il en restait)
    // → l'UI front-end gérera la bascule sur flow positif, pas le serveur. Le serveur juste rapporte deficit=0.

    return NextResponse.json({ data: { newDeficit, refloatedFromPiggy: Number(recap.refloated_from_piggy) + amount, summary: await loadRecapSummary(...) } })
  } catch (e) { ... }
})
```

### `POST /api/monthly-recap/refloat-from-savings`

Body : `{ context }` — le serveur détermine la répartition proportionnelle via `computeProportionalSavingsRefloat`.

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = await parseBody(request, contextOnlyBodySchema)
    const recap = await getActiveRecap({ context, userId, profile })
    // ...même validations qu'au-dessus...

    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    const deficitRemaining = Math.abs(summary.bilan) - Number(recap.refloated_from_piggy) - Number(recap.refloated_from_savings) - sumSnapshotValues(recap.budget_snapshot_data)
    if (deficitRemaining <= 0) return NextResponse.json({ error: 'no_deficit' }, { status: 409 })

    // Calcul proportionnel via lib/recap/calculations.ts
    const allocation = computeProportionalSavingsRefloat(
      deficitRemaining,
      summary.budgets.map(b => ({ budgetId: b.budgetId, cumulatedSavings: b.cumulatedSavings })),
    )

    if (allocation.totalAllocated === 0) return NextResponse.json({ data: { newDeficit: deficitRemaining, refloatedFromSavings: 0, shortfall: deficitRemaining, perBudget: [] } })

    // Loop débit cumulated_savings (fail-soft)
    const applied: Array<{ budgetId: string, amount: number }> = []
    for (const item of allocation.perBudget) {
      try {
        await updateBudgetCumulatedSavings(item.budgetId, -item.amount)
        applied.push(item)
      } catch (e) { logger.error('[recap/refloat-from-savings] failed', { budgetId: item.budgetId, error: e }) }
    }
    const totalApplied = applied.reduce((s, i) => s + i.amount, 0)

    await supabaseServer.from('monthly_recaps').update({
      refloated_from_savings: Number(recap.refloated_from_savings) + totalApplied,
    }).eq('id', recap.id)

    return NextResponse.json({ data: { newDeficit: round2(deficitRemaining - totalApplied), refloatedFromSavings: totalApplied, shortfall: allocation.shortfall, perBudget: applied, summary: await loadRecapSummary(...) } })
  } catch (e) { ... }
})
```

### `POST /api/monthly-recap/save-budget-snapshot`

Body : `{ context, snapshot: Record<budgetId, amount> }`. Le serveur valide que la somme == deficit_remaining (auto-puiser exact), valide que chaque amount ≤ (budget.estimated - budget.carryover_spent), et UPDATE le JSONB.

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context, snapshot } = await parseBody(request, saveBudgetSnapshotBodySchema)
    const recap = await getActiveRecap({ context, userId, profile })
    // ...validations standards...

    const summary = await loadRecapSummary({ context, profileId: userId, groupId: profile.group_id })
    const deficitRemaining = Math.abs(summary.bilan) - Number(recap.refloated_from_piggy) - Number(recap.refloated_from_savings) - sumSnapshotValues(recap.budget_snapshot_data)
    const snapshotTotal = round2(Object.values(snapshot).reduce((s, v) => s + v, 0))

    if (snapshotTotal > deficitRemaining + 0.01) return NextResponse.json({ error: 'overflow', deficitRemaining }, { status: 400 })

    // Validate per-budget caps
    for (const [budgetId, amount] of Object.entries(snapshot)) {
      const budget = summary.budgets.find(b => b.budgetId === budgetId)
      if (!budget) return NextResponse.json({ error: 'unknown_budget', budgetId }, { status: 400 })
      const available = budget.estimatedAmount  // Note: pour V3, le snapshot s'applique à l'estimé du budget (cf. CLAUDE.md `carryover_spent_amount`)
      if (amount > available + 0.01) return NextResponse.json({ error: 'budget_insufficient', budgetId, available }, { status: 400 })
    }

    // Merge with existing snapshot (additive — user peut faire plusieurs save-snapshot calls)
    const existingSnapshot = (recap.budget_snapshot_data ?? {}) as Record<string, number>
    const mergedSnapshot: Record<string, number> = { ...existingSnapshot }
    for (const [budgetId, amount] of Object.entries(snapshot)) {
      mergedSnapshot[budgetId] = round2((mergedSnapshot[budgetId] ?? 0) + amount)
    }

    await supabaseServer.from('monthly_recaps').update({ budget_snapshot_data: mergedSnapshot }).eq('id', recap.id)

    const newDeficit = round2(deficitRemaining - snapshotTotal)

    // Si newDeficit === 0 → avance current_step à 'salary_update'
    if (newDeficit <= 0.01) {
      await supabaseServer.from('monthly_recaps').update({ current_step: 'salary_update' }).eq('id', recap.id)
    }

    return NextResponse.json({ data: { newDeficit, snapshot: mergedSnapshot, nextStep: newDeficit <= 0.01 ? 'salary_update' : 'manage_bilan' } })
  } catch (e) { ... }
})
```

### `lib/recap/actions-negative.ts`

```ts
export function sumSnapshotValues(snapshot: Record<string, number> | null | undefined): number {
  if (!snapshot) return 0
  return Math.round(Object.values(snapshot).reduce((s, v) => s + Number(v), 0) * 100) / 100
}

export function computeDeficitRemaining(args: { initialBilan: number, refloatedFromPiggy: number, refloatedFromSavings: number, snapshotData: Record<string, number> | null }): number {
  return Math.round((Math.abs(args.initialBilan) - args.refloatedFromPiggy - args.refloatedFromSavings - sumSnapshotValues(args.snapshotData)) * 100) / 100
}
```

## Étapes d'implémentation suggérées
1. **Créer `lib/recap/actions-negative.ts`** : helpers `sumSnapshotValues` + `computeDeficitRemaining`.
2. **Créer les 3 endpoints** avec withAuthAndProfile + parseBody + validations strictes (state, role, deficit, caps).
3. **Tests gated par endpoint** (≥8 cas chacun, cf. ci-dessous).
4. **Tests pure helpers** : sumSnapshotValues + computeDeficitRemaining (non-gated, ~6 cas).
5. **Smoke test** : seed scénario `deficit-light` ou `deficit-cascade` (dev tools en 09), call les 3 endpoints en cascade jusqu'à deficit=0, vérifier state machine.
6. **Commit** : `feat(recap): negative flow endpoints (refloat piggy/savings + snapshot)`.

## Critères d'acceptation
- [ ] 3 endpoints créés, POST handlers, withAuthAndProfile, parseBody
- [ ] `lib/recap/actions-negative.ts` exporte 2 helpers pure-sync
- [ ] Refloat from piggy : débite piggy_bank + update monthly_recaps.refloated_from_piggy en séquence
- [ ] Refloat from savings : computeProportionalSavingsRefloat + loop updateBudgetCumulatedSavings + update monthly_recaps.refloated_from_savings
- [ ] Save snapshot : merge dans budget_snapshot_data JSONB additif, validates caps, avance current_step si deficit=0
- [ ] Toutes les validations : not_initiator (403), invalid_step (409), no_deficit (409), overflow (400), piggy_insufficient (400), budget_insufficient (400)
- [ ] Clamping cents-precise (`+ 0.01` tolerance pour float drift)
- [ ] Tests gated ≥24 cas (3 endpoints × ~8) passants
- [ ] Tests helpers ≥6 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### refloat-from-piggy (gated, ~8 cas)
- Happy : piggy=100, deficit=80, amount=80 → piggy.amount=20, refloated_from_piggy=80, newDeficit=0
- Partial : piggy=50, deficit=80, amount=50 → piggy=0, refloated=50, newDeficit=30
- Overflow amount > deficit → 400
- Overflow amount > piggy → 400
- No deficit (bilan positif) → 409
- Recap completed → 410
- Recap started_by autre → 403
- Step invalide → 409

### refloat-from-savings (gated, ~8 cas)
- Happy proportional : 3 budgets {savings=100,200,300}, deficit=120 → savings devient {80, 160, 240}, refloated_from_savings=120
- Pool < deficit : savings total=50, deficit=200 → tout vidé, shortfall=150
- Pool == 0 : no-op, retourne shortfall=deficit
- Pool exact = deficit : tout vidé, shortfall=0
- No deficit → 409
- Not initiator → 403
- Step invalide → 409
- Cents precision : 3 budgets équilibrés, deficit=100 → ~33.33/33.33/33.34, sum exact = 100

### save-budget-snapshot (gated, ~8 cas)
- Happy : snapshot = {b1: 30, b2: 20, b3: 50}, deficit=100 → write JSONB, newDeficit=0, current_step='salary_update'
- Partial : snapshot somme 50, deficit=100 → newDeficit=50, current_step inchangé
- Snapshot overflow > deficit → 400
- Snapshot per-budget cap exceeded → 400
- Snapshot unknown budgetId → 400 + body { error: 'unknown_budget' }
- Snapshot append (2 calls additifs) : 1er {b1:30}, 2eme {b2:20} → merged {b1:30, b2:20}
- Not initiator → 403
- Step invalide → 409

### helpers (non-gated, ~6 cas)
- sumSnapshotValues null → 0
- sumSnapshotValues {} → 0
- sumSnapshotValues {a:10.33, b:20.67} → 31 exact
- computeDeficitRemaining initial=100 piggy=30 savings=20 snapshot={a:10} → 40
- computeDeficitRemaining bilan positif → output negative (caller doit handle)
- Float drift : refloated 33.33+33.33+33.34 = 100 (vs naive sum 99.99 / 100.01)

## Pièges et points d'attention
- **Refloat order n'est PAS imposé** : la spec dit "tirelire → savings → snapshot" en cascade UI, mais le user peut techniquement appeler refloat-from-savings d'abord. Les endpoints n'enforcent PAS l'ordre — c'est l'UI qui guide. Le serveur juste vérifie le deficit restant et clampe.
- **Cents tolerance `+ 0.01`** : crucial pour les comparaisons amount/deficit_remaining/budget_caps. Sans, les Math.round drift de 0.01€ produit des 400 false-positives.
- **JSONB merge additif** : `save-budget-snapshot` accepte des calls multiples (UI peut chunker). Le merge `mergedSnapshot[id] = (mergedSnapshot[id] ?? 0) + amount` est additif, pas un overwrite total.
- **Snapshot NE PAS appliquer aux estimated_budgets ici** : c'est le job du finalize (08). Le snapshot reste dans le JSONB jusqu'à completion. Ne PAS écrire dans `carryover_spent_amount` ici.
- **`current_step` avance** : seulement quand deficit ATTEINT 0. Si refloat-from-piggy résout le deficit (piggy plus que suffisant), retourner `newDeficit=0` ET potentiellement avancer step ou laisser l'UI gérer la bascule sur flow positif (voir Q4 user response : bascule UI-side). **Décision** : avancer current_step à 'salary_update' UNIQUEMENT depuis save-budget-snapshot quand deficit atteint 0. Pour refloat-from-piggy et refloat-from-savings, ne PAS avancer même si deficit=0 — l'UI doit décider si on bascule au flow positif (cas piggy a généré surplus). L'avancement final se fait via un appel explicite à un endpoint dédié OU via save-budget-snapshot.
   **Alternative** : ajouter un endpoint séparé `POST /api/monthly-recap/advance-to-salary` que l'UI appelle quand il décide. Plus propre. À discuter — mais pour ce sprint, **garder simple** : save-budget-snapshot est le seul à advance. Si l'UI résout le deficit via piggy seul, elle bascule vers flow positif via call à `transform-remaining-surpluses-to-savings` (qui avance current_step lui). Atypique mais workable.
- **Pas de RPC composite ici** : les actions sont 2-3 statements SQL non-atomiques (debit piggy + update recap). Si la 2ème écriture échoue, on a un debit piggy orphelin. Acceptable mais loggé. Idéalement créer un RPC composite, mais lourd pour cette feature. Documenter le trade-off dans le commit.
- **`refloated_from_piggy/savings` cumul** : le `+ amount` côté server-side n'est PAS atomic vs un read concurrent. Race possible si user clique 2× ultra-rapide. Mitigation : UI disable button + retry-after côté API (HTTP 423 si transaction en cours).

## Commandes utiles
```bash
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/refloat-from-piggy app/api/monthly-recap/refloat-from-savings app/api/monthly-recap/save-budget-snapshot lib/recap/__tests__/actions-negative.test.ts
```

## Definition of Done
- Tous les critères d'acceptation cochés
- ≥30 cas de tests passants (3 endpoints × 8 + helpers × 6)
- Smoke test : seed deficit-cascade, refloat piggy partial + savings full + snapshot pour reste → deficit=0, current_step='salary_update'
- Commit `feat(recap): negative flow endpoints (refloat piggy/savings + snapshot)`
- `pnpm verify` exit 0
