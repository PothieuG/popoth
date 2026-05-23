'use client'

import type { RecapContext } from '@/lib/recap'

export function WelcomeStep({ context }: { context: RecapContext }) {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Bienvenue</h1>
      <p className="text-sm text-gray-600">[TODO sprint 11] — contexte : {context}</p>
    </div>
  )
}
