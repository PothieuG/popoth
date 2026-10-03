'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NoteKind } from '@/lib/constants/notes'
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
  /** Onglet du drawer : courses, note (texte libre) ou projet. */
  kind: NoteKind
  content: string
  /** Courses uniquement : horodatage de la case cochée, `null` = à acheter. */
  checked_at: string | null
  created_at: string
  updated_at: string
  created_by: { id: string; first_name: string | null; last_name: string | null } | null
}

/** Ce qui reste à traiter : tout sauf les articles de courses déjà cochés. */
export function isPendingNote(note: Pick<Note, 'kind' | 'checked_at'>): boolean {
  return !(note.kind === 'shopping' && note.checked_at)
}

async function readJsonError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null)
  return new Error(body?.error || `Erreur ${response.status}: ${response.statusText}`)
}

/**
 * Notes / pense-bêtes du contexte courant — TanStack Query, key
 * `['notes', context]`. Perso = notes privées ; groupe = notes partagées par
 * tous les membres. Une seule query pour les 3 onglets (courses, notes,
 * projets) : le drawer filtre par `kind`.
 *
 * Les notes ne sont pas des données financières : aucune mutation ici
 * n'appelle `invalidateFinancialRefreshes`. Le cache est mis à jour à la main
 * avec la ligne renvoyée par l'API (`setQueryData`), sans refetch. Seule la
 * case des courses est optimiste (réponse immédiate en magasin), annulée si
 * l'API échoue.
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

  const addMutation = useMutation<Note, Error, { content: string; kind: NoteKind }>({
    mutationFn: async ({ content, kind }) => {
      const response = await fetch(`/api/notes?context=${context}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content, kind }),
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

  const setCheckedAt = (noteId: string, checkedAt: string | null) => {
    queryClient.setQueryData<Note[]>(queryKey, (prev = []) =>
      prev.map((note) => (note.id === noteId ? { ...note, checked_at: checkedAt } : note)),
    )
  }

  const toggleMutation = useMutation<
    Note,
    Error,
    { noteId: string; checked: boolean },
    { previousCheckedAt: string | null }
  >({
    mutationFn: async ({ noteId, checked }) => {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ checked }),
      })
      if (!response.ok) throw await readJsonError(response)
      const data = await response.json()
      return data.note as Note
    },
    onMutate: async ({ noteId, checked }) => {
      await queryClient.cancelQueries({ queryKey })
      const previousCheckedAt =
        queryClient.getQueryData<Note[]>(queryKey)?.find((note) => note.id === noteId)
          ?.checked_at ?? null
      // Horodatage provisoire (ordre d'affichage), remplacé par celui du serveur.
      setCheckedAt(noteId, checked ? new Date().toISOString() : null)
      return { previousCheckedAt }
    },
    onSuccess: (updatedNote, { noteId }) => {
      queryClient.setQueryData<Note[]>(queryKey, (prev = []) =>
        prev.map((note) => (note.id === noteId ? updatedNote : note)),
      )
    },
    onError: (err, { noteId }, ctx) => {
      // Seul cet article revient en arrière : un autre coché entre-temps reste coché.
      if (ctx) setCheckedAt(noteId, ctx.previousCheckedAt)
      logger.error("Erreur lors du cochage de l'article:", err)
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
    /** Compteur du dashboard : tout sauf les courses déjà cochées. */
    pendingCount: notes.filter(isPendingNote).length,
    loading: isLoading,
    isFetching,
    error: queryError instanceof Error ? queryError.message : null,
    /** `true` si la note a été créée. */
    addNote: async (content: string, kind: NoteKind = 'note'): Promise<boolean> => {
      try {
        await addMutation.mutateAsync({ content, kind })
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
    /** `true` si l'article de courses a été coché / décoché. */
    toggleChecked: async (noteId: string, checked: boolean): Promise<boolean> => {
      try {
        await toggleMutation.mutateAsync({ noteId, checked })
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
