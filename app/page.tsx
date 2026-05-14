'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useAuthUser } from '@/contexts/AuthContext'

/**
 * HomePage component - main landing page of the application
 *
 * Sprint P10-Fix-Home-Flicker: waits on AuthContext.loading before deciding
 * what to render. Without the loading guard, the initial render shows the
 * guest welcome page before INIT_SUCCESS fires (~50-300ms), then flashes to
 * /dashboard for authenticated users via full page reload.
 */
export default function HomePage() {
  const { loading, isLoggedIn } = useAuthUser()
  const router = useRouter()

  useEffect(() => {
    if (!loading && isLoggedIn) {
      router.replace('/dashboard')
    }
  }, [loading, isLoggedIn, router])

  if (loading || isLoggedIn) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100 p-4"
      >
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
          <span className="sr-only">Chargement</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
        {/* Header */}
        <div className="mb-6">
          <h1 className="mb-4 text-3xl font-bold text-gray-900">Bienvenue sur Popoth App</h1>
          <p className="text-gray-600">
            Votre application mobile moderne construite avec Next.js 15 et Supabase
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button
            onClick={() => router.push('/connexion')}
            className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
          >
            Se connecter
          </Button>
          <Button
            onClick={() => router.push('/inscription')}
            variant="outline"
            className="h-12 w-full rounded-lg border-purple-300 text-lg font-semibold text-purple-600 transition-all duration-300 hover:border-purple-400 hover:bg-purple-50"
          >
            Créer un compte
          </Button>
        </div>
      </div>
    </div>
  )
}
