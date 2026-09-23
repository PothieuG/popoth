'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'

/**
 * Shape renvoyée par `GET /api/notes` — miroir de
 * `Database['public']['Tables']['notes']['Row']` + le JOIN `created_by`.
 * Dupliquée ici (vs import direct) pour ne pas tirer `database.types.ts` côté
 * client, pattern identique à `SavingsProject` dans useProjects.ts.
 *
 * `created_by` ne porte jamais l'avatar (règle Part 42 §11) : il sert de repli
 * pour les initiales quand l'auteur n'est plus membre du groupe.
 */
export interface Note {
  id: string
  profile_id: string | null
  group_id: string | null
  created_by_profile_id: string | null
  content: string
  created_at: string
  updated_at: string
  created_by: { id: string; first_name: string | null; last_name: string | null } | null
}

async function readJsonError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null)
  return new Error(body?.error || `Erreur ${response.status}: ${response.statusText}`)
}

/**
 * Notes / pense-bêtes du contexte courant — TanStack Query, key
 * `['notes', context]`. Perso = notes privées ; groupe = notes partagées par
 * tous les membres.
 *
 * Les notes ne sont pas des données financières : aucune mutation ici
 * n'appelle `invalidateFinancialRefreshes`. Le cache est mis à jour à la main
 * avec la ligne renvoyée par l'API (`setQueryData`), sans refetch.
 */
export function useNotes(context: 'profile' | 'group') {
  const queryClient = useQueryClient()
  const queryKey = ['notes', context]

  const {
    data: notes = [],
    isLoading,
    isFetching,
    error: queryError,
  } = useQuery<Note[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/notes?context=${context}`, {
        method: 'GET',
        credentials: 'include',
        signal,
      })
      if (!response.ok) throw await readJsonError(response)
      const data = await response.json()
      return (data.notes ?? []) as Note[]
    },
  })

  const addMutation = useMutation<Note, Error, string>({
    mutationFn: async (content) => {
      const response = await fetch(`/api/notes?context=${context}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content }),
      })
      if (!response.ok) throw await readJsonError(response)
      const data = await response.json()
      return data.note as Note
    },
    onSuccess: (newNote) => {
      queryClient.setQueryData<Note[]>(queryKey, (prev = []) => [newNote, ...prev])
    },
    onError: (err) => {
      logger.error("Erreur lors de l'ajout de la note:", err)
    },
  })

  const updateMutation = useMutation<Note, Error, { noteId: string; content: string }>({
    mutationFn: async ({ noteId, content }) => {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content }),
      })
      if (!response.ok) throw await readJsonError(response)
      const data = await response.json()
      return data.note as Note
    },
    onSuccess: (updatedNote, { noteId }) => {
      queryClient.setQueryData<Note[]>(queryKey, (prev = []) =>
        prev.map((note) => (note.id === noteId ? updatedNote : note)),
      )
    },
    onError: (err) => {
      logger.error('Erreur lors de la modification de la note:', err)
    },
  })

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: async (noteId) => {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) throw await readJsonError(response)
    },
    onSuccess: (_, noteId) => {
      queryClient.setQueryData<Note[]>(queryKey, (prev = []) =>
        prev.filter((note) => note.id !== noteId),
      )
    },
    onError: (err) => {
      logger.error('Erreur lors de la suppression de la note:', err)
    },
  })

  return {
    notes,
    loading: isLoading,
    isFetching,
    error: queryError instanceof Error ? queryError.message : null,
    /** `true` si la note a été créée. */
    addNote: async (content: string): Promise<boolean> => {
      try {
        await addMutation.mutateAsync(content)
        return true
      } catch {
        return false
      }
    },
    /** `true` si la note a été modifiée. */
    updateNote: async (noteId: string, content: string): Promise<boolean> => {
      try {
        await updateMutation.mutateAsync({ noteId, content })
        return true
      } catch {
        return false
      }
    },
    /** `true` si la note a été supprimée. */
    deleteNote: async (noteId: string): Promise<boolean> => {
      try {
        await deleteMutation.mutateAsync(noteId)
        return true
      } catch {
        return false
      }
    },
  }
}
