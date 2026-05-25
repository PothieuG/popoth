'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useMonthlyRecap } from '@/hooks/useMonthlyRecap'
import { useProfile } from '@/hooks/useProfile'
import type { RecapContext } from '@/lib/recap'

import { GroupLockScreen } from './GroupLockScreen'
import { RecapProgressFrieze } from './RecapProgressFrieze'
import { RecapShell } from './RecapShell'
import { BilanNegativeStep } from './steps/BilanNegativeStep'
import { BilanPositiveStep } from './steps/BilanPositiveStep'
import { CompleteMonthStep } from './steps/CompleteMonthStep'
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
  const { profile } = useProfile()

  // Sprint 14 — transient flag lifted here so SalaryUpdateStep (écran 4)
  // can signal a successful salary submit AND FinalRecapStep (écran 5) can
  // surface "Salaire mis à jour" / "Contribution mise à jour". Refresh
  // resets to false (trade-off accepté — pas de tracking serveur).
  const [salaryUpdated, setSalaryUpdated] = useState(false)
  const markSalaryUpdated = useCallback(() => setSalaryUpdated(true), [])

  // Sprint 14 follow-up 2026-05-25 — Peek at the group recap status when
  // the user just finished a profile recap and belongs to a group, so the
  // final screen can nudge them to do the group recap next (the proxy
  // gating only checks the context the user navigates to, so a profile
  // recap completion leaves the group recap silently pending). Reverse
  // direction (group→profile) is NOT implemented yet — the proxy already
  // catches /dashboard for profile recap, but if the user lands on
  // /group-dashboard their profile recap goes unprompted (followup
  // candidate).
  const peekGroupRecap = context === 'profile' && profile?.group_id != null
  const { data: groupRecapData } = useMonthlyRecap('group', { enabled: peekGroupRecap })
  const groupRecapPending =
    peekGroupRecap && groupRecapData != null && groupRecapData.status.kind !== 'completed'
  const groupName = profile?.group_name ?? null

  // Sprint 14 follow-up 2026-05-25 — pill au-dessus de la shell, identifie
  // pour qui le recap est fait. `null` quand on n'a pas encore l'info (skip
  // le rendu plutôt qu'un "Recap de undefined" flicker).
  let headerLabel: string | null = null
  if (context === 'profile') {
    headerLabel = profile?.first_name ? `Recap de ${profile.first_name}` : null
  } else {
    headerLabel = profile?.group_name
      ? `Recap du groupe « ${profile.group_name} »`
      : 'Recap du groupe'
  }

  const kind = data?.status.kind ?? null

  useEffect(() => {
    if (kind === 'completed') {
      let target: string
      if (groupRecapPending) {
        target = '/monthly-recap?context=group'
      } else if (context === 'group') {
        target = '/group-dashboard'
      } else {
        target = '/dashboard'
      }
      router.replace(target)
    }
  }, [kind, context, groupRecapPending, router])

  if (isLoading) {
    return (
      <RecapShell headerLabel={headerLabel}>
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
      <RecapShell headerLabel={headerLabel}>
        <p className="text-center text-sm text-red-700">Erreur de chargement : {error.message}</p>
      </RecapShell>
    )
  }

  if (!data) return null
  const { status, summary, recap, recapYear, recapMonth } = data

  if (status.kind === 'locked_by_other') {
    return (
      <RecapShell headerLabel={headerLabel}>
        <GroupLockScreen startedByName={status.startedByName} />
      </RecapShell>
    )
  }

  if (status.kind === 'completed') {
    return (
      <RecapShell headerLabel={headerLabel}>
        <RecapRedirecting copy="Redirection vers le dashboard…" />
      </RecapShell>
    )
  }

  if (status.kind === 'no_recap') {
    return (
      <RecapShell headerLabel={headerLabel}>
        <RecapProgressFrieze currentStep="welcome" />
        <WelcomeStep context={context} />
      </RecapShell>
    )
  }

  // status.kind === 'in_progress'
  if (!summary) {
    return (
      <RecapShell headerLabel={headerLabel}>
        <p className="text-center text-sm text-red-700">Erreur interne : summary manquant.</p>
      </RecapShell>
    )
  }

  return (
    <RecapShell headerLabel={headerLabel}>
      <RecapProgressFrieze currentStep={status.step} />
      {status.step === 'welcome' && <WelcomeStep context={context} />}
      {status.step === 'complete_month' && (
        <CompleteMonthStep context={context} recapYear={recapYear} recapMonth={recapMonth} />
      )}
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
          groupRecapPending={groupRecapPending}
          groupName={groupName}
        />
      )}
      {status.step === 'completed' && <RecapRedirecting copy="Redirection vers le dashboard…" />}
    </RecapShell>
  )
}
