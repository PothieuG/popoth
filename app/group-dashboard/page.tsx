'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { useGroupMembers } from '@/hooks/useGroupMembers'
import { useFinancialData } from '@/hooks/useFinancialData'
import { useBankBalance } from '@/hooks/useBankBalance'
import UserAvatar from '@/components/ui/UserAvatar'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'
import GroupInfoNavbar from '@/components/ui/GroupInfoNavbar'
import EditableBalanceLine from '@/components/dashboard/EditableBalanceLine'

/**
 * Group Dashboard page - dashboard view for group finances
 * Same UI as personal dashboard but with group-specific navbar and data
 */
export default function GroupDashboardPage() {
  const { logoutAndRedirect } = useAuth()
  const { profile, isLoading } = useProfile()
  const { members, fetchGroupMembers } = useGroupMembers()
  const { financialData, loading: financialLoading, error: financialError, refreshFinancialData } = useFinancialData('group')
  const { balance: bankBalance, updateBankBalance, refreshBankBalance } = useBankBalance('group')
  const [isMenuOpen, setIsMenuOpen] = useState(false)

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

  // Créer un composant de loader centralisé
  const renderCentralLoader = (message: string) => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">{message}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col bg-blue-50/50">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
        <div className="flex justify-between items-center p-4">
          <GroupInfoNavbar
            profile={profile}
            members={members}
          />
          <UserAvatar
            profile={profile}
            onClick={() => setIsMenuOpen(true)}
            size="md"
          />
        </div>
      </nav>

      {/* Main Content */}
      {(isLoading || financialLoading || !profile?.group_id) ? (
        renderCentralLoader(
          isLoading
            ? 'Chargement du groupe...'
            : !profile?.group_id
            ? 'Redirection vers le dashboard personnel...'
            : 'Calcul des données financières du groupe...'
        )
      ) : (
        <main className="flex-1 p-4">
          <div className="space-y-6">
            {/* Financial Indicators */}
            {financialError ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-center space-x-2">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div>
                    <p className="text-red-800 font-medium">Erreur de calcul des données financières du groupe</p>
                    <p className="text-red-600 text-sm">{financialError}</p>
                  </div>
                </div>
              </div>
            ) : (
              <FinancialIndicators
                availableBalance={financialData?.availableBalance || 0}
                remainingToLive={financialData?.remainingToLive || 0}
                totalSavings={financialData?.totalSavings || 0}
                onPlanningChange={refreshFinancialData}
                context="group"
              />
            )}
          </div>
        </main>
      )}

      {/* Navigation Footer */}
      <footer className="sticky bottom-0 z-40 bg-white border-t border-gray-200">
        <div className="flex justify-center items-center p-4 h-16">
          <div className="flex space-x-8">
            {/* Personal Finance Button */}
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="flex flex-col items-center justify-center p-3 rounded-lg transition-colors duration-200 hover:bg-gray-50 text-gray-600"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs">{profile?.first_name || 'Personnel'}</span>
            </button>

            {/* Group Finance Button - Active state with orange */}
            <button
              className="flex flex-col items-center justify-center p-3 rounded-lg bg-orange-50 border border-orange-200 transition-colors duration-200"
            >
              <svg className="w-6 h-6 mb-1 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-xs text-orange-600 font-medium">{profile?.group_name || 'Groupe'}</span>
            </button>
          </div>
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
        <div className={`fixed inset-y-0 right-0 z-50 w-full bg-white shadow-xl transform transition-all duration-300 ease-in-out ${
          isMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
          <div className="flex flex-col h-full">
            {/* Menu Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Paramètres du groupe</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMenuOpen(false)}
                className="p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>

            {/* Menu Content */}
            <div className="flex-1 p-4">
              {/* Navigation Links */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.href = '/settings'
                    setIsMenuOpen(false)
                  }}
                  className="w-full justify-start text-left"
                >
                  <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Gestion du groupe
                </Button>
              </div>

              {/* Solde bancaire du groupe */}
              <div className="space-y-4">
                <EditableBalanceLine
                  currentBalance={bankBalance}
                  onBalanceUpdate={handleBankBalanceUpdate}
                />
              </div>
            </div>

            {/* Menu Footer with Logout */}
            <div className="p-4 border-t border-gray-200">
              <Button
                onClick={logoutAndRedirect}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
              >
                Se déconnecter
              </Button>
            </div>
          </div>
        </div>
      </>
    </div>
  )
}