'use client'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

/**
 * HomePage component - main landing page of the application
 * Shows different content based on authentication status
 */
export default function HomePage() {
  const { isLoggedIn, user, logoutAndRedirect } = useAuth()

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

        {/* User Status */}
        {isLoggedIn && user ? (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800 text-sm font-medium mb-2">
              ✅ Connecté en tant que
            </p>
            <p className="text-green-900 font-semibold text-sm break-all">
              {user.email}
            </p>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-gray-600 text-sm">
              Non connecté
            </p>
          </div>
        )}

        {/* Status Cards */}
        <div className="space-y-3 mb-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-green-800 text-sm font-medium">
              ✅ Next.js 15 configuré
            </p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-blue-800 text-sm font-medium">
              🎨 Tailwind CSS & shadcn/ui prêts
            </p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-green-800 text-sm font-medium">
              ✅ Supabase configuré et prêt
            </p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-purple-800 text-sm font-medium">
              🔐 Système d'authentification moderne
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {isLoggedIn ? (
            <>
              <Button
                onClick={() => window.location.href = '/dashboard'}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              >
                Accéder au tableau de bord
              </Button>
              <Button
                onClick={logoutAndRedirect}
                variant="outline"
                className="w-full h-12 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 font-semibold text-lg transition-all duration-300 rounded-lg"
              >
                Se déconnecter
              </Button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}