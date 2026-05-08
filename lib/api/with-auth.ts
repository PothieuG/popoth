import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validateSessionToken } from '@/lib/session-server'
import { supabaseServer } from '@/lib/supabase-server'

// Wrappers for finance route handlers under lib/api/finance/*.
//
// Two helpers (not one with options) so the 8 conditional-fetch handlers
// (which only need the profile when context === 'group') don't pay for an
// unconditional profile lookup that the 4 always-fetch handlers do need.
//
// Why no try/catch in the wrapper: each handler keeps its own route-aware
// console.error('... /api/finance/X:', error). Centralizing here would also
// override summary.ts's deliberate 200-with-default-data fallback. The
// console-cleanup chantier will sweep the per-handler logs later.

export interface AuthedContext {
  userId: string
}

export interface AuthedProfile {
  id: string
  group_id: string | null
  first_name: string | null
  last_name: string | null
}

export interface AuthedProfileContext {
  userId: string
  profile: AuthedProfile
}

export type RouteContext<TParams = Record<string, string>> = {
  params: Promise<TParams>
}

type AuthedHandler<TParams> = (
  request: NextRequest,
  ctx: AuthedContext,
  routeContext?: RouteContext<TParams>
) => Promise<NextResponse>

type AuthedProfileHandler<TParams> = (
  request: NextRequest,
  ctx: AuthedProfileContext,
  routeContext?: RouteContext<TParams>
) => Promise<NextResponse>

export function withAuth<TParams = Record<string, string>>(
  handler: AuthedHandler<TParams>
): (request: NextRequest, routeContext?: RouteContext<TParams>) => Promise<NextResponse> {
  return async (request, routeContext) => {
    const session = await validateSessionToken(request)
    if (!session?.userId) {
      return NextResponse.json({ error: 'Session invalide' }, { status: 401 })
    }
    return handler(request, { userId: session.userId }, routeContext)
  }
}

export function withAuthAndProfile<TParams = Record<string, string>>(
  handler: AuthedProfileHandler<TParams>
): (request: NextRequest, routeContext?: RouteContext<TParams>) => Promise<NextResponse> {
  return async (request, routeContext) => {
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
