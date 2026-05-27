'use client'

import type { ReactNode } from 'react'

interface RecapShellProps {
  children: ReactNode
  /**
   * Sprint 14 follow-up 2026-05-25 — small centered pill displayed above
   * the wizard content, identifying who/what this recap is for ("Recap de
   * <prénom>" en profile, "Recap du groupe « <name> »" en group). Nuances
   * de gris (border-300 / bg-50 / text-700) — sobre, lisible sur le fond
   * bleu/indigo, ne compete avec aucune couleur métier. Optionnel : la
   * Suspense fallback dans `app/monthly-recap/page.tsx` n'a pas accès au
   * profil donc la pose pas, ce qui évite un flicker "Recap de undefined".
   */
  headerLabel?: string | null
}

export function RecapShell({ children, headerLabel }: RecapShellProps) {
  return (
    <div className="pt-safe pb-safe pl-safe pr-safe fixed inset-0 flex flex-col overflow-y-auto bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">
        {headerLabel && (
          <div className="mb-4 flex justify-center">
            <span className="rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs font-semibold tracking-wide text-gray-700">
              {headerLabel}
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
