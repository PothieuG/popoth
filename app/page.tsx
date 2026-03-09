'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

/**
 * HomePage component - main landing page of the application
 * Redirects to dashboard if logged in, shows login/register buttons otherwise
 */
export default function HomePage() {
  const { isLoggedIn } = useAuth()

  useEffect(() => {
    if (isLoggedIn) {
      window.location.href = '/dashboard'
    }
  }, [isLoggedIn])

  if (isLoggedIn) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Bienvenue sur Popoth App
          </h1>
          <p className="text-gray-600">
            Votre application mobile moderne construite avec Next.js 15 et Supabase
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button
            onClick={() => window.location.href = '/connexion'}
            className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
          >
            Se connecter
          </Button>
          <Button
            onClick={() => window.location.href = '/inscription'}
            variant="outline"
            className="w-full h-12 border-purple-300 text-purple-600 hover:bg-purple-50 hover:border-purple-400 font-semibold text-lg transition-all duration-300 rounded-lg"
          >
            Créer un compte
          </Button>
        </div>
      </div>
    </div>
  );
}
