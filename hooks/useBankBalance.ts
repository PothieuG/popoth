'use client'

import { useState, useEffect } from 'react'
import { logger } from '@/lib/logger'

interface BankBalanceState {
  balance: number
  loading: boolean
  error: string | null
}

/**
 * Hook personnalisé pour gérer le solde bancaire éditable
 * Permet de récupérer et mettre à jour le solde bancaire de l'utilisateur ou du groupe
 */
export function useBankBalance(context?: 'profile' | 'group') {
  const [state, setState] = useState<BankBalanceState>({
    balance: 0,
    loading: true,
    error: null,
  })

  /**
   * Récupère le solde bancaire depuis l'API
   */
  const fetchBankBalance = async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }))

      const url = context ? `/api/bank-balance?context=${context}` : '/api/bank-balance'
      const response = await fetch(url)

      if (!response.ok) {
        const errorText = await response.text()
        // Validation diagnostic — branche 500+missing-table est un fallback légit, log helps grep
        logger.warn('Erreur API bank-balance:', response.status, errorText)

        // Si la table n'existe pas, on initialise le solde à 0 sans erreur
        if (
          response.status === 500 &&
          errorText.includes('relation "bank_balances" does not exist')
        ) {
          setState((prev) => ({
            ...prev,
            balance: 0,
            loading: false,
          }))
          return
        }

        throw new Error(`Erreur ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      setState((prev) => ({
        ...prev,
        balance: data.balance,
        loading: false,
      }))
    } catch (error) {
      logger.error('Erreur lors de la récupération du solde bancaire:', error)
      setState((prev) => ({
        ...prev,
        balance: 0, // Valeur par défaut en cas d'erreur
        loading: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      }))
    }
  }

  /**
   * Met à jour le solde bancaire
   */
  const updateBankBalance = async (newBalance: number): Promise<boolean> => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }))

      const url = context ? `/api/bank-balance?context=${context}` : '/api/bank-balance'
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ balance: newBalance }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du solde')
      }

      setState((prev) => ({
        ...prev,
        balance: data.balance,
        loading: false,
      }))

      return true
    } catch (error) {
      logger.error('Erreur lors de la mise à jour du solde bancaire:', error)
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue',
      }))
      return false
    }
  }

  /**
   * Recharge le solde bancaire
   */
  const refreshBankBalance = () => {
    fetchBankBalance()
  }

  // Chargement initial du solde
  useEffect(() => {
    fetchBankBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchBankBalance is recreated each render; only refetch when context changes
  }, [context])

  return {
    balance: state.balance,
    loading: state.loading,
    error: state.error,
    updateBankBalance,
    refreshBankBalance,
  }
}
