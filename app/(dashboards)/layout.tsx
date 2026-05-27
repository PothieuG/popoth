'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useLogoutAndRedirect } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { useGroups } from '@/hooks/useGroups'
import { useBankBalance } from '@/hooks/useBankBalance'
import { useFinancialData } from '@/hooks/useFinancialData'
import BottomNav from '@/components/dashboard/BottomNav'
import DashboardHeader from '@/components/dashboard/DashboardHeader'
import SettingsDrawer from '@/components/settings/SettingsDrawer'

const AddTransactionModal = dynamic(() => import('@/components/dashboard/AddTransactionModal'), {
  ssr: false,
})

/**
 * Layout partagé entre /dashboard (profile) et /group-dashboard (group).
 *
 * Le route group `(dashboards)` n'affecte pas les URLs publiques — Next.js
 * sait juste qu'il faut conserver ce layout entre navigations soeurs. Le
 * header + le footer (BottomNav) + le SettingsDrawer + l'AddTransactionModal
 * vivent ici et NE SONT PAS re-mountés au switch profile↔group. Les pages
 * enfants ne rendent que leur contenu de `<main>`, avec un loader inline
 * pendant `financialLoading` plutôt qu'un loader plein écran qui masquait
 * le header/footer (root cause du diagnostic 2026-05-20).
 *
 * Le `context: 'profile' | 'group'` est déduit via `usePathname()` —
 * pas de prop ni de provider. Le drawer + le modal d'ajout reçoivent
 * ce context dérivé pour conserver le comportement légacy par page.
 */
export default function DashboardsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const context: 'profile' | 'group' = pathname.startsWith('/group-dashboard') ? 'group' : 'profile'

  const { logoutAndRedirect } = useLogoutAndRedirect()
  const { profile } = useProfile()
  const { isCreator } = useGroups()
  const { balance: bankBalance, updateBankBalance } = useBankBalance(context)
  const { refreshFinancialData } = useFinancialData(context)

  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isAddTransactionModalOpen, setIsAddTransactionModalOpen] = useState(false)

  // Ferme automatiquement le modal d'ajout si l'utilisateur navigue
  // profile↔group pendant qu'il est ouvert — sinon le context du modal
  // (dérivé via usePathname) basculerait sous les hooks internes (useBudgets,
  // useRealExpenses, etc.) en pleine saisie de formulaire. Pattern "adjust
  // state during render" (React 19 — react.dev/learn/you-might-not-need-an-effect)
  // miroir du hasBeenOpened de SettingsDrawer.tsx:38-41.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setIsAddTransactionModalOpen(false)
  }

  const drawerTitle = context === 'group' ? 'Paramètres du groupe' : 'Paramètres'
  const showProfileCard = context === 'profile' && !!profile
  // En profile : la balance personnelle est toujours éditable.
  // En group : seul le creator du groupe peut éditer (cf. Sprint P7).
  const showBankBalanceLine = context === 'profile' ? !!profile : isCreator

  const handleBankBalanceUpdate = async (newBalance: number) => {
    const success = await updateBankBalance(newBalance)
    if (success) refreshFinancialData()
  }

  const handleTransactionAdded = () => {
    refreshFinancialData()
  }

  const hasGroup = !!profile?.group_id

  return (
    <div className="pl-safe pr-safe fixed inset-0 flex flex-col bg-blue-50/50">
      <DashboardHeader context={context} onOpenMenu={() => setIsMenuOpen(true)} />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</main>

      <BottomNav
        context={context}
        hasGroup={hasGroup}
        profileFirstName={profile?.first_name}
        groupName={profile?.group_name}
        onAddTransaction={() => setIsAddTransactionModalOpen(true)}
      />

      <SettingsDrawer
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        title={drawerTitle}
        showProfileCard={showProfileCard}
        showBankBalanceLine={showBankBalanceLine}
        bankBalance={bankBalance}
        onBankBalanceUpdate={handleBankBalanceUpdate}
        onLogout={logoutAndRedirect}
      />

      {isAddTransactionModalOpen && (
        <AddTransactionModal
          onClose={() => setIsAddTransactionModalOpen(false)}
          context={context}
          onTransactionAdded={handleTransactionAdded}
        />
      )}
    </div>
  )
}
