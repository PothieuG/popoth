'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

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

export function RecapWizard({ context }: { context: RecapContext }) {
  const router = useRouter()
  const { data, isLoading, error } = useMonthlyRecap(context)

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
  const { status, summary } = data

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
        <p className="text-center text-sm text-gray-700">Récap déjà terminé, redirection…</p>
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
          <BilanNegativeStep context={context} summary={summary} />
        ) : (
          <BilanPositiveStep context={context} summary={summary} />
        ))}
      {status.step === 'salary_update' && <SalaryUpdateStep context={context} summary={summary} />}
      {status.step === 'final_recap' && <FinalRecapStep context={context} summary={summary} />}
      {status.step === 'completed' && (
        <p className="text-center text-sm text-gray-700">Redirection…</p>
      )}
    </RecapShell>
  )
}
