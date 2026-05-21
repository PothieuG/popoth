import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'
import { logger } from '@/lib/logger'
import { checkRecapStatus, RecapStatusError } from '@/lib/recap/check-status'

// Define protected and public routes
const protectedRoutes = ['/dashboard', '/profile', '/group-dashboard']
const authRoutes = [
  '/connexion',
  '/inscription',
  '/forgot-password',
  '/reset-password',
  '/auth/confirm',
  '/auth/auth-code-error',
]
const specialRoutes = ['/monthly-recap'] // Routes spéciales qui ont leur propre logique

/**
 * Next.js Proxy for token-based authentication
 * Protects routes by verifying session tokens and redirects unauthorized users
 * Handles token refresh and expiration automatically
 */
export default async function proxy(req: NextRequest) {
  // Get the current path
  const path = req.nextUrl.pathname

  // Check if the current route is protected, auth-related, or special
  const isProtectedRoute = protectedRoutes.some((route) => path.startsWith(route))
  const isAuthRoute = authRoutes.some((route) => path.startsWith(route))
  const isSpecialRoute = specialRoutes.some((route) => path.startsWith(route))

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
    if ((isProtectedRoute || isSpecialRoute) && !session?.userId) {
      const loginUrl = new URL('/connexion', req.url)
      loginUrl.searchParams.set('from', path)
      return NextResponse.redirect(loginUrl)
    }

    // Block re-entry to /monthly-recap if the recap is already completed for the current month.
    // Garde server-side : URL bar, bookmark, deeplink, refresh F5, back/forward post-completion.
    // Le client a déjà router.replace() côté completion, donc /monthly-recap n'est pas dans
    // l'historique — ce filet ferme les vecteurs restants (navigation directe).
    if (isSpecialRoute && session?.userId) {
      const queryContext = req.nextUrl.searchParams.get('context') === 'group' ? 'group' : 'profile'
      try {
        const status = await checkRecapStatus(session.userId, queryContext)
        if (status.isCompleted) {
          const redirectPath = queryContext === 'group' ? '/group-dashboard' : '/dashboard'
          logger.debug(`📅 [Proxy] Récap ${queryContext} déjà terminé, redirection ${redirectPath}`)
          return NextResponse.redirect(new URL(redirectPath, req.url))
        }
      } catch (error) {
        if (error instanceof RecapStatusError && error.code === 'NO_GROUP') {
          // Pas de groupe : laisser passer, le composant gérera l'affichage.
        } else {
          logger.error('❌ [Proxy] Erreur lors de la vérification recap terminé:', error)
        }
      }
    }

    // Check for monthly recap requirement on protected routes (but not on monthly-recap page itself).
    // Le check fait 2 SELECTs Supabase synchrones (profiles + monthly_recaps) à chaque
    // navigation protégée, soit ~200-500ms. On le cache via cookie scopé au mois/année
    // courants pour ne payer ce coût qu'1 fois par tranche de 5 min (TTL court mais
    // suffisant pour amortir une session active de switch profile↔group). Le cookie
    // n'est posé que si `required=false` ; en cas de `required=true` on laisse l'absence
    // de cookie déclencher un re-check au prochain GET (sinon le user redirigerait
    // vers /monthly-recap puis cliquerait "Personnel" et serait coincé sans re-check).
    if (isProtectedRoute && session?.userId && !isSpecialRoute) {
      const context = path.startsWith('/group-dashboard') ? 'group' : 'profile'
      const now = new Date()
      const cookieKey = `recap-ok-${context}-${now.getMonth() + 1}-${now.getFullYear()}`

      if (req.cookies.get(cookieKey)?.value === '1') {
        // Skip Supabase round-trip — déjà vérifié récemment ce mois-ci.
        return NextResponse.next()
      }

      try {
        const status = await checkRecapStatus(session.userId, context)

        if (status.required) {
          logger.debug(`📅 [Proxy] Récap mensuel requis pour ${context}, redirection`)
          const recapUrl = new URL('/monthly-recap', req.url)
          recapUrl.searchParams.set('context', context)
          return NextResponse.redirect(recapUrl)
        }

        // status.required === false → poser le cookie pour amortir les nav suivantes.
        const response = NextResponse.next()
        response.cookies.set(cookieKey, '1', {
          maxAge: 300, // 5 minutes
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        })
        return response
      } catch (error) {
        if (error instanceof RecapStatusError && error.code === 'NO_GROUP') {
          // Pas de groupe attaché : l'utilisateur n'est pas concerné par le récap groupe
        } else {
          logger.error('❌ [Proxy] Erreur lors de la vérification du récap mensuel:', error)
        }
        // En cas d'erreur, continuer normalement plutôt que de bloquer l'utilisateur
      }
    }

    // Redirect authenticated users away from auth pages to dashboard
    if (isAuthRoute && session?.userId) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
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

// Configure which routes the proxy should run on
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
