import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

// Wrappers for finance route handlers under lib/api/finance/* and Volet C routes
// (savings, bank-balance, profile, groups, monthly-recap hors process-step1).
//
// Two helpers (not one with options) so the conditional-fetch handlers
// (which only need the profile when context === 'group') don't pay for an
// unconditional profile lookup that the always-fetch handlers do need.
//
// Why no try/catch in the wrapper: each handler keeps its own route-aware
// console.error('... /api/X:', error). Centralizing here would also
// override summary.ts's deliberate 200-with-default-data fallback. The
// console-cleanup chantier will sweep the per-handler logs later.
//
// Sprint v5 (2026-05-09) added overloads so dynamic-route handlers no longer
// need `routeContext!.params` — when TParams is supplied, routeContext is
// non-optional in both the handler signature and the wrapper return type.

/**
 * Session context passed to handlers wrapped with `withAuth`.
 */
export interface AuthedContext {
  userId: string
}

/**
 * Profile shape projected by `withAuthAndProfile`. Fields match the wrapper's
 * `select('id, group_id, first_name, last_name')`.
 */
export interface AuthedProfile {
  id: string
  group_id: string | null
  first_name: string | null
  last_name: string | null
}

/**
 * Combined session + profile context passed to handlers wrapped with
 * `withAuthAndProfile`.
 */
export interface AuthedProfileContext {
  userId: string
  profile: AuthedProfile
}

/**
 * The 2nd argument Next.js App Router passes to dynamic route handlers
 * (`app/api/.../[id]/route.ts`). `params` is a Promise — must be awaited.
 */
export type RouteContext<TParams = Record<string, string>> = {
  params: Promise<TParams>
}

/**
 * Wraps a route handler with session validation. Calls the handler with
 * `{ userId }` if the session cookie is valid; returns 401 +
 * `{ error: 'Session invalide' }` otherwise.
 *
 * Use for **auth-only handlers** (e.g. profile POST/PUT, groups [id] PUT/DELETE)
 * OR for **conditional-fetch handlers** that lazy-load the profile inside the
 * body when `forGroup` / `context==='group'` (matches the pattern of finance
 * `expenses-real`, `expenses-add-with-logic`, etc.).
 *
 * The wrapper does NOT catch handler errors — each handler keeps its own
 * route-aware `try/catch` with `console.error('... /api/X:', error)`.
 *
 * @param handler - The async route handler. Receives `(request, { userId })`
 *   for static routes, or `(request, { userId }, routeContext)` for dynamic
 *   routes when `TParams` is supplied (overload 2). `routeContext.params` is
 *   a Promise that must be awaited.
 * @returns A Next.js route handler. For static routes, takes only `request`.
 *   For dynamic routes (TParams supplied), takes `(request, routeContext)`.
 *
 * @example Static route (auth-only)
 * export const POST = withAuth(async (request, { userId }) => {
 *   const body = await request.json()
 *   return NextResponse.json({ data: ... })
 * })
 *
 * @example Conditional-fetch (lazy profile in the body)
 * export const GET = withAuth(async (request, { userId }) => {
 *   const url = new URL(request.url)
 *   if (url.searchParams.get('forGroup') === 'true') {
 *     const { data: profile } = await supabaseServer.from('profiles')
 *       .select('group_id').eq('id', userId).single()
 *     // ... group-scoped query
 *   }
 *   return NextResponse.json({ data: ... })
 * })
 *
 * @example Dynamic route — no `!` needed thanks to overload
 * interface RouteParams { id: string }
 * export const DELETE = withAuth<RouteParams>(async (_request, { userId }, routeContext) => {
 *   const { id } = await routeContext.params
 *   return NextResponse.json({ deleted: id })
 * })
 */
export function withAuth(
  handler: (request: NextRequest, ctx: AuthedContext) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse>
export function withAuth<TParams>(
  handler: (
    request: NextRequest,
    ctx: AuthedContext,
    routeContext: RouteContext<TParams>,
  ) => Promise<NextResponse>,
): (request: NextRequest, routeContext: RouteContext<TParams>) => Promise<NextResponse>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- impl signature behind overloads; required-vs-optional routeContext can't be reconciled in a single typed signature, so the impl is opaque to callers (overloads above enforce the call-site types)
export function withAuth(handler: any): any {
  return async (request: NextRequest, routeContext?: RouteContext) => {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }
    return handler(request, { userId: session.userId }, routeContext)
  }
}

/**
 * Wraps a route handler with session validation AND profile fetch. Calls the
 * handler with `{ userId, profile }` if both succeed. Returns 401 +
 * `{ error: 'Session invalide' }` on missing/invalid session, or 404 +
 * `{ error: 'Profil non trouvé' }` on missing profile (the wrapper conflates
 * `error || !profile` since either case is a non-recoverable 404 for the caller).
 *
 * Profile shape: `{ id, group_id, first_name, last_name }` — projected by
 * `select('id, group_id, first_name, last_name')` against `public.profiles`.
 *
 * Use for **always-fetch handlers** that need profile data on every request
 * (e.g. budgets, incomes, summary, all groups/[id]/members handlers, all
 * monthly-recap simple/stateful routes). The wrapper does NOT catch handler
 * errors — each handler keeps its own route-aware `try/catch`.
 *
 * @param handler - The async route handler. Receives `(request, { userId, profile })`
 *   for static routes, or `(request, { userId, profile }, routeContext)` for
 *   dynamic routes when `TParams` is supplied (overload 2).
 * @returns A Next.js route handler. For static routes, takes only `request`.
 *   For dynamic routes (TParams supplied), takes `(request, routeContext)`.
 *
 * @example Static route
 * export const GET = withAuthAndProfile(async (request, { userId, profile }) => {
 *   if (!profile.group_id) return NextResponse.json({ error: '...' }, { status: 400 })
 *   return NextResponse.json({ data: ... })
 * })
 *
 * @example Dynamic route — no `!` needed thanks to overload
 * interface RouteParams { id: string }
 * export const POST = withAuthAndProfile<RouteParams>(
 *   async (_request, { profile }, routeContext) => {
 *     const { id } = await routeContext.params
 *     if (profile.group_id !== id) return NextResponse.json({ error: '...' }, { status: 403 })
 *     return NextResponse.json({ data: ... })
 *   }
 * )
 */
export function withAuthAndProfile(
  handler: (request: NextRequest, ctx: AuthedProfileContext) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse>
export function withAuthAndProfile<TParams>(
  handler: (
    request: NextRequest,
    ctx: AuthedProfileContext,
    routeContext: RouteContext<TParams>,
  ) => Promise<NextResponse>,
): (request: NextRequest, routeContext: RouteContext<TParams>) => Promise<NextResponse>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- impl signature behind overloads; required-vs-optional routeContext can't be reconciled in a single typed signature, so the impl is opaque to callers (overloads above enforce the call-site types)
export function withAuthAndProfile(handler: any): any {
  return async (request: NextRequest, routeContext?: RouteContext) => {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }
    const { data: profile, error } = await supabaseServer
      .from('profiles')
      .select('id, group_id, first_name, last_name')
      .eq('id', session.userId)
      .single()
    if (error || !profile) {
      return NextResponse.json({ error: 'Profil non trouvé' }, { status: 404 })
    }
    return handler(request, { userId: session.userId, profile }, routeContext)
  }
}
