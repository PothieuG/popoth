'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase-client'

/**
 * Forgot password page allowing users to request a password reset email
 * Features clean cardless design with colorful shadcn/ui component variants and Roboto font
 */
export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  /**
   * Handles password reset form submission
   * Validates email format and sends reset email via Supabase
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    
    // Email validation
    if (!email) {
      setError('Veuillez entrer votre adresse email')
      return
    }

    if (!email.includes('@') || !email.includes('.')) {
      setError('Veuillez entrer une adresse email valide')
      return
    }

    setLoading(true)
    
    try {
      // Send password reset email with Supabase
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      })

      if (resetError) {
        // Handle specific reset errors
        if (resetError.message.includes('rate limit')) {
          setError('Trop de demandes. Veuillez patienter avant de réessayer.')
        } else {
          setError('Erreur lors de l\'envoi de l\'email. Veuillez réessayer.')
        }
        console.error('Password reset error:', resetError)
        return
      }

      // Success - show confirmation message
      // Note: Supabase always succeeds for security reasons, even if email doesn't exist
      setSuccess(true)
      
    } catch (error) {
      setError('Erreur lors de l\'envoi de l\'email. Veuillez réessayer.')
      console.error('Password reset error:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Navigates back to the login page
   */
  const handleBackToLogin = () => {
    router.push('/connexion')
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Email envoyé !
            </h1>
            <p className="text-lg text-gray-600">
              Vérifiez votre boîte de réception
            </p>
          </div>

          {/* Success Message */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
            <div className="text-center space-y-6">
              {/* Success Icon */}
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>

              <div className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Demande traitée
                </h2>
                <p className="text-gray-600">
                  Si un compte existe avec l'adresse <strong>{email}</strong>, vous recevrez un lien de réinitialisation.
                </p>
                <div className="text-sm text-gray-500 space-y-2">
                  <p>• Vérifiez votre boîte de réception et votre dossier spam</p>
                  <p>• Le lien expire après 1 heure</p>
                  <p>• Si vous ne recevez rien, vérifiez que l'adresse est correcte</p>
                </div>
              </div>

              {/* Back to Login Button */}
              <Button
                onClick={handleBackToLogin}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              >
                Retour à la connexion
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Mot de passe oublié
          </h1>
          <p className="text-lg text-gray-600">
            Entrez votre email pour recevoir un lien de réinitialisation
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email Field */}
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700">
                Adresse email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                disabled={loading}
                autoComplete="email"
                className="h-12 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all rounded-lg text-gray-900"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="rounded-lg bg-red-50 p-4 border-l-4 border-red-500">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="font-medium text-red-800">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              disabled={loading}
            >
              {loading ? 'Envoi en cours...' : 'Envoyer le lien de réinitialisation'}
            </Button>
          </form>

          {/* Back to Login Link */}
          <div className="mt-8 text-center">
            <button 
              onClick={handleBackToLogin}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
            >
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}