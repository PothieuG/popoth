'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { useLogoutAndRedirect } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useBankBalance } from '@/hooks/useBankBalance'
import { logger } from '@/lib/logger'
import FirstTimeProfileDialog from '@/components/profile/FirstTimeProfileDialog'
import ProfileSettingsCard from '@/components/profile/ProfileSettingsCard'
import UserInfoNavbar from '@/components/ui/UserInfoNavbar'
import UserAvatar from '@/components/ui/UserAvatar'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'
import EditableBalanceLine from '@/components/dashboard/EditableBalanceLine'
import EditTransactionModal from '@/components/dashboard/EditTransactionModal'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { usePeriodParam } from '@/hooks/usePeriodParam'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'

const AddTransactionModal = dynamic(() => import('@/components/dashboard/AddTransactionModal'), {
  ssr: false,
})

type EditableTransaction = RealExpense | RealIncome

/**
 * Dashboard page - main application page for authenticated users
 * Clean interface with sticky navbar, slide-out menu panel, and sticky footer
 */
export default function DashboardPage() {
  const { logoutAndRedirect } = useLogoutAndRedirect()
  const { profile, hasProfile, createProfile, isLoading } = useProfile()
  const { getUserContribution, fetchContributions } = useGroupContributions()
  const {
    financialData,
    loading: financialLoading,
    error: financialError,
    refreshFinancialData,
  } = useFinancialData()
  const { balance: bankBalance, updateBankBalance } = useBankBalance('profile')
  const { period, setPeriod } = usePeriodParam()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAddTransactionModalOpen, setIsAddTransactionModalOpen] = useState(false)
  const [isEditTransactionModalOpen, setIsEditTransactionModalOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<EditableTransaction | null>(null)
  const [editingTransactionType, setEditingTransactionType] = useState<'expense' | 'income'>(
    'expense',
  )

  /**
   * Gère la création du profil utilisateur
   */
  const handleProfileSubmit = async (firstName: string, lastName: string): Promise<boolean> => {
    const success = await createProfile({
      first_name: firstName,
      last_name: lastName,
    })

    return success
  }

  /**
   * Gère les erreurs de création de profil
   */
  const handleProfileError = (error: string) => {
    logger.error('Erreur lors de la création du profil:', error)
    // On peut ajouter une toast notification ici plus tard
  }

  /**
   * Gère la mise à jour du solde bancaire
   */
  const handleBankBalanceUpdate = async (newBalance: number) => {
    const success = await updateBankBalance(newBalance)
    if (success) {
      // Rafraîchir les données financières après la mise à jour du solde
      refreshFinancialData()
    }
  }

  /**
   * Gère l'ajout d'une transaction
   */
  const handleTransactionAdded = () => {
    // Rafraîchir les données financières après l'ajout d'une transaction
    refreshFinancialData()
  }

  /**
   * Gère l'édition d'une transaction
   */
  const handleEditTransaction = (transaction: EditableTransaction, type: 'expense' | 'income') => {
    setEditingTransaction(transaction)
    setEditingTransactionType(type)
    setIsEditTransactionModalOpen(true)
  }

  /**
   * Gère la mise à jour d'une transaction
   */
  const handleTransactionUpdated = () => {
    // Rafraîchir les données financières après la mise à jour d'une transaction
    refreshFinancialData()
  }

  // Récupérer les contributions quand le profil est chargé
  useEffect(() => {
    if (profile?.group_id && !isLoading) {
      fetchContributions()
    }
  }, [profile?.group_id, isLoading, fetchContributions])

  // Créer un composant de loader centralisé
  const renderCentralLoader = (message: string) => (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  )

  // Attendre que le profil soit chargé avant de décider quoi afficher
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Une fois chargé, si pas de profil, montrer la dialog
  if (!hasProfile) {
    return (
      <>
        <div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-100" />
        <FirstTimeProfileDialog
          isOpen={true}
          onSubmit={handleProfileSubmit}
          onError={handleProfileError}
        />
      </>
    )
  }

  // Si profil existe, afficher le dashboard normal
  return (
    <div className="fixed inset-0 flex flex-col bg-blue-50/50">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-xs">
        <div className="flex items-center justify-between p-4">
          <UserInfoNavbar
            profile={profile}
            userContribution={profile?.id ? getUserContribution(profile.id) : null}
          />
          <UserAvatar profile={profile} onClick={() => setIsMenuOpen(true)} size="md" />
        </div>
      </nav>

      {/* Main Content */}
      {isLoading || financialLoading ? (
        renderCentralLoader(
          isLoading ? 'Chargement du profil...' : 'Calcul des données financières...',
        )
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <div className="flex min-h-0 flex-1 flex-col space-y-4">
            {/* Financial Indicators */}
            {financialError ? (
              <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="flex items-center space-x-2">
                  <svg
                    className="h-5 w-5 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                  <div>
                    <p className="font-medium text-red-800">
                      Erreur de calcul des données financières
                    </p>
                    <p className="text-sm text-red-600">{financialError}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="shrink-0">
                  <FinancialIndicators
                    availableBalance={financialData?.availableBalance || 0}
                    remainingToLive={financialData?.remainingToLive || 0}
                    totalSavings={financialData?.totalSavings || 0}
                    onPlanningChange={refreshFinancialData}
                    context="profile"
                  />
                </div>

                {/* Period Selector (Sprint P1) — filtre listing transactions + progress bars budget */}
                <div className="flex shrink-0 justify-end">
                  <PeriodSelector value={period} onChange={setPeriod} />
                </div>

                {/* Transaction Tabs Component - Scrollable */}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <TransactionTabsComponent
                    context="profile"
                    userProfile={profile}
                    period={period}
                    onEditTransaction={handleEditTransaction}
                    onTransactionDeleted={refreshFinancialData}
                    className="h-full"
                  />
                </div>
              </>
            )}
          </div>
        </main>
      )}

      {/* Navigation Footer */}
      <footer className="shrink-0 border-t border-gray-200 bg-white">
        <div className="grid grid-cols-3">
          {/* Personal Finance Tab - Active state */}
          <button className="flex flex-col items-center justify-center border-r border-gray-200 bg-orange-50 p-3 transition-colors duration-200">
            <svg
              className="mb-1 h-5 w-5 text-orange-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <span className="text-xs font-medium text-orange-600">
              {profile?.first_name || 'Personnel'}
            </span>
          </button>

          {/* Group Finance Tab - Only visible if user belongs to a group */}
          {profile?.group_id ? (
            <button
              onClick={() => (window.location.href = '/group-dashboard')}
              className="flex flex-col items-center justify-center border-r border-gray-200 p-3 text-gray-600 transition-colors duration-200 hover:bg-gray-50"
            >
              <svg className="mb-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span className="text-xs">{profile?.group_name || 'Groupe'}</span>
            </button>
          ) : (
            <div className="flex flex-col items-center justify-center border-r border-gray-200 p-3 text-gray-400">
              <svg className="mb-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span className="text-xs">Aucun groupe</span>
            </div>
          )}

          {/* Add Transaction Tab - Orange border style */}
          <button
            onClick={() => setIsAddTransactionModalOpen(true)}
            className="flex flex-col items-center justify-center border-4 border-orange-500 p-3 transition-colors duration-200 hover:border-orange-600"
          >
            <div className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500">
              <svg
                className="h-4 w-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </div>
            <span className="text-xs font-medium text-orange-500">Ajouter</span>
          </button>
        </div>
      </footer>

      {/* Slide-out Menu Panel */}
      <>
        {/* Overlay */}
        <div
          className={`fixed inset-0 z-50 bg-black transition-all duration-300 ease-in-out ${
            isMenuOpen ? 'bg-opacity-50 visible' : 'bg-opacity-0 invisible'
          }`}
          onClick={() => setIsMenuOpen(false)}
        />

        {/* Menu Panel */}
        <div
          className={`fixed inset-y-0 right-0 z-50 w-full transform bg-white shadow-xl transition-all duration-300 ease-in-out ${
            isMenuOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="flex h-full flex-col">
            {/* Menu Header */}
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">Paramètres</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMenuOpen(false)}
                className="p-2"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            </div>

            {/* Menu Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Navigation Links */}
              <div className="mb-6 space-y-3">
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.href = '/settings'
                    setIsMenuOpen(false)
                  }}
                  className="w-full justify-start text-left"
                >
                  <svg
                    className="mr-3 h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  Gestion du groupe
                </Button>
              </div>

              {/* Profil utilisateur */}
              {profile && (
                <div className="space-y-4">
                  <ProfileSettingsCard className="border-0 bg-transparent p-0 shadow-none" />
                  <EditableBalanceLine
                    currentBalance={bankBalance}
                    onBalanceUpdate={handleBankBalanceUpdate}
                  />
                </div>
              )}
            </div>

            {/* Menu Footer with Logout */}
            <div className="border-t border-gray-200 p-4">
              <Button
                onClick={logoutAndRedirect}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50"
              >
                Se déconnecter
              </Button>
            </div>
          </div>
        </div>
      </>

      {/* Add Transaction Modal — conditional render so lazy useState
         init runs fresh on each open. */}
      {isAddTransactionModalOpen && (
        <AddTransactionModal
          onClose={() => setIsAddTransactionModalOpen(false)}
          context="profile"
          onTransactionAdded={handleTransactionAdded}
        />
      )}

      {/* Edit Transaction Modal — Sprint v8: Radix Dialog manages unmount-on-close,
         so the Sprint 1.5 `key={editingTransaction.id}` force-remount is no longer
         needed. The `editingTransaction &&` guard ensures the modal is only
         rendered when there's a transaction to edit ; onClose nulls it. */}
      {isEditTransactionModalOpen && editingTransaction && (
        <EditTransactionModal
          onClose={() => {
            setIsEditTransactionModalOpen(false)
            setEditingTransaction(null)
          }}
          transaction={editingTransaction}
          transactionType={editingTransactionType}
          context="profile"
          onTransactionUpdated={handleTransactionUpdated}
        />
      )}
    </div>
  )
}
