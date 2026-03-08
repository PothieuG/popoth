import { useState, useEffect, useCallback, useRef } from 'react'
import { ProfileData, CreateProfileRequest } from '@/app/api/profile/route'
import { triggerFinancialRefresh } from '@/hooks/useFinancialData'

/**
 * Hook personnalisé pour gérer les profils utilisateur
 * Fournit des méthodes pour récupérer, créer et mettre à jour les profils
 */
export function useProfile() {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasBeenFetched, setHasBeenFetched] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * Récupère le profil de l'utilisateur connecté
   */
  const fetchProfile = useCallback(async () => {
    try {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      
      abortControllerRef.current = new AbortController()
      setIsLoading(true)
      setError(null)

      const response = await fetch('/api/profile', {
        method: 'GET',
        credentials: 'include',
        signal: abortControllerRef.current.signal
      })

      const data = await response.json()

      if (!response.ok) {
        // Log détaillé uniquement pour le développement
        if (process.env.NODE_ENV === 'development') {
          console.error('Erreur API profil:', {
            status: response.status,
            statusText: response.statusText,
            data
          })
        }

        // Gestion spécifique des erreurs communes
        if (response.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        } else if (response.status === 500 && data.error?.includes('bigint')) {
          throw new Error('Erreur de configuration de la base de données. Veuillez contacter le support.')
        }
        
        throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      setProfile(data.profile)
    } catch (err) {
      // Ignore aborted requests
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue'
      setError(errorMessage)
      
      // Log uniquement en développement
      if (process.env.NODE_ENV === 'development') {
        console.error('Erreur lors de la récupération du profil:', err)
      }
    } finally {
      setIsLoading(false)
      setHasBeenFetched(true)
    }
  }, [])

  /**
   * Crée un nouveau profil pour l'utilisateur connecté
   */
  const createProfile = useCallback(async (profileData: CreateProfileRequest): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(profileData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la création du profil')
      }

      setProfile(data.profile)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Erreur lors de la création du profil:', err)
      return false
    }
  }, [])

  /**
   * Met à jour le profil de l'utilisateur connecté
   */
  const updateProfile = useCallback(async (updates: Partial<CreateProfileRequest>): Promise<boolean> => {
    try {
      setError(null)

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(updates)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du profil')
      }

      setProfile(data.profile)
      // Rafraîchir les données financières (le salaire impacte le RAV)
      triggerFinancialRefresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
      console.error('Erreur lors de la mise à jour du profil:', err)
      return false
    }
  }, [])

  // Récupérer le profil au montage du composant
  useEffect(() => {
    fetchProfile()
    
    // Cleanup: abort any pending request on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchProfile])

  return {
    profile,
    isLoading,
    error,
    hasBeenFetched,
    fetchProfile,
    createProfile,
    updateProfile,
    // Helpers
    hasProfile: profile !== null,
    fullName: profile ? `${profile.first_name} ${profile.last_name}` : null
  }
}