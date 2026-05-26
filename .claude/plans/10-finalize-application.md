# Sprint 10 — Finalize : application snapshot + shift deadline + accumulation amount_saved

> ✅ **LIVRÉ 2026-05-26** sur branche `feature/projets-epargne`, commit `51bb362`. Détails closeout → [Part 30](../history/roadmap-detailed-30-projets-epargne-modals.md). `executeCompleteRecap` invoque maintenant `apply_recap_projects_snapshot` après le snapshot budgets (toujours, même `project_snapshot_data` vide) + `RecapSummary.projectSnapshot` ajouté (calc pure + UI section FinalRecapStep). `SavingsProjectMeta.pendingDelayFraction` ajouté pour le preview deadline shift. 5 tests gated DB end-to-end + 6 calc cases + 3 RTL cases + 3 mock cases. Push prod différé sprint 11.

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la section 5.3 "Validation du monthly recap" + la règle "Renflouement total → décalage 1 mois ; partiel → recalcul proportionnel".

## Objectif

À la finalisation du recap mensuel, la RPC `apply_recap_projects_snapshot` (créée au sprint 01) est invoquée pour appliquer le `project_snapshot_data` du recap : pour chaque projet, `amount_saved += monthly_allocation - refund` et shift `deadline_date` si `pending_delay_fraction` dépasse 1. Mise à jour de l'écran FinalRecap pour résumer ce qui s'est passé sur les projets.

## Règle de décalage (rappel)

- `frac_added = refund / monthly_allocation` (entre 0 et 1)
- `new_pending = pending_delay_fraction + frac_added`
- `months_to_shift = FLOOR(new_pending)`
- Si `months_to_shift >= 1` : `deadline_date += INTERVAL '1 month' * months_to_shift` ; `pending_delay_fraction = new_pending - months_to_shift`
- Sinon : `pending_delay_fraction = new_pending`
- `amount_saved += monthly_allocation - refund` (peut être 0 si refund == monthly)

Cas full refund : `frac_added = 1`, `new_pending = 1`, shift +1 mois, pending = 0. ✓
Cas partiel 30/100 sur 4 mois consécutifs : pending devient 0.3 → 0.6 → 0.9 → 1.2 → shift +1 mois au 4e mois, reste = 0.2. ✓

## Pré-lecture obligatoire

- [lib/recap/actions-finalize.ts](../../lib/recap/actions-finalize.ts) — `executeCompleteRecap` orchestrateur (81-150)
- Sprint 01 — RPC `apply_recap_projects_snapshot` (à mettre à jour ici si nécessaire — voir tâche 2)
- [components/monthly-recap/steps/FinalRecapStep.tsx](../../components/monthly-recap/steps/FinalRecapStep.tsx) — 78-150, 3 cas rendu
- [lib/recap/calculations.ts](../../lib/recap/calculations.ts) — `computeRecapSummary` (peut nécessiter extension)

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Modifier `lib/recap/actions-finalize.ts::executeCompleteRecap`

Après l'appel `finalize_recap_apply_snapshot` (budgets) — pattern fail-soft logged — ajouter l'invocation de `apply_recap_projects_snapshot` :

```ts
const projectSnapshot = coerceSnapshot(recap.project_snapshot_data)
if (projectSnapshot !== null) {
  const { error } = await supabaseServer.rpc('apply_recap_projects_snapshot', {
    p_recap_id: recapId,
    p_allocations: projectSnapshot ?? {},
  })
  if (error) logger.error('apply_recap_projects_snapshot failed', { error, recapId })
  // fail-soft : continue le flow finalize même si snapshot fail
}
```

**Important** : il y a aussi le cas "pas de refloat projet" → on doit quand même incrémenter `amount_saved += monthly_allocation` pour chaque projet actif. La RPC du sprint 01 doit itérer sur **TOUS les projets actifs de l'owner** (pas juste ceux du snapshot). Pour ceux pas dans le snapshot : `refund=0`, donc `amount_saved += monthly_allocation`, `frac_added = 0`, deadline inchangée.

### 2. ~~Migration de correction~~ — non nécessaire ✅

> **Note** : la RPC `apply_recap_projects_snapshot` livrée au sprint 01 itère DÉJÀ sur tous les projets de l'owner (résolu via `monthly_recaps.profile_id|group_id`, boucle `FOR UPDATE`). Cette tâche est obsolète — passer directement à la tâche 3.
>
> Squelette SQL conservé ci-dessous à titre de référence si une future correction d'algorithme est nécessaire (`CREATE OR REPLACE`).

