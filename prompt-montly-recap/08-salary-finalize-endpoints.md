# [08] — Endpoints salary update + finalize (complete) + nouvelle RPC carry-over

> 🛑 **AVANT DE COMMENCER** — Relire impérativement [00-README.md](./00-README.md) et [00-Detailed_feature.md](./00-Detailed_feature.md) pour recharger tout le contexte feature (architecture globale + spec §1-8). Ce prompt ne se suffit pas à lui-même.

## Contexte
- Feature globale : Monthly Recap V3, écran 4 (salary update) + écran 5 (finalize) — clôture le recap, applique snapshot différé + traite transactions validées/non-validées + set completed_at.
- Position dans la séquence : étape 08/17
- Dépend de : 05 (start endpoint), 06 (positive), 07 (negative) — toutes les actions immédiates traitées
- Débloque : 13 (UI screen 4+5)

## Objectif
Créer 2 endpoints : `POST /api/monthly-recap/update-salaries` (UPDATE profiles.salary + appel `calculate_group_contributions`) et `POST /api/monthly-recap/complete` (apply budget_snapshot_data → carryover_spent_amount + process transactions validées→DELETE / non-validées→flag is_carried_over + set completed_at). Ajouter 2 nouvelles RPCs : `finalize_recap_apply_snapshot` (atomic apply) + `process_recap_transactions` (atomic carry-over OR delete).

