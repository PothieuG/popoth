import { NextRequest, NextResponse } from 'next/server'
import { decrypt } from '@/lib/session'
import { logger } from '@/lib/logger'

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
