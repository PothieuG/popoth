'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogin, useRequireGuest } from '@/hooks/useAuth'

/**
 * Login page allowing users to authenticate with email and password
 * Uses modern token management system with secure session cookies
 * Features clean cardless design with colorful shadcn/ui component variants and Roboto font
 */
export default function ConnexionPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { handleLogin, isSubmitting, error, clearError } = useLogin()
  
  // Ensure only guests can access this page
  useRequireGuest()

  /**
   * Handles login form submission with modern token management
   * Validates form fields and processes authentication using the new auth system
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    
    // Field validation
    if (!email || !password) {
      return
    }

    if (!email.includes('@')) {
      return
    }

    if (password.length < 6) {
      return
    }

    // Use the new login system with token management
    await handleLogin(email, password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Popoth
          </h1>
          <p className="text-lg text-gray-600">
            Connectez-vous à votre compte
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
                disabled={isSubmitting}
                autoComplete="email"
                className="h-12 border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all rounded-lg text-gray-900"
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
                disabled={isSubmitting}
                autoComplete="current-password"
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

            {/* Login Button */}
            <Button
              type="submit"
              className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 rounded-lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Connexion en cours...' : 'Se connecter'}
            </Button>
          </form>

          {/* Additional Links */}
          <div className="mt-8 space-y-4">
            <div className="text-center">
              <button 
                onClick={() => window.location.href = '/forgot-password'}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
              >
                Mot de passe oublié ?
              </button>
            </div>
            
            <div className="text-center text-sm text-gray-600">
              Pas encore de compte ?{' '}
              <button 
                onClick={() => window.location.href = '/inscription'}
                className="font-semibold text-purple-600 hover:text-purple-800 transition-colors"
              >
                Créer un compte
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}