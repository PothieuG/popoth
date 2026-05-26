'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { logger } from '@/lib/logger'
import { invalidateFinancialRefreshes } from '@/lib/query-client'

/**
 * Shape miroir de `Database['public']['Tables']['savings_projects']['Row']`.
 * Dupliqué ici (vs import direct) pour éviter au consumer client de tirer
 * la chaîne `database.types.ts` complète — pattern identique à
 * `EstimatedBudget` dans useBudgets.ts.
 */
export interface SavingsProject {
  id: string
  profile_id: string | null
  group_id: string | null
  name: string
  target_amount: number
  monthly_allocation: number
  deadline_date: string
  amount_saved: number
  pending_delay_fraction: number
  created_at: string
  updated_at: string
}

interface AddProjectInput {
  name: string
  targetAmount: number
  monthlyAllocation: number
  deadlineDate: string
}

interface UpdateProjectInput {
  name: string
  targetAmount: number
  monthlyAllocation: number
  deadlineDate: string
}

interface UseProjectsReturn {
  projects: SavingsProject[]
  loading: boolean
  isFetching: boolean
  error: string | null
  addProject: (input: AddProjectInput) => Promise<boolean>
  updateProject: (projectId: string, input: UpdateProjectInput) => Promise<boolean>
  deleteProject: (
    projectId: string,
  ) => Promise<{ success: boolean; transferredAmount?: number; piggyAmount?: number | null }>
  refreshProjects: () => Promise<void>
  totalMonthlyAllocations: number
}

/**
 * Hook TanStack Query pour les projets d'épargne (perso ou groupe).
 * Miroir useBudgets : queryKey `['projects', context ?? null]`, 3 mutations
 * (add / update / delete) avec setQueryData optimiste + invalidations
 * cross-domain via `invalidateFinancialRefreshes`.
 */
export function useProjects(context?: 'profile' | 'group'): UseProjectsReturn {
  const queryClient = useQueryClient()
  const queryKey = ['projects', context ?? null]

  const {
    data: projects = [],
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery<SavingsProject[]>({
    queryKey,
    queryFn: async () => {
      const url = context
        ? `/api/finance/projects?group=${context === 'group'}`
        : '/api/finance/projects'
      const response = await fetch(url, { method: 'GET', credentials: 'include' })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return (data.projects ?? []) as SavingsProject[]
    },
  })

  const addMutation = useMutation<SavingsProject, Error, AddProjectInput>({
    mutationFn: async (input) => {
      const url = context
        ? `/api/finance/projects?context=${context}`
        : `/api/finance/projects?context=profile`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.project as SavingsProject
    },
    onSuccess: (newProject) => {
      queryClient.setQueryData<SavingsProject[]>(queryKey, (prev = []) => [newProject, ...prev])
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error("Erreur lors de l'ajout du projet:", err)
    },
  })

  const updateMutation = useMutation<
    SavingsProject,
    Error,
    { projectId: string; input: UpdateProjectInput }
  >({
    mutationFn: async ({ projectId, input }) => {
      const response = await fetch(`/api/finance/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Erreur ${response.status}: ${response.statusText}`)
      }
      const data = await response.json()
      return data.project as SavingsProject
    },
    onSuccess: (updatedProject, { projectId }) => {
      queryClient.setQueryData<SavingsProject[]>(queryKey, (prev = []) =>
        prev.map((project) => (project.id === projectId ? updatedProject : project)),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Erreur lors de la mise à jour du projet:', err)
    },
  })

  const deleteMutation = useMutation<
    { transferredAmount: number; piggyAmount: number | null },
    Error,
    string
  >({
    mutationFn: async (projectId) => {
      const response = await fetch(`/api/finance/projects/${projectId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Erreur lors de la suppression du projet')
      }
      const data = await response.json()
      return {
        transferredAmount: Number(data.transferredAmount ?? 0),
        piggyAmount:
          data.piggyAmount !== null && data.piggyAmount !== undefined
            ? Number(data.piggyAmount)
            : null,
      }
    },
    onSuccess: (_, projectId) => {
      queryClient.setQueryData<SavingsProject[]>(queryKey, (prev = []) =>
        prev.filter((project) => project.id !== projectId),
      )
      invalidateFinancialRefreshes(queryClient)
    },
    onError: (err) => {
      logger.error('Erreur lors de la suppression du projet:', err)
    },
  })

  const totalMonthlyAllocations = projects.reduce(
    (sum, project) => sum + Number(project.monthly_allocation),
    0,
  )

  const latestError =
    addMutation.error ?? updateMutation.error ?? deleteMutation.error ?? queryError
  const error = latestError instanceof Error ? latestError.message : null

  const refreshProjects = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    projects,
    loading: isLoading,
    isFetching,
    error,
    addProject: async (input) => {
      try {
        await addMutation.mutateAsync(input)
        return true
      } catch {
        return false
      }
    },
    updateProject: async (projectId, input) => {
      try {
        await updateMutation.mutateAsync({ projectId, input })
        return true
      } catch {
        return false
      }
    },
    deleteProject: async (projectId) => {
      try {
        const result = await deleteMutation.mutateAsync(projectId)
        return {
          success: true,
          transferredAmount: result.transferredAmount,
          piggyAmount: result.piggyAmount,
        }
      } catch {
        return { success: false }
      }
    },
    refreshProjects,
    totalMonthlyAllocations,
  }
}
