'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function AuthCodeErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><p>Chargement...</p></div>}>
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
          description: 'Les liens de confirmation ne sont valides que pendant une durée limitée. Veuillez demander un nouveau lien.'
        }
      case 'invalid':
        return {
          title: 'Lien invalide',
          message: 'Le lien de confirmation est invalide ou a déjà été utilisé.',
          description: 'Vérifiez que vous avez utilisé le bon lien ou demandez un nouveau lien.'
        }
      case 'no_user':
        return {
          title: 'Utilisateur introuvable',
          message: 'Aucun utilisateur n\'a été trouvé pour ce lien.',
          description: 'Le lien pourrait être corrompu ou l\'utilisateur n\'existe plus.'
        }
      case 'server':
        return {
          title: 'Erreur serveur',
          message: 'Une erreur technique s\'est produite.',
          description: 'Veuillez réessayer dans quelques minutes ou demander un nouveau lien.'
        }
      default:
        return {
          title: 'Erreur de confirmation',
          message: 'Une erreur s\'est produite lors de la confirmation.',
          description: 'Veuillez vérifier le lien ou demander un nouveau lien de confirmation.'
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
            {errorInfo.title}
          </h1>
        </div>

        {/* Error Message */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <div className="text-center space-y-6">
            {/* Error Icon */}
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
              </svg>
            </div>

            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {errorInfo.message}
              </h2>
              <p className="text-gray-600">
                {errorInfo.description}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <Button
                onClick={handleRequestNewLink}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              >
                Demander un nouveau lien
              </Button>
              
              <Button
                onClick={handleBackToLogin}
                variant="outline"
                className="w-full h-12 border-2 border-gray-300 hover:border-blue-500 text-gray-700 hover:text-blue-600 font-semibold text-lg transition-all duration-300 rounded-lg"
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