# Sprint 08 — Recap backend : refloat from projects (snapshot deferred)

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet — spécifiquement la section 5.2 "Cas BILAN < 0 : renflouement du déficit".

## Objectif

Ajouter un endpoint `POST /api/monthly-recap/refloat-from-projects` qui calcule une allocation proportionnelle des projets actifs et stocke le résultat dans un nouveau JSONB `monthly_recaps.project_snapshot_data` (deferred — appliqué à la finalize du recap au sprint 10).

## Décision clé

**Le pool de chaque projet = `monthly_allocation`** (sa mensualité du mois — pas l'`amount_saved` cumulé). Cela traduit "renoncer temporairement à l'épargne mensuelle d'un projet pour combler le déficit".

## Pré-lecture obligatoire

- [lib/recap/actions-negative.ts](../../lib/recap/actions-negative.ts) — `executeRefloatFromSavings` + `executeSaveBudgetSnapshot` (patterns à mimer)
- [lib/recap/calculations.ts](../../lib/recap/calculations.ts) — `distributeProportional` + `computeProportionalSavingsRefloat`
- [lib/recap/deficit-math.ts](../../lib/recap/deficit-math.ts) — `computeDeficitRemaining` + `coerceSnapshot`
- [lib/schemas/recap.ts](../../lib/schemas/recap.ts) — `refloatFromSavingsBodySchema` (pattern Zod)
- Sprint 01 — les RPCs sont déjà créées (`apply_recap_projects_snapshot` appliqué au sprint 10)

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Migration — `supabase/migrations/<TS>_add_project_snapshot_column.sql`

```sql
ALTER TABLE monthly_recaps
  ADD COLUMN project_snapshot_data JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN monthly_recaps.project_snapshot_data IS
  'JSONB { [project_id]: refund_amount } — appliqué à la finalize.';
NOTIFY pgrst, 'reload schema';
```

Appliquer + repair + re-export baseline + regen types :

```powershell
node scripts/apply-sql.mjs supabase/migrations/<TS>_add_project_snapshot_column.sql
pnpm supabase migration repair --status applied <TS>
node scripts/export-schema.mjs supabase/migrations/20260101000000_remote_schema.sql
pnpm db:types
```

### 2. Calc pure — `lib/recap/calculations.ts`

```ts
export function computeProportionalProjectsRefloat(
  targetAmount: number,
  projects: ReadonlyArray<{ projectId: string; monthlyAllocation: number }>,
): RefloatProportionalAllocation {
  return distributeProportional(
    targetAmount,
    projects.map((p) => ({ budgetId: p.projectId, pool: p.monthlyAllocation })),
  )
}
```

Réutilise `distributeProportional` (moteur stable, percent-precise). Le `pool = monthly_allocation` parce qu'un projet ne peut donner que sa mensualité du mois (pas son `amount_saved` cumulé).

### 3. Action helper — `lib/recap/actions-negative.ts::executeRefloatFromProjects(filter, recapId)`

Mirror `executeSaveBudgetSnapshot` :

1. Read recap row (`current_step`, `bilan`, `refloated_from_piggy`, `refloated_from_savings`, `budget_snapshot_data`) → calc `deficitRemaining`
2. Read projets actifs depuis `savings_projects` (filter owner)
3. Call `computeProportionalProjectsRefloat(deficitRemaining, projects)`
4. Build `Record<string, number>` (`projectId → amount`)
5. UPDATE `monthly_recaps SET project_snapshot_data = ...`
6. Return `{ allocation, deficitAfter }`

Raise `RecapActionError` si rien à allouer (`totalPool == 0`) avec code `'no-projects-available'`.

### 4. Zod schema — `lib/schemas/recap.ts`

```ts
export const refloatFromProjectsBodySchema = z.object({ context: contextSchema })
```

### 5. Route — `app/api/monthly-recap/refloat-from-projects/route.ts` (mirror refloat-from-savings)

- `withAuthAndProfile`
- `parseBody(req, refloatFromProjectsBodySchema)`
- Call `executeRefloatFromProjects(filter, recapId)`
- Return 200 `{ data: { allocation, deficitAfter } }`

### 6. Update `computeDeficitRemaining` — `lib/recap/deficit-math.ts`

- Étendre l'input avec `projectSnapshotData?: Record<string, number> | null`
- Soustraire `sumSnapshotValues(projectSnapshotData)` au déficit restant
- Update `coerceSnapshot` ou ajouter `coerceProjectSnapshot` (probablement identique — réutiliser)

### 7. Update consumers

- [lib/recap/load-summary.ts](../../lib/recap/load-summary.ts) ou tout module lisant le déficit live → passer `project_snapshot_data` à `computeDeficitRemaining`
- [lib/recap/actions-finalize.ts](../../lib/recap/actions-finalize.ts) — pas de modif ici (sprint 10 modifiera la finalize pour appliquer le snapshot projets)

### 8. Tests gated — `app/api/monthly-recap/__tests__/refloat-from-projects.test.ts` (`SUPABASE_RECAP_TESTS=1`)

- Cas 1 : 2 projets 100€ + 50€, déficit 60€ → allocation `{ p1: 40, p2: 20 }` proportionnel
- Cas 2 : déficit > total `monthly_allocation` → allocation totale + shortfall
- Cas 3 : 0 projet → `'no-projects-available'`
- Cas 4 : déficit déjà couvert par piggy + savings → noop (`deficit = 0`)

### 9. Vérifications

```powershell
pnpm db:check-drift          # exit 0
pnpm db:check-rpcs           # exit 0
pnpm db:check-types-fresh    # exit 0
$env:SUPABASE_RECAP_TESTS = '1'; pnpm test:run    # les 4 cas passent
pnpm verify                  # exit 0
```

### 10. Commit

```
feat(recap): refloat-from-projects endpoint + project_snapshot_data JSONB
```

## Acceptance criteria

- `POST /api/monthly-recap/refloat-from-projects` calcule + stocke le snapshot.
- `monthly_recaps.project_snapshot_data` populated après l'appel.
- `computeDeficitRemaining` inclut le snapshot projet.
- 0 régression sur les tests `refloat-from-savings` existants.

## Hors scope

- UI cascade (sprint 09).
- Finalize application (sprint 10).
