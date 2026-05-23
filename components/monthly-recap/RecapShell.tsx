'use client'

import type { ReactNode } from 'react'

export function RecapShell({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-y-auto bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">{children}</div>
    </div>
  )
}
