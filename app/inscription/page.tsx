'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

/**
 * Registration page allowing users to create a new account with email and password
 * Features clean cardless design with colorful shadcn/ui component variants and Roboto font
 * Includes password confirmation validation and Supabase integration
 */
export default function InscriptionPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  /**
   * Handles registration form submission
   * Validates form fields, checks password confirmation, and processes user signup
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    
    // Field validation
    if (!email || !password || !confirmPassword) {
      setError('Veuillez remplir tous les champs')
      return
    }

    if (!email.includes('@')) {
      setError('Veuillez entrer une adresse email valide')
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
      // Sign up user with Supabase
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/connexion`
        }
      })

      if (signUpError) {
        // Handle specific signup errors with better detection
        const errorMessage = signUpError.message.toLowerCase()
        
        if (errorMessage.includes('already registered') || 
            errorMessage.includes('user already registered') ||
            errorMessage.includes('email already exists')) {
          setError('Cette adresse email est déjà utilisée. Essayez de vous connecter.')
        } else if (errorMessage.includes('weak password') || 
                   errorMessage.includes('password') && errorMessage.includes('weak')) {
          setError('Le mot de passe est trop faible. Utilisez au moins 6 caractères avec des lettres et chiffres.')
        } else if (errorMessage.includes('invalid email') || 
                   errorMessage.includes('email') && errorMessage.includes('invalid')) {
          setError('Format d\'email invalide')
        } else if (errorMessage.includes('signup disabled')) {
          setError('Les inscriptions sont temporairement désactivées')
        } else {
          setError('Erreur lors de la création du compte. Veuillez réessayer.')
        }
        
        // Log all signup errors for debugging (they're less common than login errors)
        console.error('Signup error:', signUpError.message)
        return
      }

      if (data.user) {
        setSuccess(true)
        // Auto-redirect to login after 3 seconds
        setTimeout(() => {
          router.push('/connexion')
        }, 3000)
      }
      
    } catch (error) {
      setError('Erreur de connexion. Veuillez réessayer.')
      console.error('Signup error:', error)
    } finally {
      setLoading(false)
    }
  }

  /**
   * Navigates to the login page
   */
  const goToLogin = () => {
    router.push('/connexion')
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-blue-600 bg-clip-text text-transparent">
              Compte créé !
            </h1>
            <p className="text-lg text-gray-600">
              Un email de confirmation a été envoyé à votre adresse.
            </p>
            <p className="text-sm text-gray-500">
              Redirection vers la connexion...
            </p>
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
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
            Inscription
          </h1>
          <p className="text-lg text-gray-600">
            Créez votre compte
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
                className="h-12 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all rounded-lg text-gray-900"
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <label htmlFor="motdepasse" className="block text-sm font-semibold text-gray-700">
                Mot de passe
              </label>
              <Input
                id="motdepasse"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Votre mot de passe"
                disabled={loading}
                autoComplete="new-password"
                className="h-12 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all rounded-lg text-gray-900"
              />
            </div>

            {/* Confirm Password Field */}
            <div className="space-y-2">
              <label htmlFor="confirmmotdepasse" className="block text-sm font-semibold text-gray-700">
                Confirmer le mot de passe
              </label>
              <Input
                id="confirmmotdepasse"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirmez votre mot de passe"
                disabled={loading}
                autoComplete="new-password"
                className="h-12 border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all rounded-lg text-gray-900"
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

            {/* Register Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              disabled={loading}
            >
              {loading ? 'Création en cours...' : 'Créer mon compte'}
            </Button>
          </form>

          {/* Additional Links */}
          <div className="mt-8 space-y-4">
            <div className="text-center text-sm text-gray-600">
              Déjà un compte ?{' '}
              <button 
                onClick={goToLogin}
                className="font-semibold text-purple-600 hover:text-purple-800 transition-colors"
              >
                Se connecter
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}