'use client'

import { useState, Suspense } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { useFinancialData } from '@/hooks/useFinancialData'
import { logger } from '@/lib/logger'
import FirstTimeProfileDialog from '@/components/profile/FirstTimeProfileDialog'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'
import EditTransactionModal from '@/components/dashboard/EditTransactionModal'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import CentralLoader from '@/components/ui/CentralLoader'
import { usePeriodParam } from '@/hooks/usePeriodParam'
import type { RealExpense } from '@/hooks/useRealExpenses'
import type { RealIncome } from '@/hooks/useRealIncomes'

type EditableTransaction = RealExpense | RealIncome

/**
 * Sprint P1 — wrapper component that calls usePeriodParam (which uses
 * useSearchParams). Must be wrapped in `<Suspense>` by the parent so Next.js
 * static prerendering doesn't fail at build time.
 */
interface DashboardPeriodSectionProps {
  userProfile: Parameters<typeof TransactionTabsComponent>[0]['userProfile']
  onEditTransaction: Parameters<typeof TransactionTabsComponent>[0]['onEditTransaction']
  onTransactionDeleted: Parameters<typeof TransactionTabsComponent>[0]['onTransactionDeleted']
}
function DashboardPeriodSection({
  userProfile,
  onEditTransaction,
  onTransactionDeleted,
}: DashboardPeriodSectionProps) {
  const { period } = usePeriodParam()
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <TransactionTabsComponent
        context="profile"
        userProfile={userProfile}
        period={period}
        onEditTransaction={onEditTransaction}
        onTransactionDeleted={onTransactionDeleted}
        className="h-full"
      />
    </div>
  )
}

/**
 * Dashboard "personnel" — main content uniquement. Le header sticky, la
 * BottomNav, le SettingsDrawer et l'AddTransactionModal vivent dans
 * `app/(dashboards)/layout.tsx` et persistent à la navigation soeur.
 */
export default function DashboardPage() {
  const { profile, hasProfile, createProfile, isLoading } = useProfile()
  const {
    financialData,
    loading: financialLoading,
    error: financialError,
    refreshFinancialData,
  } = useFinancialData()

  const [isEditTransactionModalOpen, setIsEditTransactionModalOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<EditableTransaction | null>(null)
  const [editingTransactionType, setEditingTransactionType] = useState<'expense' | 'income'>(
    'expense',
  )

  const handleProfileSubmit = async (firstName: string, lastName: string): Promise<boolean> => {
    return createProfile({ first_name: firstName, last_name: lastName })
  }

  const handleProfileError = (error: string) => {
    logger.error('Erreur lors de la création du profil:', error)
  }

  const handleEditTransaction = (transaction: EditableTransaction, type: 'expense' | 'income') => {
    setEditingTransaction(transaction)
    setEditingTransactionType(type)
    setIsEditTransactionModalOpen(true)
  }

  // Loading initial du profil — le header (layout) reste visible avec son
  // fallback "Chargement..." dans UserInfoNavbar.
  if (isLoading) {
    return <CentralLoader message="Chargement du profil..." />
  }

  // Premier login : profil absent en DB, montrer la dialog d'onboarding.
  // Le layout (header + footer) reste rendu en arrière-plan ; le dialog
  // Radix se place en portal au-dessus.
  if (!hasProfile) {
    return (
      <FirstTimeProfileDialog
        isOpen={true}
        onSubmit={handleProfileSubmit}
        onError={handleProfileError}
      />
    )
  }

  if (financialLoading) {
    return <CentralLoader message="Calcul des données financières..." />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4">
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
              <p className="font-medium text-red-800">Erreur de calcul des données financières</p>
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

          <Suspense fallback={null}>
            <DashboardPeriodSection
              userProfile={profile}
              onEditTransaction={handleEditTransaction}
              onTransactionDeleted={refreshFinancialData}
            />
          </Suspense>
        </>
      )}

      {/* Edit Transaction Modal — page-scoped (profile context uniquement).
         L'Add modal vit dans le layout pour être réutilisé par /group-dashboard. */}
      {isEditTransactionModalOpen && editingTransaction && (
        <EditTransactionModal
          onClose={() => {
            setIsEditTransactionModalOpen(false)
            setEditingTransaction(null)
          }}
          transaction={editingTransaction}
          transactionType={editingTransactionType}
          context="profile"
          onTransactionUpdated={refreshFinancialData}
        />
      )}
    </div>
  )
}
