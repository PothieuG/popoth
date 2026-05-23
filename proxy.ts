import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'
import { logger } from '@/lib/logger'
import { checkRecapStatus, RecapStatusError, type RecapContext } from '@/lib/recap/check-status'
import { isRecapBlocking } from '@/lib/recap/lock'

// Define protected and public routes
const protectedRoutes = ['/dashboard', '/profile', '/group-dashboard', '/dev']
const authRoutes = [
  '/connexion',
  '/inscription',
  '/forgot-password',
  '/reset-password',
  '/auth/confirm',
  '/auth/auth-code-error',
]

// Sprint 05 Monthly Recap V3 — routes gated par le state machine recap.
// Seuls les 2 dashboards sont blockés tant que le recap du mois n'est pas
// terminé. /profile et /dev restent accessibles librement (le user peut
// régler son compte ou debug avant de fermer le recap).
const RECAP_GATED_ROUTES: Record<string, RecapContext> = {
  '/dashboard': 'profile',
  '/group-dashboard': 'group',
}
const RECAP_SPECIAL_ROUTE = '/monthly-recap'

// Cookie cache 5min posé quand status === 'completed' pour éviter le hit DB
// (checkRecapStatus = 1 SELECT Supabase) à chaque navigation gated. Clé
// temporelle YYYY-MM : se "rotate" naturellement au changement de mois sans
// cleanup explicite. httpOnly = pas lu côté client (purement serveur).
const RECAP_COOKIE_PREFIX = 'recap-ok'
const RECAP_COOKIE_TTL_S = 300

function recapCookieName(context: RecapContext, year: number, month: number): string {
  const mm = String(month).padStart(2, '0')
  return `${RECAP_COOKIE_PREFIX}-${context}-${year}-${mm}`
}

/**
 * Next.js Proxy for token-based authentication
 * Protects routes by verifying session tokens and redirects unauthorized users
 * Handles token refresh and expiration automatically
 */
export default async function proxy(req: NextRequest) {
  // Get the current path
  const path = req.nextUrl.pathname

  // Check if the current route is protected or auth-related
  const isProtectedRoute = protectedRoutes.some((route) => path.startsWith(route))
  const isAuthRoute = authRoutes.some((route) => path.startsWith(route))
  const isRecapSpecialRoute = path.startsWith(RECAP_SPECIAL_ROUTE)
  const gatedContext: RecapContext | undefined = RECAP_GATED_ROUTES[path]

  // Skip proxy for static files and Next.js internals
  if (path.startsWith('/_next') || path.startsWith('/api') || path.includes('.')) {
    return NextResponse.next()
  }

  try {
    // Get the session cookie from the request
    const sessionCookie = req.cookies.get('session')?.value

    // Decrypt the session to verify token validity
    const session = await decrypt(sessionCookie)

    // Check token expiration for ALL app routes (not just protected ones)
    if (session?.userId) {
      const currentTime = Math.floor(Date.now() / 1000)

      // Check if token is expired (compare with session.expiresAt)
      if (session.expiresAt <= currentTime) {
        const response = NextResponse.redirect(new URL('/connexion', req.url))
        // Clear the expired session cookie
        response.cookies.delete('session')
        return response
      }
    }

    // Redirect root path to dashboard (auth) or connexion (guest)
    if (path === '/') {
      const target = session?.userId ? '/dashboard' : '/connexion'
      return NextResponse.redirect(new URL(target, req.url))
    }

    // Redirect to login if trying to access protected route without valid session
    if (isProtectedRoute && !session?.userId) {
      const loginUrl = new URL('/connexion', req.url)
      loginUrl.searchParams.set('from', path)
      return NextResponse.redirect(loginUrl)
    }

    // Redirect authenticated users away from auth pages to dashboard
    if (isAuthRoute && session?.userId) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Sprint 05 Monthly Recap V3 — recap gating.
    // Two cases handled here (only when authenticated) :
    //   A) On /monthly-recap (special route) : block re-entry if the recap is
    //      'completed' for this month → redirect to /dashboard. All other
    //      states (no_recap, in_progress, locked_by_other) pass through and
    //      let the page render the wizard or the lock screen.
    //   B) On /dashboard or /group-dashboard (gated routes) : redirect to
    //      /monthly-recap?context={ctx} if the recap status is blocking
    //      (isRecapBlocking ⇔ no_recap | in_progress | locked_by_other).
    //      A 5-min httpOnly cookie skips the DB call when the recap is
    //      already completed.
    if (session?.userId && isRecapSpecialRoute) {
      const queryContext = parseRecapContextQuery(req.nextUrl.searchParams.get('context'))
      try {
        const result = await checkRecapStatus(session.userId, queryContext)
        if (result.status.kind === 'completed') {
          return NextResponse.redirect(new URL('/dashboard', req.url))
        }
      } catch (error) {
        if (!(error instanceof RecapStatusError)) {
          logger.error('Proxy recap check (special route) error:', error)
        }
        // NO_GROUP / PROFILE_NOT_FOUND : laisser passer, la page gère.
      }
      return NextResponse.next()
    }

    if (session?.userId && gatedContext) {
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      const cookieName = recapCookieName(gatedContext, year, month)

      // Cache hit : on a déjà confirmé status='completed' dans les 5 dernières
      // minutes pour ce (context, mois, année). Skip le DB call.
      if (req.cookies.get(cookieName)?.value) {
        return NextResponse.next()
      }

      try {
        const result = await checkRecapStatus(session.userId, gatedContext)
        if (isRecapBlocking(result.status)) {
          const redirectUrl = new URL(RECAP_SPECIAL_ROUTE, req.url)
          redirectUrl.searchParams.set('context', gatedContext)
          return NextResponse.redirect(redirectUrl)
        }
        if (result.status.kind === 'completed') {
          const response = NextResponse.next()
          response.cookies.set(cookieName, '1', {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: RECAP_COOKIE_TTL_S,
          })
          return response
        }
      } catch (error) {
        if (!(error instanceof RecapStatusError)) {
          logger.error('Proxy recap check (gated route) error:', error)
        }
        // NO_GROUP / PROFILE_NOT_FOUND : laisser passer, la page gère.
      }
    }

    return NextResponse.next()
  } catch (error) {
    logger.error('Proxy authentication error:', error)

    // If there's an error decrypting the session on a protected route, redirect to login
    if (isProtectedRoute) {
      const response = NextResponse.redirect(new URL('/connexion', req.url))
      response.cookies.delete('session')
      return response
    }

    return NextResponse.next()
  }
}

function parseRecapContextQuery(raw: string | null): RecapContext {
  return raw === 'group' ? 'group' : 'profile'
}

// Configure which routes the proxy should run on
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
