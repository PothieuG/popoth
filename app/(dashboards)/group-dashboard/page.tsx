'use client'

import { Suspense, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useProfile } from '@/hooks/useProfile'
import { useFinancialData } from '@/hooks/useFinancialData'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'
import TransactionTabsComponent from '@/components/dashboard/TransactionTabsComponent'
import CentralLoader from '@/components/ui/CentralLoader'
import { usePeriodParam } from '@/hooks/usePeriodParam'

/**
 * Sprint P1 — mirror of DashboardPeriodSection (profile). Wraps usePeriodParam
 * inside a parent <Suspense>.
 */
interface GroupDashboardPeriodSectionProps {
  userProfile: Parameters<typeof TransactionTabsComponent>[0]['userProfile']
  onTransactionDeleted: Parameters<typeof TransactionTabsComponent>[0]['onTransactionDeleted']
}
function GroupDashboardPeriodSection({
  userProfile,
  onTransactionDeleted,
}: GroupDashboardPeriodSectionProps) {
  const { period } = usePeriodParam()
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <TransactionTabsComponent
        context="group"
        userProfile={userProfile}
        period={period}
        onTransactionDeleted={onTransactionDeleted}
        className="h-full"
      />
    </div>
  )
}

/**
 * Dashboard "groupe" — main content uniquement. Header sticky, BottomNav,
 * SettingsDrawer et AddTransactionModal vivent dans `app/(dashboards)/layout.tsx`
 * (persistent à la navigation soeur). Si l'utilisateur n'a pas de groupe
 * (`!profile.group_id`), redirection soft via `router.replace('/dashboard')`
 * avec ref-guard pour empêcher tout double-fire si le useEffect re-render
 * avant la nav.
 */
export default function GroupDashboardPage() {
  const router = useRouter()
  const { profile, isLoading } = useProfile()
  const {
    financialData,
    loading: financialLoading,
    error: financialError,
    refreshFinancialData,
  } = useFinancialData('group')

  const redirected = useRef(false)

  useEffect(() => {
    if (!isLoading && profile && !profile.group_id && !redirected.current) {
      redirected.current = true
      router.replace('/dashboard')
    }
  }, [isLoading, profile, router])

  if (isLoading) {
    return <CentralLoader message="Chargement du groupe..." />
  }

  // Cas redirection en cours (no group_id). Le useEffect ci-dessus a déjà
  // fire router.replace ; on affiche un loader transitoire le temps que
  // Next.js commit la navigation.
  if (!profile?.group_id) {
    return <CentralLoader message="Redirection vers le dashboard personnel..." />
  }

  if (financialLoading) {
    return <CentralLoader message="Calcul des données financières du groupe..." />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      {financialError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center space-x-1.5">
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

          <Suspense fallback={null}>
            <GroupDashboardPeriodSection
              userProfile={profile}
              onTransactionDeleted={refreshFinancialData}
            />
          </Suspense>
        </>
      )}
    </div>
  )
}
