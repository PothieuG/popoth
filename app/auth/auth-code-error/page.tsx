'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function AuthCodeErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50">
          <p>Chargement...</p>
        </div>
      }
    >
      <AuthCodeErrorContent />
    </Suspense>
  )
}

function AuthCodeErrorContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const error = searchParams.get('error')

  /**
   * Gets user-friendly error message and description based on error type
   */
  const getErrorInfo = () => {
    switch (error) {
      case 'expired':
        return {
          title: 'Lien expiré',
          message: 'Le lien de confirmation a expiré.',
          description:
            'Les liens de confirmation ne sont valides que pendant une durée limitée. Veuillez demander un nouveau lien.',
        }
      case 'invalid':
        return {
          title: 'Lien invalide',
          message: 'Le lien de confirmation est invalide ou a déjà été utilisé.',
          description: 'Vérifiez que vous avez utilisé le bon lien ou demandez un nouveau lien.',
        }
      case 'no_user':
        return {
          title: 'Utilisateur introuvable',
          message: "Aucun utilisateur n'a été trouvé pour ce lien.",
          description: "Le lien pourrait être corrompu ou l'utilisateur n'existe plus.",
        }
      case 'server':
        return {
          title: 'Erreur serveur',
          message: "Une erreur technique s'est produite.",
          description: 'Veuillez réessayer dans quelques minutes ou demander un nouveau lien.',
        }
      default:
        return {
          title: 'Erreur de confirmation',
          message: "Une erreur s'est produite lors de la confirmation.",
          description: 'Veuillez vérifier le lien ou demander un nouveau lien de confirmation.',
        }
    }
  }

  const errorInfo = getErrorInfo()

  /**
   * Navigates to forgot password page to request a new reset link
   */
  const handleRequestNewLink = () => {
    router.push('/forgot-password')
  }

  /**
   * Navigates back to login page
   */
  const handleBackToLogin = () => {
    router.push('/connexion')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="bg-linear-to-r from-red-600 to-orange-600 bg-clip-text text-4xl font-bold text-transparent">
            {errorInfo.title}
          </h1>
        </div>

        {/* Error Message */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="space-y-4 text-center">
            {/* Error Icon */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-8 w-8 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                ></path>
              </svg>
            </div>

            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-gray-900">{errorInfo.message}</h2>
              <p className="text-gray-600">{errorInfo.description}</p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2">
              <Button
                onClick={handleRequestNewLink}
                className="h-12 w-full rounded-lg bg-linear-to-r from-blue-600 to-purple-600 text-lg font-semibold text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-purple-700 hover:shadow-xl"
              >
                Demander un nouveau lien
              </Button>

              <Button
                onClick={handleBackToLogin}
                variant="outline"
                className="h-12 w-full rounded-lg border-2 border-gray-300 text-lg font-semibold text-gray-700 transition-all duration-300 hover:border-blue-500 hover:text-blue-600"
              >
                Retour à la connexion
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
