'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useMonthlyRecap } from '@/hooks/useMonthlyRecap'
import type { RecapContext } from '@/lib/recap'

import { GroupLockScreen } from './GroupLockScreen'
import { RecapProgressFrieze } from './RecapProgressFrieze'
import { RecapShell } from './RecapShell'
import { BilanNegativeStep } from './steps/BilanNegativeStep'
import { BilanPositiveStep } from './steps/BilanPositiveStep'
import { FinalRecapStep } from './steps/FinalRecapStep'
import { SalaryUpdateStep } from './steps/SalaryUpdateStep'
import { SummaryStep } from './steps/SummaryStep'
import { WelcomeStep } from './steps/WelcomeStep'

/**
 * Plein-écran "redirecting" state — centered orange spinner + copy. Used
 * by the wizard whenever the recap status moves to `completed` (post-finalize)
 * but the router.replace hasn't unmounted us yet. Better UX than the previous
 * single-line text (sprint 14 follow-up 2026-05-25).
 */
function RecapRedirecting({ copy }: { copy: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
    >
      <Loader2 className="h-10 w-10 animate-spin text-orange-500" aria-hidden="true" />
      <p className="text-sm font-medium text-gray-700">{copy}</p>
    </div>
  )
}

export function RecapWizard({ context }: { context: RecapContext }) {
  const router = useRouter()
  const { data, isLoading, error } = useMonthlyRecap(context)

  // Sprint 14 — transient flag lifted here so SalaryUpdateStep (écran 4)
  // can signal a successful salary submit AND FinalRecapStep (écran 5) can
  // surface "Salaire mis à jour" / "Contribution mise à jour". Refresh
  // resets to false (trade-off accepté — pas de tracking serveur).
  const [salaryUpdated, setSalaryUpdated] = useState(false)
  const markSalaryUpdated = useCallback(() => setSalaryUpdated(true), [])

  const kind = data?.status.kind ?? null

  useEffect(() => {
    if (kind === 'completed') {
      const target = context === 'group' ? '/group-dashboard' : '/dashboard'
      router.replace(target)
    }
  }, [kind, context, router])

  if (isLoading) {
    return (
      <RecapShell>
        <div className="space-y-3">
          <div className="h-4 w-3/4 animate-pulse rounded bg-blue-200/60" />
          <div className="h-2 w-full animate-pulse rounded bg-blue-200/60" />
          <div className="h-40 w-full animate-pulse rounded bg-blue-200/40" />
        </div>
      </RecapShell>
    )
  }

  if (error) {
    return (
      <RecapShell>
        <p className="text-center text-sm text-red-700">Erreur de chargement : {error.message}</p>
      </RecapShell>
    )
  }

  if (!data) return null
  const { status, summary, recap } = data

  if (status.kind === 'locked_by_other') {
    return (
      <RecapShell>
        <GroupLockScreen startedByName={status.startedByName} />
      </RecapShell>
    )
  }

  if (status.kind === 'completed') {
    return (
      <RecapShell>
        <RecapRedirecting copy="Redirection vers le dashboard…" />
      </RecapShell>
    )
  }

  if (status.kind === 'no_recap') {
    return (
      <RecapShell>
        <RecapProgressFrieze currentStep="welcome" />
        <WelcomeStep context={context} />
      </RecapShell>
    )
  }

  // status.kind === 'in_progress'
  if (!summary) {
    return (
      <RecapShell>
        <p className="text-center text-sm text-red-700">Erreur interne : summary manquant.</p>
      </RecapShell>
    )
  }

  return (
    <RecapShell>
      <RecapProgressFrieze currentStep={status.step} />
      {status.step === 'welcome' && <WelcomeStep context={context} />}
      {status.step === 'summary' && <SummaryStep context={context} summary={summary} />}
      {status.step === 'manage_bilan' &&
        (summary.bilanSign === 'negative' ? (
          recap ? (
            <BilanNegativeStep context={context} summary={summary} recap={recap} />
          ) : (
            <p className="text-center text-sm text-red-700">Erreur interne : recap manquant.</p>
          )
        ) : (
          <BilanPositiveStep context={context} summary={summary} />
        ))}
      {status.step === 'salary_update' && (
        <SalaryUpdateStep context={context} summary={summary} onSalaryUpdated={markSalaryUpdated} />
      )}
      {status.step === 'final_recap' && (
        <FinalRecapStep
          context={context}
          summary={summary}
          recap={recap}
          salaryUpdated={salaryUpdated}
        />
      )}
      {status.step === 'completed' && <RecapRedirecting copy="Redirection vers le dashboard…" />}
    </RecapShell>
  )
}
