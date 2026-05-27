'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import ProfileSettingsCard from '@/components/profile/ProfileSettingsCard'
import EditableBalanceLine from '@/components/dashboard/EditableBalanceLine'
import GroupManagementPanel from '@/components/settings/GroupManagementPanel'
import { useDialogBackButton } from '@/hooks/useDialogBackButton'

interface SettingsDrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  showProfileCard: boolean
  showBankBalanceLine: boolean
  bankBalance: number
  onBankBalanceUpdate: (newBalance: number) => Promise<void> | void
  onLogout: () => void
}

type DrawerView = 'main' | 'group-management'

export default function SettingsDrawer({
  isOpen,
  onClose,
  title,
  showProfileCard,
  showBankBalanceLine,
  bankBalance,
  onBankBalanceUpdate,
  onLogout,
}: SettingsDrawerProps) {
  const [view, setView] = useState<DrawerView>('main')

  // Non-Radix drawer → branche le geste retour mobile manuellement (le wrapper
  // <Dialog> ne nous concerne pas ici). Voir [hooks/useDialogBackButton.ts].
  useDialogBackButton(isOpen, onClose)

  // Lazy-mount <GroupManagementPanel> : monte à la 1re ouverture pour éviter
  // le fetch /api/groups spéculatif au mount du dashboard, jamais consommé
  // tant que l'utilisateur n'a pas ouvert le drawer. Pattern "adjust state
  // during render" (React 19 — react.dev/learn/you-might-not-need-an-effect).
  const [hasBeenOpened, setHasBeenOpened] = useState(false)
  if (isOpen && !hasBeenOpened) {
    setHasBeenOpened(true)
  }

  // Reset à 'main' après la fin de l'animation de close (300ms) pour ne pas
  // voir un snap visuel pendant la fermeture du drawer.
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => setView('main'), 300)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  return (
    <>
      {/* Overlay — Tailwind v4: use bg-black/50 + opacity-* (legacy bg-opacity-* utilities removed) */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-all duration-300 ease-in-out ${
          isOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full transform bg-white shadow-xl transition-all duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Horizontal swap track */}
        <div className="relative h-full overflow-hidden">
          {/* Main panel */}
          <div
            className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${
              view === 'main' ? 'translate-x-0' : '-translate-x-full'
            }`}
            aria-hidden={view !== 'main'}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="p-2"
                aria-label="Fermer"
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Navigation: gestion du groupe — menu item style iOS Settings */}
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setView('group-management')}
                  className="group flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-indigo-50 p-4 text-left shadow-xs transition-all hover:border-blue-300 hover:from-blue-100 hover:to-indigo-100 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none active:scale-[0.98]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-600 to-purple-600 text-white shadow-sm">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Gestion du groupe</p>
                    <p className="text-xs text-gray-600">Créer, rejoindre ou quitter un groupe</p>
                  </div>
                  <svg
                    className="h-5 w-5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>

              {/* Profile + bank balance sections */}
              {(showProfileCard || showBankBalanceLine) && (
                <div className="space-y-3">
                  {showProfileCard && (
                    <ProfileSettingsCard className="border-0 bg-transparent p-0 shadow-none" />
                  )}
                  {showBankBalanceLine && (
                    <EditableBalanceLine
                      currentBalance={bankBalance}
                      onBalanceUpdate={onBankBalanceUpdate}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Footer logout */}
            <div className="border-t border-gray-200 p-4">
              <Button
                onClick={onLogout}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50"
              >
                Se déconnecter
              </Button>
            </div>
          </div>

          {/* Group management panel */}
          <div
            className={`absolute inset-0 flex flex-col transition-transform duration-300 ease-in-out ${
              view === 'group-management' ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={view !== 'group-management'}
          >
            {hasBeenOpened && (
              <GroupManagementPanel onBack={() => setView('main')} onClose={onClose} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
