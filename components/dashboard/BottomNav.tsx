'use client'

import { useRouter } from 'next/navigation'

interface BottomNavProps {
  context: 'profile' | 'group'
  hasGroup: boolean
  profileFirstName?: string | null
  groupName?: string | null
  onAddTransaction: () => void
}

/**
 * Navbar bottom partagée entre /dashboard et /group-dashboard.
 *
 * 3 tabs : Personnel | Groupe (ou "Aucun groupe" si !hasGroup) | Ajouter.
 * Le tab actif est déterminé par `context`. La navigation utilise
 * `router.push()` (soft client-side nav) — JAMAIS `window.location.href`
 * (qui ferait un hard reload + perdrait le QueryClient cache).
 */
export default function BottomNav({
  context,
  hasGroup,
  profileFirstName,
  groupName,
  onAddTransaction,
}: BottomNavProps) {
  const router = useRouter()
  const isProfile = context === 'profile'
  const isGroup = context === 'group'

  return (
    <footer className="pb-safe shrink-0 border-t border-gray-200 bg-white">
      <div className="grid grid-cols-3">
        {/* Personal Finance Tab */}
        <button
          onClick={() => {
            if (!isProfile) router.push('/dashboard')
          }}
          aria-current={isProfile ? 'page' : undefined}
          className={`flex flex-col items-center justify-center border-r border-gray-200 p-3 transition-colors duration-200 ${
            isProfile ? 'bg-orange-50' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <svg
            className={`mb-1 h-5 w-5 ${isProfile ? 'text-orange-600' : ''}`}
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
          <span className={`text-xs ${isProfile ? 'font-medium text-orange-600' : ''}`}>
            {profileFirstName || 'Personnel'}
          </span>
        </button>

        {/* Group Finance Tab */}
        {hasGroup ? (
          <button
            onClick={() => {
              if (!isGroup) router.push('/group-dashboard')
            }}
            aria-current={isGroup ? 'page' : undefined}
            className={`flex flex-col items-center justify-center border-r border-gray-200 p-3 transition-colors duration-200 ${
              isGroup ? 'bg-orange-50' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg
              className={`mb-1 h-5 w-5 ${isGroup ? 'text-orange-600' : ''}`}
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
            <span className={`text-xs ${isGroup ? 'font-medium text-orange-600' : ''}`}>
              {groupName || 'Groupe'}
            </span>
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

        {/* Add Transaction Tab — Orange border style */}
        <button
          onClick={onAddTransaction}
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
  )
}
