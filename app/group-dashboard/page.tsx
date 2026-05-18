'use client'

import { useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { useLogoutAndRedirect } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { useGroups } from '@/hooks/useGroups'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useBankBalance } from '@/hooks/useBankBalance'
import UserAvatar from '@/components/ui/UserAvatar'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'
import GroupInfoNavbar from '@/components/ui/GroupInfoNavbar'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import SettingsDrawer from '@/components/settings/SettingsDrawer'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { usePeriodParam } from '@/hooks/usePeriodParam'

const AddTransactionModal = dynamic(() => import('@/components/dashboard/AddTransactionModal'), {
  ssr: false,
})

/**
 * Sprint P1 — wrapper component for group-dashboard's period-aware section,
 * mirror of DashboardPeriodSection in app/dashboard/page.tsx. Wraps the
 * usePeriodParam() hook in a parent <Suspense> boundary.
 */
interface GroupDashboardPeriodSectionProps {
  context: 'profile' | 'group'
  userProfile: Parameters<typeof TransactionTabsComponent>[0]['userProfile']
  onTransactionDeleted: Parameters<typeof TransactionTabsComponent>[0]['onTransactionDeleted']
}
function GroupDashboardPeriodSection({
  context,
  userProfile,
  onTransactionDeleted,
}: GroupDashboardPeriodSectionProps) {
  const { period, setPeriod } = usePeriodParam()
  return (
    <>
      <div className="flex shrink-0 justify-end">
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <TransactionTabsComponent
          context={context}
          userProfile={userProfile}
          period={period}
          onTransactionDeleted={onTransactionDeleted}
          className="h-full"
        />
      </div>
    </>
  )
}

/**
 * Group Dashboard page - dashboard view for group finances
 * Same UI as personal dashboard but with group-specific navbar and data
 */
export default function GroupDashboardPage() {
  const { logoutAndRedirect } = useLogoutAndRedirect()
  const { profile, isLoading } = useProfile()
  const { isCreator } = useGroups()
  const { members, fetchGroupMembers } = useGroupMembers()
  const {
    financialData,
    loading: financialLoading,
    error: financialError,
    refreshFinancialData,
  } = useFinancialData('group')
  const { balance: bankBalance, updateBankBalance } = useBankBalance('group')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAddTransactionModalOpen, setIsAddTransactionModalOpen] = useState(false)

  // Fetch group members when component loads
  useEffect(() => {
    if (profile?.group_id && !isLoading) {
      fetchGroupMembers(profile.group_id)
    }
  }, [profile?.group_id, isLoading, fetchGroupMembers])

  // Redirect to personal dashboard if user has no group
  useEffect(() => {
    if (!isLoading && profile && !profile.group_id) {
      window.location.href = '/dashboard'
    }
  }, [isLoading, profile])

  /**
   * Gère la mise à jour du solde bancaire du groupe
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

  // Créer un composant de loader centralisé
  const renderCentralLoader = (message: string) => (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 flex flex-col bg-blue-50/50">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 border-b border-gray-200 bg-white shadow-xs">
        <div className="flex items-center justify-between p-4">
          <GroupInfoNavbar profile={profile} members={members} />
          <UserAvatar profile={profile} onClick={() => setIsMenuOpen(true)} size="md" />
        </div>
      </nav>

      {/* Main Content */}
      {isLoading || financialLoading || !profile?.group_id ? (
        renderCentralLoader(
          isLoading
            ? 'Chargement du groupe...'
            : !profile?.group_id
              ? 'Redirection vers le dashboard personnel...'
              : 'Calcul des données financières du groupe...',
        )
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <div className="flex min-h-0 flex-1 flex-col space-y-4">
            {/* Financial Indicators */}
            {financialError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
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
                      Erreur de calcul des données financières du groupe
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
                    context="group"
                  />
                </div>

                {/* Sprint P1 — period state wrapped in Suspense because usePeriodParam()
                    uses useSearchParams() which requires a Suspense boundary at build time. */}
                <Suspense fallback={null}>
                  <GroupDashboardPeriodSection
                    context="group"
                    userProfile={profile}
                    onTransactionDeleted={refreshFinancialData}
                  />
                </Suspense>
              </>
            )}
          </div>
        </main>
      )}

      {/* Navigation Footer */}
      <footer className="shrink-0 border-t border-gray-200 bg-white">
        <div className="grid grid-cols-3">
          {/* Personal Finance Tab */}
          <button
            onClick={() => (window.location.href = '/dashboard')}
            className="flex flex-col items-center justify-center border-r border-gray-200 p-3 text-gray-600 transition-colors duration-200 hover:bg-gray-50"
          >
            <svg className="mb-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <span className="text-xs">{profile?.first_name || 'Personnel'}</span>
          </button>

          {/* Group Finance Tab - Active state */}
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
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span className="text-xs font-medium text-orange-600">
              {profile?.group_name || 'Groupe'}
            </span>
          </button>

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

      {/* Settings Drawer — swap horizontal entre paramètres et gestion de groupe.
         Sprint P7 : EditableBalanceLine du groupe est creator-only. */}
      <SettingsDrawer
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        title="Paramètres du groupe"
        showProfileCard={false}
        showBankBalanceLine={isCreator}
        bankBalance={bankBalance}
        onBankBalanceUpdate={handleBankBalanceUpdate}
        onLogout={logoutAndRedirect}
      />

      {/* Add Transaction Modal — conditional render so lazy useState
         init runs fresh on each open. */}
      {isAddTransactionModalOpen && (
        <AddTransactionModal
          onClose={() => setIsAddTransactionModalOpen(false)}
          context="group"
          onTransactionAdded={handleTransactionAdded}
        />
      )}
    </div>
  )
}
