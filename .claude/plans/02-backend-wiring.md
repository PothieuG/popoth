# Sprint 02 — Backend wiring (schemas + helpers + API + hook)

> ✅ **LIVRÉ 2026-05-26** sur branche `feature/projets-epargne`, commit `93cdf61`. Détails closeout → [Part 29](../history/roadmap-detailed-29-projets-epargne.md). 5 modules nouveaux (`lib/schemas/projects.ts`, `lib/finance/projects.ts`, `lib/api/finance/projects.ts`, `app/api/finance/projects/[route.ts,(id)/route.ts]`, `hooks/useProjects.ts`) + 4 tests gated `SUPABASE_FINANCE_TESTS=1` (4/4 pass). `invalidateFinancialRefreshes` étendu 8 → 9 keys. Routes API 41 → 43.

> ⚠️ **Avant toute chose, relire la spec originale : [`.claude/plans/00-Readme.md`](./00-Readme.md)** pour avoir le contexte produit complet.

## Objectif

Wirer la table `savings_projects` (Sprint 01) à l'app : Zod schemas, helpers atomic TS, routes API REST, hook TanStack Query. Aucune UI (sprint 04+).

## Pré-lecture obligatoire

- [lib/schemas/budget.ts](../../lib/schemas/budget.ts) — pattern `createBudgetBodySchema` + factory
- [lib/finance/piggy-bank.ts](../../lib/finance/piggy-bank.ts) — pattern wrapper RPC + ensure-row helper
- [lib/api/finance/budgets-estimated.ts](../../lib/api/finance/budgets-estimated.ts) — pattern handler CRUD avec `withAuthAndProfile`
- [hooks/useBudgets.ts](../../hooks/useBudgets.ts) — pattern hook avec queryKey + `invalidateFinancialRefreshes`
- [.claude/conventions/zod-patterns.md](../conventions/zod-patterns.md) §2 (parseBody + handleBadRequest)

## Pré-requis

```powershell
git checkout feature/projets-epargne
$env:SUPABASE_PROJECT_REF = 'ddehmjucyfgyppfkbddr'
```

## Tâches

### 1. Zod schemas — `lib/schemas/projects.ts`

```ts
import { z } from 'zod'
import { contextSchema, isoDateSchema, moneyFormSchema, moneySchema, uuidSchema } from './common'

const projectNameSchema = z
  .string()
  .trim()
  .min(2, 'Le nom du projet est requis (minimum 2 caractères)')

export const createProjectBodySchema = z.object({
  name: projectNameSchema,
  targetAmount: moneySchema,
  monthlyAllocation: moneySchema,
  deadlineDate: isoDateSchema,
})
export const updateProjectBodySchema = createProjectBodySchema // full-replace

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>

// Factory client — mirror makeBudgetClientSchema avec deux refines :
// 1. RAV reste ≥ 0 (newAllocatedTotal ≤ totalEstimatedIncome)
// 2. monthlyAllocation × monthsUntilDeadline ≥ targetAmount - amountSaved (cohérence)
export function makeProjectClientSchema(opts: {
  currentAllocatedTotal: number // SUM(budgets) + SUM(autres projets) (cf. sprint 03 RAV)
  totalEstimatedIncome: number
  currentProjectAllocation?: number // edit case
  amountSaved?: number // edit case
}) {
  // ... refine RAV + refine cohérence durée/target
}
```

### 2. Helpers TS atomic — `lib/finance/projects.ts` (mirror piggy-bank.ts)

```ts
export async function createSavingsProject(
  filter: ContextFilter,
  args: { name: string; targetAmount: number; monthlyAllocation: number; deadlineDate: string },
): Promise<SavingsProjectRow>

export async function updateSavingsProject(
  filter: ContextFilter,
  args: {
    id: string
    name: string
    targetAmount: number
    monthlyAllocation: number
    deadlineDate: string
  },
): Promise<SavingsProjectRow>

export async function deleteSavingsProjectToPiggy(
  filter: ContextFilter,
  projectId: string,
): Promise<{ transferredAmount: number; piggyAmount: number }>

export async function listSavingsProjects(filter: ContextFilter): Promise<SavingsProjectRow[]>
```

Chacun invoque la RPC correspondante via `supabaseServer.rpc(...)`.

### 3. Handler API — `lib/api/finance/projects.ts`

- **GET** (list) — `withAuthAndProfile(async ({ userId, profile }, req) => ...)`. Query `?group=true` → context group.
- **POST** (create) — `parseBody(req, createProjectBodySchema)` + `handleBadRequest`.
- **PUT** (update by id) — `parseBody(req, updateProjectBodySchema)`. Routes dyn `/api/finance/projects/[id]`.
- **DELETE** (by id) — `parseQuery(req, deleteByIdQuerySchema)`. Snackbar payload `{ transferredAmount }`.

### 4. Routes Next.js

- `app/api/finance/projects/route.ts` → re-export GET + POST
- `app/api/finance/projects/[id]/route.ts` → re-export PUT + DELETE

### 5. Hook — `hooks/useProjects.ts` (mirror useBudgets)

- QueryKey : `['projects', context ?? null]`
- Mutations : `addProject`, `updateProject`, `deleteProject`
- Invalidation : `invalidateFinancialRefreshes(queryClient)`
- Exports : `{ projects, loading, isFetching, error, addProject, updateProject, deleteProject, refreshProjects, totalMonthlyAllocations }`

### 6. `invalidateFinancialRefreshes` — `lib/query-client.ts`

Ajouter `['projects']` à la liste (9 keys au total).

### 7. Tests gated — `lib/api/finance/__tests__/projects-rpc.test.ts` (`SUPABASE_FINANCE_TESTS=1`)

4 cas :

- create → list
- update
- delete → piggy crédité
- ownership cross-user → forbidden

### 8. Vérifications

```powershell
pnpm typecheck                                       # exit 0
pnpm lint:check                                      # exit 0
$env:SUPABASE_FINANCE_TESTS = '1'; pnpm test:run     # les 4 nouveaux passent
pnpm verify                                          # exit 0
```

### 9. Commit

```
feat(projects): backend wiring (schemas + helpers + API + hook)
```

## Acceptance criteria

- 4 endpoints REST opérationnels (test via curl ou Thunder Client).
- Hook `useProjects` observable via React DevTools sur une page test.
- `invalidateFinancialRefreshes` inclut `['projects']`.
- 4 tests gated passent.

## Hors scope

- Aucun changement de RAV (sprint 03).
- Aucune UI (sprint 04+).
