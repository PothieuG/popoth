'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateProfileRequest, ProfileData } from '@/app/api/profile/route'
import { triggerFinancialRefresh } from '@/hooks/useFinancialData'

/**
 * Hook personnalisé pour gérer les profils utilisateur
 * Fournit des méthodes pour récupérer, créer et mettre à jour les profils
 */
export function useProfile() {
  const queryClient = useQueryClient()

  const {
    data: profile = null,
    isLoading,
    error: queryError,
    isFetched,
    refetch,
  } = useQuery<ProfileData | null>({
    queryKey: ['profile'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/profile', {
        method: 'GET',
        credentials: 'include',
        signal,
      })

      const data = await response.json()

      if (!response.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erreur API profil:', {
            status: response.status,
            statusText: response.statusText,
            data,
          })
        }

        if (response.status === 401) {
          throw new Error('Session expirée. Veuillez vous reconnecter.')
        }
        if (response.status === 500 && data.error?.includes('bigint')) {
          throw new Error(
            'Erreur de configuration de la base de données. Veuillez contacter le support.',
          )
        }

        throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`)
      }

      return data.profile as ProfileData
    },
  })

  const createMutation = useMutation<ProfileData, Error, CreateProfileRequest>({
    mutationFn: async (profileData) => {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(profileData),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la création du profil')
      }
      return data.profile as ProfileData
    },
    onSuccess: (newProfile) => {
      queryClient.setQueryData(['profile'], newProfile)
    },
    onError: (err) => {
      console.error('Erreur lors de la création du profil:', err)
    },
  })

  const updateMutation = useMutation<ProfileData, Error, Partial<CreateProfileRequest>>({
    mutationFn: async (updates) => {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du profil')
      }
      return data.profile as ProfileData
    },
    onSuccess: (newProfile) => {
      queryClient.setQueryData(['profile'], newProfile)
      triggerFinancialRefresh()
    },
    onError: (err) => {
      console.error('Erreur lors de la mise à jour du profil:', err)
    },
  })

  const latestError = createMutation.error ?? updateMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  return {
    profile,
    isLoading,
    error,
    hasBeenFetched: isFetched,
    fetchProfile: async () => {
      await refetch()
    },
    createProfile: async (profileData: CreateProfileRequest): Promise<boolean> => {
      try {
        await createMutation.mutateAsync(profileData)
        return true
      } catch {
        return false
      }
    },
    updateProfile: async (updates: Partial<CreateProfileRequest>): Promise<boolean> => {
      try {
        await updateMutation.mutateAsync(updates)
        return true
      } catch {
        return false
      }
    },
    // Helpers
    hasProfile: profile !== null,
    fullName: profile ? `${profile.first_name} ${profile.last_name}` : null,
  }
}
