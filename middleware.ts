import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'

// Define protected and public routes
const protectedRoutes = ['/dashboard', '/profile', '/settings', '/group-dashboard']
const publicRoutes = ['/']
const authRoutes = ['/connexion', '/inscription', '/forgot-password', '/reset-password', '/auth/confirm', '/auth/auth-code-error']
const specialRoutes = ['/monthly-recap'] // Routes spéciales qui ont leur propre logique

// Routes that should trigger automatic logout when token expires (all pages)
const allAppRoutes = [...protectedRoutes, ...publicRoutes, ...authRoutes, ...specialRoutes]

/**
 * Next.js Middleware for token-based authentication
 * Protects routes by verifying session tokens and redirects unauthorized users
 * Handles token refresh and expiration automatically
 */
export default async function middleware(req: NextRequest) {
  // Get the current path
  const path = req.nextUrl.pathname
  
  // Check if the current route is protected, public, auth-related, or special
  const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route))
  const isPublicRoute = publicRoutes.some(route => path.startsWith(route))
  const isAuthRoute = authRoutes.some(route => path.startsWith(route))
  const isSpecialRoute = specialRoutes.some(route => path.startsWith(route))
  
  // Skip middleware for static files and Next.js internals
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
    
    // Redirect to login if trying to access protected route without valid session
    if ((isProtectedRoute || isSpecialRoute) && !session?.userId) {
      const loginUrl = new URL('/connexion', req.url)
      loginUrl.searchParams.set('from', path)
      return NextResponse.redirect(loginUrl)
    }

    // Check for monthly recap requirement on protected routes (but not on monthly-recap page itself)
    if ((isProtectedRoute || path === '/') && session?.userId && !isSpecialRoute) {
      try {
        // Get the context based on the current path
        const context = path.startsWith('/group-dashboard') ? 'group' : 'profile'

        // Make a request to check if monthly recap is required
        const baseUrl = req.nextUrl.origin
        const checkUrl = `${baseUrl}/api/monthly-recap/status?context=${context}`

        const response = await fetch(checkUrl, {
          headers: {
            'Cookie': req.headers.get('Cookie') || ''
          }
        })

        if (response.ok) {
          const data = await response.json()

          if (data.required) {
            console.log(`📅 [Middleware] Récap mensuel requis pour ${context}, redirection`)
            const recapUrl = new URL('/monthly-recap', req.url)
            recapUrl.searchParams.set('context', context)
            return NextResponse.redirect(recapUrl)
          }
        }
      } catch (error) {
        console.error('❌ [Middleware] Erreur lors de la vérification du récap mensuel:', error)
        // En cas d'erreur, continuer normalement plutôt que de bloquer l'utilisateur
      }
    }

    // Redirect authenticated users away from auth pages to dashboard
    if (isAuthRoute && session?.userId) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
    
  } catch (error) {
    console.error('Middleware authentication error:', error)
    
    // If there's an error decrypting the session on a protected route, redirect to login
    if (isProtectedRoute) {
      const response = NextResponse.redirect(new URL('/connexion', req.url))
      response.cookies.delete('session')
      return response
    }
    
    return NextResponse.next()
  }
}

// Configure which routes the middleware should run on
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.ico$).*)'],
}