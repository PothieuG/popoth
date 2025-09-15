'use client'

import { useState, useEffect } from 'react'

interface BankBalanceState {
  balance: number
  loading: boolean
  error: string | null
}

/**
 * Hook personnalisé pour gérer le solde bancaire éditable
 * Permet de récupérer et mettre à jour le solde bancaire de l'utilisateur
 */
export function useBankBalance() {
  const [state, setState] = useState<BankBalanceState>({
    balance: 0,
    loading: true,
    error: null
  })

  /**
   * Récupère le solde bancaire depuis l'API
   */
  const fetchBankBalance = async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }))

      const response = await fetch('/api/bank-balance')

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Erreur API bank-balance:', response.status, errorText)

        // Si la table n'existe pas, on initialise le solde à 0 sans erreur
        if (response.status === 500 && errorText.includes('relation "bank_balances" does not exist')) {
          setState(prev => ({
            ...prev,
            balance: 0,
            loading: false
          }))
          return
        }

        throw new Error(`Erreur ${response.status}: ${errorText}`)
      }

      const data = await response.json()
      setState(prev => ({
        ...prev,
        balance: data.balance,
        loading: false
      }))
    } catch (error) {
      console.error('Erreur lors de la récupération du solde bancaire:', error)
      setState(prev => ({
        ...prev,
        balance: 0, // Valeur par défaut en cas d'erreur
        loading: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      }))
    }
  }

  /**
   * Met à jour le solde bancaire
   */
  const updateBankBalance = async (newBalance: number): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }))

      const response = await fetch('/api/bank-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ balance: newBalance })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la mise à jour du solde')
      }

      setState(prev => ({
        ...prev,
        balance: data.balance,
        loading: false
      }))

      return true
    } catch (error) {
      console.error('Erreur lors de la mise à jour du solde bancaire:', error)
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
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
  }, [])

  return {
    balance: state.balance,
    loading: state.loading,
    error: state.error,
    updateBankBalance,
    refreshBankBalance
  }
}