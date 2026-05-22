import type { ZodType } from 'zod'

import {
  addExpenseWithLogicBodySchema,
  contextOnlyQuerySchema,
  createBudgetBodySchema,
  createEstimatedBudgetBodySchema,
  createEstimatedIncomeBodySchema,
  createGroupBodySchema,
  createIncomeBodySchema,
  createProfileBodySchema,
  createRealExpenseBodySchema,
  createRealIncomeBodySchema,
  deleteByIdQuerySchema,
  estimatedListQuerySchema,
  previewBreakdownQuerySchema,
  progressQuerySchema,
  searchGroupsQuerySchema,
  sessionActionBodySchema,
  summaryQuerySchema,
  transferSavingsBodySchema,
  updateBankBalanceBodySchema,
  updateBudgetBodySchema,
  updateEstimatedBudgetBodySchema,
  updateEstimatedIncomeBodySchema,
  updateGroupBodySchema,
  updateIncomeBodySchema,
  updateProfileBodySchema,
  updateRealExpenseBodySchema,
  updateRealIncomeBodySchema,
} from '@/lib/schemas'

export type HttpMethod = 'get' | 'post' | 'put' | 'delete'

export interface RouteDef {
  /** OpenAPI path with `{param}` segments (e.g. `/api/groups/{id}`). */
  path: string
  method: HttpMethod
  /** One-line summary shown in Swagger UI. */
  summary: string
  /** Tag (single, used for grouping in Swagger UI). */
  tag: string
  /** Schema for JSON request body (POST/PUT). */
  bodySchema?: ZodType
  /** Schema for URL query string (GET/DELETE with params). */
  querySchema?: ZodType
  /** Names of `{param}` segments in `path` (auto-typed as string in OpenAPI). */
  pathParams?: string[]
  /** Whether the route returns 401 on missing session (true for everything except debug). */
  requiresAuth?: boolean
}

/**
 * Single source of truth for the OpenAPI 3.1 doc. Add a row when you add a
 * route under `app/api/**` or a handler under `lib/api/finance/**`.
 *
 * Debug routes (`app/api/debug/**`) are intentionally omitted — they are
 * gated by `blockInProduction()` (404 in prod) and exposing them adds
 * marginal DX value while widening the public surface.
 */
