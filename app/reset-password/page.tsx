'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase-client'

export default function NouveauMotDePassePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}>
      <NouveauMotDePasseContent />
    </Suspense>
  )
}

function NouveauMotDePasseContent() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [validatingToken, setValidatingToken] = useState(true)
  const [isValidToken, setIsValidToken] = useState(false)
  
  const router = useRouter()
  const searchParams = useSearchParams()

  /**
   * Validates the reset token from the URL parameters on component mount
   * Checks if the user has a valid session from the email link
   */
  useEffect(() => {
    const validateToken = async () => {
      try {
        // Check if user has a valid session (from email link)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        
        if (sessionError) {
          console.error('Session validation error:', sessionError)
          setError('Lien de réinitialisation invalide ou expiré')
          setValidatingToken(false)
          return
        }

        if (!session) {
          setError('Lien de réinitialisation invalide ou expiré. Veuillez demander un nouveau lien.')
          setValidatingToken(false)
          return
        }

        // Token is valid
        setIsValidToken(true)
        setValidatingToken(false)
        
      } catch (error) {
        console.error('Token validation error:', error)
        setError('Erreur lors de la validation du lien. Veuillez réessayer.')
        setValidatingToken(false)
      }
    }

    validateToken()
  }, [])

  /**
   * Handles new password form submission
   * Validates password fields and updates user password via Supabase
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    // Password validation
    if (!password || !confirmPassword) {
      setError('Veuillez remplir tous les champs')
      return
    }

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères')
      return
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }

    setLoading(true)
    
    try {
      // Update user password with Supabase
      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      })

      if (updateError) {
        // Handle specific update errors - prevent error from bubbling up
        if (updateError.message.includes('session_not_found')) {
          setError('Session expirée. Veuillez demander un nouveau lien de réinitialisation.')
        } else if (updateError.message.includes('New password should be different from the old password')) {
          setError('Le nouveau mot de passe doit être différent de l\'ancien mot de passe.')
        } else if (updateError.message.includes('password')) {
          setError('Le mot de passe ne respecte pas les critères de sécurité')
        } else {
          setError('Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.')
        }
        setLoading(false)
        return
      }

      // Success - show confirmation message
      setSuccess(true)
      
    } catch (error: any) {
      // Handle specific catch errors as well
      if (error?.message?.includes('New password should be different from the old password')) {
        setError('Le nouveau mot de passe doit être différent de l\'ancien mot de passe.')
      } else if (error?.message?.includes('session_not_found')) {
        setError('Session expirée. Veuillez demander un nouveau lien de réinitialisation.')
      } else if (error?.message?.includes('password')) {
        setError('Le mot de passe ne respecte pas les critères de sécurité')
      } else {
        setError('Erreur lors de la mise à jour du mot de passe. Veuillez réessayer.')
      }
    } finally {
      setLoading(false)
    }
  }

  /**
   * Navigates back to the login page after successful password reset
   */
  const handleGoToLogin = () => {
    router.push('/connexion')
  }

  /**
   * Navigates back to forgot password page to request a new link
   */
  const handleRequestNewLink = () => {
    router.push('/mot-de-passe-oublie')
  }

  // Loading state while validating token
  if (validatingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Validation en cours...
            </h1>
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Invalid token state
  if (!isValidToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
              Lien invalide
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
                  Lien de réinitialisation invalide
                </h2>
                <p className="text-gray-600">
                  {error}
                </p>
              </div>

              {/* Request New Link Button */}
              <Button
                onClick={handleRequestNewLink}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              >
                Demander un nouveau lien
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
              Mot de passe mis à jour !
            </h1>
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
                  Mot de passe mis à jour avec succès
                </h2>
                <p className="text-gray-600">
                  Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
                </p>
              </div>

              {/* Go to Login Button */}
              <Button
                onClick={handleGoToLogin}
                className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              >
                Se connecter
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main form state
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Nouveau mot de passe
          </h1>
          <p className="text-lg text-gray-600">
            Choisissez un nouveau mot de passe sécurisé
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
                Nouveau mot de passe
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Votre nouveau mot de passe"
                disabled={loading}
                autoComplete="new-password"
                className="h-12 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all rounded-lg text-gray-900"
              />
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700">
                Confirmer le mot de passe
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmez votre nouveau mot de passe"
                disabled={loading}
                autoComplete="new-password"
                className="h-12 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all rounded-lg text-gray-900"
              />
            </div>

            {/* Password Requirements */}
            <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-2">Critères du mot de passe :</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Au moins 6 caractères</li>
                  <li>Évitez les mots de passe trop simples</li>
                </ul>
              </div>
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

            {/* Update Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              disabled={loading}
            >
              {loading ? 'Mise à jour en cours...' : 'Mettre à jour le mot de passe'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}