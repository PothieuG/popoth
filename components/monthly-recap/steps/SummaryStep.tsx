'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext, RecapSummary } from '@/lib/recap'
import { cn } from '@/lib/utils'

import { BilanBlock } from '../BilanBlock'
import { SavingsDetailDrawer } from '../SavingsDetailDrawer'
import { SavingsProjectsDetailDrawer } from '../SavingsProjectsDetailDrawer'
import { SurplusDetailDrawer } from '../SurplusDetailDrawer'

const ADVANCE_ERROR_COPY: Record<string, string> = {
  not_initiator: "Tu n'es pas l'initiateur du récap. Recharge la page.",
  invalid_transition: "Cette transition n'est pas autorisée. Recharge.",
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
}

interface SummaryStepProps {
  context: RecapContext
  summary: RecapSummary
}

/**
 * Accent thématique par card :
 *  - 'bank'    : Solde actuel (bleu, "argent en banque")
 *  - 'neutral' : RAV estimé + RAV effectif (gris ardoise, métriques abstraites)
 *  - 'budget'  : Surplus total (orange — code couleur "budget" du récap)
 *  - 'savings' : Total économies (violet — code couleur "économies" du récap)
 *
 * Discrétion : border-l-4 + couleur du montant. Pas de fond saturé.
 */
type CardAccent = 'bank' | 'neutral' | 'budget' | 'savings'

const ACCENT_STYLES: Record<CardAccent, { border: string; amount: string; link: string }> = {
  bank: {
    border: 'border-l-4 border-l-sky-400',
    amount: 'text-sky-700',
    link: 'text-sky-700',
  },
  neutral: {
    border: 'border-l-4 border-l-slate-300',
    amount: 'text-slate-800',
    link: 'text-slate-600',
  },
  budget: {
    border: 'border-l-4 border-l-orange-400',
    amount: 'text-orange-700',
    link: 'text-orange-700',
  },
  savings: {
    border: 'border-l-4 border-l-violet-400',
    amount: 'text-violet-700',
    link: 'text-violet-700',
  },
}

function SummaryCard({
  label,
  amount,
  accent,
  onShowDetail,
  detailLabel,
}: {
  label: string
  amount: number
  accent: CardAccent
  onShowDetail?: () => void
  detailLabel?: string
}) {
  const styles = ACCENT_STYLES[accent]
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm',
        styles.border,
      )}
    >
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      <p className={cn('text-xl font-semibold', styles.amount)}>{formatEuro(amount)}</p>
      {onShowDetail && (
        <Button
          type="button"
          variant="link"
          className={cn('-mx-1 h-auto justify-start px-1 py-0 text-left text-sm', styles.link)}
          onClick={onShowDetail}
        >
          {detailLabel ?? 'Voir le détail'}
        </Button>
      )}
    </div>
  )
}

export function SummaryStep({ context, summary }: SummaryStepProps) {
  const [surplusOpen, setSurplusOpen] = useState(false)
  const [savingsOpen, setSavingsOpen] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advanceMutation = useAdvanceStep(context)

  const surplusBudgets = summary.budgets.filter((b) => b.surplus > 0)
  const savingsBudgets = summary.budgets.filter((b) => b.cumulatedSavings > 0)
  const totalEconomies = summary.totalSavings + summary.piggyAmount
  const activeProjects = summary.savingsProjects
  const hasProjects = activeProjects.length > 0
  const projectsLabel =
    activeProjects.length === 1 ? '1 projet en cours' : `${activeProjects.length} projets en cours`

  const handleNext = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'summary', toStep: 'manage_bilan' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      if (code === 'stale_step' || code === 'invalid_step') return
      setError(ADVANCE_ERROR_COPY[code] ?? "Impossible de passer à l'étape suivante.")
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Récap général</h1>

      <div className="space-y-3">
        <SummaryCard label="Solde actuel" amount={summary.currentBalance} accent="bank" />
        <SummaryCard label="Reste à vivre estimé" amount={summary.ravEstime} accent="neutral" />
        <SummaryCard label="Reste à vivre effectif" amount={summary.ravEffectif} accent="neutral" />
        <SummaryCard
          label="Surplus total des budgets"
          amount={summary.totalSurplus}
          accent="budget"
          onShowDetail={() => setSurplusOpen(true)}
        />
        <SummaryCard
          label="Total des économies"
          amount={totalEconomies}
          accent="savings"
          onShowDetail={() => setSavingsOpen(true)}
        />
        {hasProjects && (
          <button
            type="button"
            onClick={() => setProjectsOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-l-4 border-gray-200 border-l-violet-400 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:bg-violet-50/40"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-violet-800">
              <span aria-hidden="true">📋</span>
              {projectsLabel}
            </span>
            <span aria-hidden="true" className="text-violet-700">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </span>
          </button>
        )}
      </div>

      <BilanBlock bilan={summary.bilan} bilanSign={summary.bilanSign} />

      <Button onClick={handleNext} disabled={advanceMutation.isPending} className="w-full">
        {advanceMutation.isPending ? 'Chargement…' : 'Étape suivante'}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <SurplusDetailDrawer
        isOpen={surplusOpen}
        onClose={() => setSurplusOpen(false)}
        budgets={surplusBudgets}
      />
      <SavingsDetailDrawer
        isOpen={savingsOpen}
        onClose={() => setSavingsOpen(false)}
        piggyAmount={summary.piggyAmount}
        budgets={savingsBudgets}
      />
      {projectsOpen && (
        <SavingsProjectsDetailDrawer
          isOpen={projectsOpen}
          onClose={() => setProjectsOpen(false)}
          projects={activeProjects}
        />
      )}
    </div>
  )
}