export const routes: RouteDef[] = [
  // ─── Auth ─────────────────────────────────────────────────────────────────
  {
    path: '/api/auth/session',
    method: 'post',
    tag: 'auth',
    summary: 'Login, refresh, or logout (discriminated by `action` literal)',
    bodySchema: sessionActionBodySchema,
    requiresAuth: false,
  },

  // ─── Profile ──────────────────────────────────────────────────────────────
  {
    path: '/api/profile',
    method: 'get',
    tag: 'profile',
    summary: 'Get current user profile (returns `{ profile: null }` if not yet created)',
    requiresAuth: true,
  },
  {
    path: '/api/profile',
    method: 'post',
    tag: 'profile',
    summary: 'Create profile (first-time user)',
    bodySchema: createProfileBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/profile',
    method: 'put',
    tag: 'profile',
    summary: 'Update profile (partial — at least one field)',
    bodySchema: updateProfileBodySchema,
    requiresAuth: true,
  },

  // ─── Bank balance ─────────────────────────────────────────────────────────
  {
    path: '/api/bank-balance',
    method: 'get',
    tag: 'bank-balance',
    summary: 'Get current bank balance for context (profile or group)',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/bank-balance',
    method: 'post',
    tag: 'bank-balance',
    summary: 'Update bank balance (overdraft accepted)',
    bodySchema: updateBankBalanceBodySchema,
    requiresAuth: true,
  },

  // ─── Groups ───────────────────────────────────────────────────────────────
  {
    path: '/api/groups',
    method: 'get',
    tag: 'groups',
    summary: 'List groups for current user (always 1 in current product scope)',
    requiresAuth: true,
  },
  {
    path: '/api/groups',
    method: 'post',
    tag: 'groups',
    summary: 'Create new group + auto-add creator as member',
    bodySchema: createGroupBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/groups/{id}',
    method: 'put',
    tag: 'groups',
    summary: 'Update group (creator-only) — partial, at least one field',
    bodySchema: updateGroupBodySchema,
    pathParams: ['id'],
    requiresAuth: true,
  },
  {
    path: '/api/groups/{id}',
    method: 'delete',
    tag: 'groups',
    summary: 'Delete group (creator-only) — cascades members + contributions',
    pathParams: ['id'],
    requiresAuth: true,
  },
  {
    path: '/api/groups/{id}/members',
    method: 'get',
    tag: 'groups',
    summary: 'List members of a group (must be a member)',
    pathParams: ['id'],
    requiresAuth: true,
  },
  {
    path: '/api/groups/{id}/members',
    method: 'post',
    tag: 'groups',
    summary: 'Join group (current user becomes a member)',
    pathParams: ['id'],
    requiresAuth: true,
  },
  {
    path: '/api/groups/{id}/members',
    method: 'delete',
    tag: 'groups',
    summary: 'Leave group (current user removed)',
    pathParams: ['id'],
    requiresAuth: true,
  },
  {
    path: '/api/groups/contributions',
    method: 'get',
    tag: 'groups',
    summary: 'Get contribution computation for current user’s group',
    requiresAuth: true,
  },
  {
    path: '/api/groups/contributions',
    method: 'post',
    tag: 'groups',
    summary: 'Manually trigger recomputation of group contributions',
    requiresAuth: true,
  },
  {
    path: '/api/groups/search',
    method: 'get',
    tag: 'groups',
    summary: 'Search groups by name (autocomplete)',
    querySchema: searchGroupsQuerySchema,
    requiresAuth: true,
  },

  // ─── Savings ──────────────────────────────────────────────────────────────
  {
    path: '/api/savings/data',
    method: 'get',
    tag: 'savings',
    summary: 'Get aggregated savings (sum of budgets cumulated_savings + piggy_bank)',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/savings/transfer',
    method: 'post',
    tag: 'savings',
    summary: 'Atomic transfer (budget→budget OR budget→piggy_bank, discriminated by action)',
    bodySchema: transferSavingsBodySchema,
    requiresAuth: true,
  },

  // ─── Finance — budgets ───────────────────────────────────────────────────
  {
    path: '/api/finance/budgets',
    method: 'post',
    tag: 'finance/budgets',
    summary: 'Create estimated budget',
    bodySchema: createBudgetBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets',
    method: 'put',
    tag: 'finance/budgets',
    summary: 'Update estimated budget (full-replacement on name + amount)',
    bodySchema: updateBudgetBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets',
    method: 'delete',
    tag: 'finance/budgets',
    summary: 'Delete estimated budget',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets/estimated',
    method: 'get',
    tag: 'finance/budgets',
    summary: 'List estimated budgets (profile or group via `?group=true`)',
    querySchema: estimatedListQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets/estimated',
    method: 'post',
    tag: 'finance/budgets',
    summary: 'Create estimated budget (snake_case body — v1 contract)',
    bodySchema: createEstimatedBudgetBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets/estimated',
    method: 'put',
    tag: 'finance/budgets',
    summary: 'Update estimated budget — partial, at least one field',
    bodySchema: updateEstimatedBudgetBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/budgets/estimated',
    method: 'delete',
    tag: 'finance/budgets',
    summary: 'Delete estimated budget (snake_case)',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },

  // ─── Finance — incomes ───────────────────────────────────────────────────
  {
    path: '/api/finance/incomes',
    method: 'get',
    tag: 'finance/incomes',
    summary: 'List estimated incomes for context',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/incomes',
    method: 'post',
    tag: 'finance/incomes',
    summary: 'Create estimated income',
    bodySchema: createIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/incomes',
    method: 'put',
    tag: 'finance/incomes',
    summary: 'Update estimated income (full-replacement)',
    bodySchema: updateIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/incomes',
    method: 'delete',
    tag: 'finance/incomes',
    summary: 'Delete estimated income',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/estimated',
    method: 'get',
    tag: 'finance/incomes',
    summary: 'List estimated incomes (snake_case variant — `?group=true`)',
    querySchema: estimatedListQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/estimated',
    method: 'post',
    tag: 'finance/incomes',
    summary: 'Create estimated income (snake_case)',
    bodySchema: createEstimatedIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/estimated',
    method: 'put',
    tag: 'finance/incomes',
    summary: 'Update estimated income (partial)',
    bodySchema: updateEstimatedIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/estimated',
    method: 'delete',
    tag: 'finance/incomes',
    summary: 'Delete estimated income',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/real',
    method: 'get',
    tag: 'finance/incomes',
    summary: 'List real income entries for context',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/real',
    method: 'post',
    tag: 'finance/incomes',
    summary: 'Add real income entry (auto-tied to estimated_income or exceptional)',
    bodySchema: createRealIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/real',
    method: 'put',
    tag: 'finance/incomes',
    summary: 'Update real income entry (partial)',
    bodySchema: updateRealIncomeBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/real',
    method: 'delete',
    tag: 'finance/incomes',
    summary: 'Delete real income entry',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/income/progress',
    method: 'get',
    tag: 'finance/incomes',
    summary: 'Per-income aggregated progress (estimated vs real)',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },

  // ─── Finance — expenses ──────────────────────────────────────────────────
  {
    path: '/api/finance/expenses/real',
    method: 'get',
    tag: 'finance/expenses',
    summary: 'List real expenses for context',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/real',
    method: 'post',
    tag: 'finance/expenses',
    summary: 'Add real expense (no breakdown — use add-with-logic for piggy/savings cascade)',
    bodySchema: createRealExpenseBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/real',
    method: 'put',
    tag: 'finance/expenses',
    summary: 'Update real expense (partial)',
    bodySchema: updateRealExpenseBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/real',
    method: 'delete',
    tag: 'finance/expenses',
    summary: 'Delete real expense (reverses piggy/savings allocation)',
    querySchema: deleteByIdQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/add-with-logic',
    method: 'post',
    tag: 'finance/expenses',
    summary: 'Atomic add-expense with piggy → savings → budget cascade (composite RPC)',
    bodySchema: addExpenseWithLogicBodySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/preview-breakdown',
    method: 'get',
    tag: 'finance/expenses',
    summary: 'Preview piggy/savings/budget split without writing (P5 toggle aware)',
    querySchema: previewBreakdownQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/expenses/progress',
    method: 'get',
    tag: 'finance/expenses',
    summary: 'Per-budget aggregated progress (estimated vs real, period-filtered)',
    querySchema: progressQuerySchema,
    requiresAuth: true,
  },

  // ─── Finance — global ────────────────────────────────────────────────────
  {
    path: '/api/finance/rav',
    method: 'get',
    tag: 'finance',
    summary: 'Reste-à-Vivre (current value, no recompute)',
    querySchema: contextOnlyQuerySchema,
    requiresAuth: true,
  },
  {
    path: '/api/finance/summary',
    method: 'get',
    tag: 'finance',
    summary: 'Full FinancialData summary (RAV, savings, balance, incomes, expenses, deficits)',
    querySchema: summaryQuerySchema,
    requiresAuth: true,
  },
]
