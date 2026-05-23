'use client'

import type { RecapStep } from '@/lib/recap'

const STEPS: ReadonlyArray<{ step: RecapStep; label: string }> = [
  { step: 'welcome', label: 'Bienvenue' },
  { step: 'summary', label: 'Récap général' },
  { step: 'manage_bilan', label: 'Bilan du mois' },
  { step: 'salary_update', label: 'Salaire' },
  { step: 'final_recap', label: 'Final' },
]

export function RecapProgressFrieze({ currentStep }: { currentStep: RecapStep }) {
  const safeStep: RecapStep = currentStep === 'completed' ? 'final_recap' : currentStep
  const idx = STEPS.findIndex((s) => s.step === safeStep)
  const total = STEPS.length
  const position = idx + 1
  const pct = Math.round((position / total) * 100)
  const entry = STEPS[idx]
  const label = entry ? entry.label : ''

  return (
    <div className="mb-6">
      <p className="mb-2 text-center text-sm font-medium text-gray-700">
        Étape {position} sur {total} — {label}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
        <div
          aria-label={`Étape ${position} sur ${total}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={pct}
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          role="progressbar"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