```sql
CREATE OR REPLACE FUNCTION apply_recap_projects_snapshot(
  p_recap_id UUID,
  p_allocations JSONB
) RETURNS JSON AS $$
DECLARE
  v_owner_profile UUID;
  v_owner_group UUID;
  v_project RECORD;
  v_refund NUMERIC;
  v_frac_added NUMERIC;
  v_new_pending NUMERIC;
  v_months_shift INT;
  v_total_refunded NUMERIC := 0;
  v_updated_count INT := 0;
BEGIN
  -- Resolve owner from recap
  SELECT profile_id, group_id INTO v_owner_profile, v_owner_group
  FROM monthly_recaps WHERE id = p_recap_id;

  -- Iterate on ALL active projects of the owner
  FOR v_project IN
    SELECT id, monthly_allocation, pending_delay_fraction, deadline_date
    FROM savings_projects
    WHERE (profile_id = v_owner_profile OR group_id = v_owner_group)
    FOR UPDATE
  LOOP
    -- Lookup refund from allocations (default 0)
    v_refund := COALESCE((p_allocations ->> v_project.id::text)::numeric, 0);
    v_frac_added := v_refund / v_project.monthly_allocation;
    v_new_pending := v_project.pending_delay_fraction + v_frac_added;
    v_months_shift := FLOOR(v_new_pending);

    UPDATE savings_projects SET
      amount_saved = amount_saved + (monthly_allocation - v_refund),
      deadline_date = deadline_date + (INTERVAL '1 month' * v_months_shift),
      pending_delay_fraction = v_new_pending - v_months_shift,
      updated_at = now()
    WHERE id = v_project.id;

    v_total_refunded := v_total_refunded + v_refund;
    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN json_build_object(
    'updated_count', v_updated_count,
    'total_refunded', v_total_refunded
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION apply_recap_projects_snapshot(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_recap_projects_snapshot(UUID, JSONB) TO service_role;
NOTIFY pgrst, 'reload schema';
```

Appliquer + repair + re-export baseline.

### 3. Update FinalRecapStep — `components/monthly-recap/steps/FinalRecapStep.tsx`

- Lire `project_snapshot_data` + agrégat projets après finalize
- Section "Projets" si projets actifs :
  - "💰 N projet(s) ont reçu leur allocation mensuelle ce mois"
  - Si refloat > 0 : "📋 Renflouement projets : -X€" + détail "{name} : -Y€ → décalage de Z mois" (si months_shift > 0)
- Cohérent avec les 3 cas existants (pos pure, cascade, neg pure).

### 4. Update `lib/recap/calculations.ts::computeRecapSummary`

- Étendre `RecapSummary` avec `projectSnapshot?: ProjectSnapshotSummary`
- `ProjectSnapshotSummary = { totalSaved: number; totalRefunded: number; shifted: Array<{ name, monthsShift }> }`
- Calc pure depuis `input.projects + input.projectSnapshotData`

### 5. Tests gated — `lib/recap/__tests__/actions-finalize-projects.test.ts` (`SUPABASE_RECAP_TESTS=1`)

- Cas 1 : finalize sans refloat → tous projets `amount_saved += monthly`, deadline inchangée
- Cas 2 : refloat partiel 30€ sur projet 100€/mois → `amount_saved += 70€`, `pending_delay_fraction += 0.3`, deadline inchangée
- Cas 3 : refloat total 100€ sur projet 100€/mois → `amount_saved += 0€`, `pending = 0`, deadline +1 mois
- Cas 4 : accumulation de 4 mois × 30€ refloat partiel → mois 4 shift de 1 (cumul 1.2 > 1)
- Cas 5 : 0 projet → no-op (count = 0)

### 6. Tests RTL — `components/monthly-recap/steps/__tests__/FinalRecapStep-projects.test.tsx`

- Cas 1 : section "Projets" affiche N projets avec `amount_saved` monthly
- Cas 2 : refloat affiché avec décalage
- Cas 3 : aucun projet → section masquée

### 7. Vérifications

```powershell
pnpm db:check-rpcs                                  # exit 0
pnpm db:audit-functions                             # clean
pnpm db:check-types-fresh                           # exit 0
$env:SUPABASE_RECAP_TESTS = '1'; pnpm test:run      # tous passent
```

`pnpm dev` : faire un recap complet bilan négatif avec refloat projets → vérifier que la finalize incrémente correctement.

`pnpm verify` exit 0

### 8. Commit

```
feat(recap): apply projects snapshot atomically + final summary
```

## Acceptance criteria

- Après finalize d'un recap : pour chaque projet `amount_saved += monthly - refund` ; deadline shifted si cumul fractionnaire ≥ 1.
- Écran FinalRecap affiche un résumé clair des projets touchés.
- Pattern fail-soft : finalize complète même si projets snapshot fail (log only).
- 0 régression sur la finalize sans projets.

## Hors scope

- Seeds nouveau scenario (sprint 11).
- Push prod (sprint 11).