## Fichiers concernés
- `app/api/monthly-recap/update-salaries/route.ts` — à créer
- `app/api/monthly-recap/complete/route.ts` — à créer (NOTE: l'ancien V2 stub était déjà supprimé en 01, donc création fresh)
- `lib/recap/actions-finalize.ts` — à créer (orchestrateur : apply snapshot, process transactions, set completed_at)
- `lib/recap/actions-salary.ts` — à créer (helper : update salaries + recalc contributions)
- `supabase/migrations/<TS>_create_recap_finalize_rpcs.sql` — à créer (2 nouvelles RPCs)
- `scripts/check-rpcs.mjs` — étendre `EXPECTED_RPCS` (14 → 16)
- `lib/schemas/recap.ts` — déjà étendu en 03 (updateSalariesBodySchema + completeRecapBodySchema prêts)
- CLAUDE.md §5.5 — mettre à jour EXPECTED_RPCS

## Patterns et conventions à respecter
- **Atomicity finalize** : la finalisation touche plusieurs tables (estimated_budgets, real_expenses, real_income_entries, monthly_recaps). Au minimum, séparer en 2 RPCs atomiques : apply_snapshot (UPDATE budgets) + process_transactions (DELETE validated + UPDATE non-validated). Puis un UPDATE final monthly_recaps.completed_at.
- **Fail-soft sur process_transactions** : si une transaction échoue (FK violation, etc.), on continue avec les autres et on logge. Au pire on a un mix incohérent qu'un retry peut résoudre.
- **`calculate_group_contributions` reuse** : RPC déjà existante (cf. CLAUDE.md §6 Group contributions structure). Appel post-UPDATE profiles.
- **Permissions strictes** : seul l'initiateur peut update salaries (vérif `started_by_profile_id === userId`). Tous les `profileId` du body doivent être membres du même groupe que l'initiateur.
- **Idempotency complete** : si complete est rappelé (réseau lent + retry), idéalement no-op si déjà completed. Vérifier `completed_at IS NOT NULL` en début et retourner 200 (idempotent) ou 409 (déjà fini). **Décision** : retourner 200 + `{ alreadyCompleted: true }` (idempotent friendly).

## Schémas DB / RPCs

### Migration RPCs

```sql
-- supabase/migrations/<TS>_create_recap_finalize_rpcs.sql

CREATE OR REPLACE FUNCTION finalize_recap_apply_snapshot(
  p_recap_id uuid,
  p_snapshot jsonb  -- {budget_id_uuid: amount, ...}
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget_id text;
  v_amount numeric;
  v_applied jsonb := '[]'::jsonb;
BEGIN
  -- For each (budget_id, amount) in snapshot : UPDATE estimated_budgets.carryover_spent_amount
  FOR v_budget_id, v_amount IN SELECT * FROM jsonb_each_text(p_snapshot) LOOP
    UPDATE estimated_budgets
      SET carryover_spent_amount = COALESCE(carryover_spent_amount, 0) + v_amount::numeric,
          carryover_applied_date = now()
    WHERE id = v_budget_id::uuid;
    IF FOUND THEN v_applied := v_applied || jsonb_build_array(jsonb_build_object('budget_id', v_budget_id, 'amount', v_amount)); END IF;
  END LOOP;
  RETURN json_build_object('applied', v_applied);
END;
$$;

CREATE OR REPLACE FUNCTION process_recap_transactions(
  p_recap_id uuid,
  p_profile_id uuid,    -- exactly one
  p_group_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_expenses int := 0;
  v_deleted_incomes int := 0;
  v_carried_expenses int := 0;
  v_carried_incomes int := 0;
BEGIN
  -- DELETE validées (applied_to_balance_at IS NOT NULL)
  WITH deleted AS (
    DELETE FROM real_expenses
    WHERE applied_to_balance_at IS NOT NULL
      AND is_carried_over = false
      AND (p_profile_id IS NULL OR profile_id = p_profile_id)
      AND (p_group_id IS NULL OR group_id = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_expenses FROM deleted;

  WITH deleted AS (
    DELETE FROM real_income_entries
    WHERE applied_to_balance_at IS NOT NULL
      AND is_carried_over = false
      AND (p_profile_id IS NULL OR profile_id = p_profile_id)
      AND (p_group_id IS NULL OR group_id = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted_incomes FROM deleted;

  -- Flag non-validées comme carried_over
  WITH updated AS (
    UPDATE real_expenses
      SET is_carried_over = true,
          carried_from_recap_id = p_recap_id
    WHERE applied_to_balance_at IS NULL
      AND is_carried_over = false
      AND (p_profile_id IS NULL OR profile_id = p_profile_id)
      AND (p_group_id IS NULL OR group_id = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_expenses FROM updated;

  WITH updated AS (
    UPDATE real_income_entries
      SET is_carried_over = true,
          carried_from_recap_id = p_recap_id
    WHERE applied_to_balance_at IS NULL
      AND is_carried_over = false
      AND (p_profile_id IS NULL OR profile_id = p_profile_id)
      AND (p_group_id IS NULL OR group_id = p_group_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_carried_incomes FROM updated;

  RETURN json_build_object(
    'deleted_expenses', v_deleted_expenses,
    'deleted_incomes', v_deleted_incomes,
    'carried_expenses', v_carried_expenses,
    'carried_incomes', v_carried_incomes
  );
END;
$$;

REVOKE ALL ON FUNCTION finalize_recap_apply_snapshot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finalize_recap_apply_snapshot TO service_role;
REVOKE ALL ON FUNCTION process_recap_transactions FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_recap_transactions TO service_role;

NOTIFY pgrst, 'reload schema';
```

## Détail des endpoints

### `POST /api/monthly-recap/update-salaries`

Body : `{ context, salaries: [{ profileId, salary }] }`.

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context, salaries } = await parseBody(request, updateSalariesBodySchema)
    const recap = await getActiveRecap({ context, userId, profile })
    if (!recap) return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    if (recap.started_by_profile_id !== userId) return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    if (recap.current_step !== 'salary_update') return NextResponse.json({ error: 'invalid_step' }, { status: 409 })

    // Cas profile : forcer salaries.length === 1 + salaries[0].profileId === user.id
    if (context === 'profile') {
      if (salaries.length !== 1 || salaries[0].profileId !== userId) {
        return NextResponse.json({ error: 'invalid_target' }, { status: 400 })
      }
    } else {
      // Cas group : tous les profileIds doivent être membres du groupe
      const groupMemberIds = await fetchGroupMemberIds(profile.group_id!)
      const invalid = salaries.filter(s => !groupMemberIds.has(s.profileId))
      if (invalid.length > 0) return NextResponse.json({ error: 'invalid_target', invalid: invalid.map(s => s.profileId) }, { status: 400 })
    }

    // UPDATE chaque salary
    for (const { profileId, salary } of salaries) {
      const { error } = await supabaseServer.from('profiles').update({ salary }).eq('id', profileId)
      if (error) { logger.error('[recap/update-salaries] update failed', { profileId, error }); throw error }
    }

    // Si group : recalc contributions
    if (context === 'group') {
      const { error } = await supabaseServer.rpc('calculate_group_contributions', { group_id_param: profile.group_id! })
      if (error) logger.error('[recap/update-salaries] recalc contributions failed', error)
    }

    // Avance current_step à 'final_recap'
    await supabaseServer.from('monthly_recaps').update({ current_step: 'final_recap' }).eq('id', recap.id)

    return NextResponse.json({ data: { updated: salaries.length, nextStep: 'final_recap' } })
  } catch (e) { ... }
})
```

### `POST /api/monthly-recap/complete` (rewrite — finalize)

Body : `{ context }`.

```ts
export const POST = withAuthAndProfile(async (request, { userId, profile }) => {
  try {
    const { context } = await parseBody(request, completeRecapBodySchema)
    const recap = await getActiveRecap({ context, userId, profile })
    if (!recap) {
      // Idempotency check : peut-être déjà completed
      const { data: completed } = await supabaseServer.from('monthly_recaps').select('id, completed_at')
        .match({ ...filter, recap_month: month, recap_year: year })
        .not('completed_at', 'is', null).maybeSingle()
      if (completed) return NextResponse.json({ data: { alreadyCompleted: true, recap: completed } })
      return NextResponse.json({ error: 'no_active_recap' }, { status: 404 })
    }
    if (recap.started_by_profile_id !== userId) return NextResponse.json({ error: 'not_initiator' }, { status: 403 })
    if (recap.current_step !== 'final_recap') return NextResponse.json({ error: 'invalid_step' }, { status: 409 })

    // 1. Apply snapshot
    if (Object.keys(recap.budget_snapshot_data ?? {}).length > 0) {
      const { error: snapErr } = await supabaseServer.rpc('finalize_recap_apply_snapshot', {
        p_recap_id: recap.id,
        p_snapshot: recap.budget_snapshot_data,
      })
      if (snapErr) logger.error('[recap/complete] apply_snapshot failed', snapErr)  // fail-soft, continue
    }

    // 2. Process transactions
    const { error: txErr } = await supabaseServer.rpc('process_recap_transactions', {
      p_recap_id: recap.id,
      p_profile_id: context === 'profile' ? profile.id : null,
      p_group_id: context === 'group' ? profile.group_id! : null,
    })
    if (txErr) logger.error('[recap/complete] process_transactions failed', txErr)

    // 3. Set completed_at + current_step='completed'
    const { error: finErr } = await supabaseServer.from('monthly_recaps').update({
      completed_at: new Date().toISOString(),
      current_step: 'completed',
    }).eq('id', recap.id)
    if (finErr) { logger.error('[recap/complete] mark completed failed', finErr); throw finErr }

    return NextResponse.json({ data: { completed: true, recapId: recap.id } })
  } catch (e) { ... }
})
```

## Étapes d'implémentation suggérées
1. **Créer migration RPCs** + apply + repair + re-export baseline + `pnpm db:audit-functions`.
2. **EXPECTED_RPCS 14 → 16** (start + finalize_snapshot + process_transactions). MAJ `scripts/check-rpcs.mjs` + CLAUDE.md §5.5.
3. **Créer `lib/recap/actions-salary.ts`** : helper `fetchGroupMemberIds(groupId): Promise<Set<string>>`.
4. **Créer `lib/recap/actions-finalize.ts`** : optionnel — l'orchestration peut rester dans route.ts (peu de logique).
5. **Créer les 2 routes** avec withAuthAndProfile + validations strictes (initiator, step, target).
6. **Tests gated par endpoint** (≥8 update-salaries + ≥10 complete) + tests RPC isolés (~6 chacune).
7. **Smoke test** : workflow complet seed → start → action positive → update salary → complete. Vérifier qu'au dashboard post-complete, les expenses validées ont disparu et les non-validées ont is_carried_over=true.
8. **Commit** : `feat(recap): salary update + finalize endpoints + 2 RPCs`.

## Critères d'acceptation
- [ ] 2 RPCs créées (finalize_recap_apply_snapshot + process_recap_transactions), auditées
- [ ] `EXPECTED_RPCS = 16`, `pnpm db:check-rpcs` exit 0
- [ ] CLAUDE.md §5.5 mis à jour (14 → 16)
- [ ] 2 endpoints créés, withAuthAndProfile, parseBody
- [ ] update-salaries valide : context, initiator, step='salary_update', all profileIds in group
- [ ] update-salaries appelle `calculate_group_contributions` après UPDATE (cas group)
- [ ] update-salaries avance current_step → 'final_recap'
- [ ] complete idempotent : 2eme appel retourne `alreadyCompleted: true`
- [ ] complete applique snapshot → carryover_spent_amount UPDATE atomique
- [ ] complete process transactions : DELETE applied + UPDATE non-applied is_carried_over=true + carried_from_recap_id=recap.id
- [ ] complete set completed_at + current_step='completed'
- [ ] Tests gated ≥18 cas passants
- [ ] `pnpm typecheck` + `pnpm lint:check` exit 0

## Tests à écrire

### update-salaries (gated, ~8 cas)
- Context profile, salaries=[{userId, 3000}] → UPDATE profiles.salary, step → 'final_recap'
- Context profile, salaries.length > 1 → 400 invalid_target
- Context profile, salaries[0].profileId != userId → 400 invalid_target
- Context group, 3 salaries tous membres → UPDATE 3, recalc contributions called
- Context group, 1 profileId pas membre → 400 invalid_target avec list
- Not initiator → 403
- Step invalide (e.g. 'manage_bilan') → 409
- Body vide → 400 (Zod fail)

### complete (gated, ~10 cas)
- Happy : recap final_recap, snapshot {b1:20, b2:30}, 5 expenses (3 applied, 2 non-applied) → snapshot appliqué (carryover_spent_amount +20 et +30), 3 expenses DELETE, 2 expenses is_carried_over=true, completed_at set
- Idempotency : 2eme call → alreadyCompleted: true
- Not initiator → 403
- Step invalide (not final_recap) → 409
- Empty snapshot → snapshot RPC pas appelé, ou no-op
- No expenses → 0 deleted, 0 carried
- Real_income_entries also processed (3 applied → DELETE, 1 non-applied → carried)
- carried_from_recap_id=recap.id sur les rows flaggées
- Si snapshot RPC fail (force erreur), process_transactions doit quand même tourner (fail-soft)
- post-complete : checkRecapStatus retourne kind='completed'

### RPC tests (gated, ~6 chacune)
- finalize_recap_apply_snapshot : empty snapshot → applied=[], no-op
- finalize_recap_apply_snapshot : snapshot avec budget inexistant → applied=[] (le UPDATE ne FOUND rien)
- finalize_recap_apply_snapshot : applies sur 3 budgets → applied.length=3, carryover_spent_amount += amount, carryover_applied_date = now()
- process_recap_transactions : 2 applied + 3 non-applied → deleted=2, carried=3
- process_recap_transactions : context profile vs group → filter correct
- process_recap_transactions : déjà carried_over=true → ignored (filter is_carried_over=false dans WHERE)

## Pièges et points d'attention
- **Idempotency complete** : essential pour la robustesse réseau. Le retry doit être no-op si déjà fini. Implémentation : check `completed_at IS NOT NULL` AVANT toute action.
- **Fail-soft snapshot** : si l'apply échoue, on continue avec process_transactions + set completed_at. Le recap se ferme, mais les budgets carryover ne sont pas updated. Acceptable pour V1 mais à monitorer.
- **`calculate_group_contributions` est synchrone** : c'est une RPC qui termine avant le return. Si elle échoue, log mais continue (le user pourra recalculer manuellement plus tard via POST /api/groups/contributions).
- **Cas profile vs group dans la RPC `process_recap_transactions`** : utiliser le pattern `(p_profile_id IS NULL OR profile_id = p_profile_id)` pour gérer XOR. Cf. `monthly_recaps` CHECK constraint same logic.
- **`real_income_entries` aussi processed** : la spec dit "dépenses ET revenus du mois écoulé". Ne PAS oublier la table real_income_entries dans la RPC.
- **`is_carried_over = false` filter** : crucial dans les WHERE pour ne PAS re-process les transactions déjà carried-over depuis un mois précédent (récap N qui hérite des carried-over de N-1 — ces transactions devraient sauter le process, l'utilisateur a déjà décidé de les ignorer ou de les valider durant le mois N).
- **Group salary validation** : `fetchGroupMemberIds(groupId)` doit SELECT `profiles.id WHERE group_id = X`. NE PAS faire confiance au client pour la liste des profileIds — toujours re-fetch côté server.
- **NOTIFY pgrst** à la fin de la migration RPCs sinon `.rpc()` ne trouvera pas les nouvelles fonctions immédiatement.
- **`monthly_recaps.completed_at` peut être set même si snapshot/transactions ont partiellement échoué** : c'est un trade-off de robustesse vs atomicité. Si on veut tout-ou-rien, encapsuler dans une seule transaction (un seul RPC composite). Pour V1, garder séparé pour traceability fail-soft.

## Commandes utiles
```bash
# Migration
node scripts/apply-sql.mjs supabase/migrations/<TS>_create_recap_finalize_rpcs.sql
pnpm supabase migration repair --status applied <TS>
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:audit-functions
pnpm db:check-rpcs  # exit 0 après MAJ EXPECTED_RPCS

# Tests
SUPABASE_RECAP_TESTS=1 pnpm test:run app/api/monthly-recap/update-salaries app/api/monthly-recap/complete
```

## Definition of Done
- Tous les critères d'acceptation cochés
- 2 RPCs auditées, EXPECTED_RPCS = 16
- ≥18 cas de tests passants
- Smoke test end-to-end : seed → start → action positive → update-salaries → complete → vérif transactions
- Commit `feat(recap): salary update + finalize endpoints + 2 RPCs (apply_snapshot, process_transactions)`
- `pnpm verify` exit 0
