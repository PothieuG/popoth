'use client'

import type { ReactNode } from 'react'

interface RecapShellProps {
  children: ReactNode
  /**
   * Sprint 14 follow-up 2026-05-25 — small centered pill displayed above
   * the wizard content, identifying who/what this recap is for ("Recap de
   * <prénom>" en profile, "Recap du groupe « <name> »" en group). Teal
   * family — la seule jamais utilisée ailleurs dans l'app, contraste net
   * avec le fond bleu/indigo de la shell. Optionnel : la Suspense fallback
   * dans `app/monthly-recap/page.tsx` n'a pas accès au profil donc la pose
   * pas, ce qui évite un flicker "Recap de undefined".
   */
  headerLabel?: string | null
}

export function RecapShell({ children, headerLabel }: RecapShellProps) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">
        {headerLabel && (
          <div className="mb-4 flex justify-center">
            <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold tracking-wide text-teal-800">
              {headerLabel}
            </span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
