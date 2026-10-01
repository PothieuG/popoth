'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep } from '@/hooks/useMonthlyRecap'
import { monthName, ofMonth } from '@/lib/finance/salary-reception'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext, RecapSummary, SalaryReceptionSummary } from '@/lib/recap'
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

/**
 * Sprint Salary-Reception (2026-10-02). Le salaire reçu en avance est dans le
 * solde mais hors bilan : il finance le mois suivant, où seul son écart avec
 * le salaire prévu entrera dans le reste à vivre.
 */
function salaryReceptionNote(reception: SalaryReceptionSummary): string {
  const base = `Compris dans le solde. Il finance ${monthName(reception.fundedMonth)} : il n'entre pas dans ce bilan.`
  const target = ofMonth(reception.fundedMonth)
  if (reception.delta > 0) {
    return `${base} ${formatEuro(reception.delta)} de plus que prévu, ajoutés au reste à vivre ${target}.`
  }
  if (reception.delta < 0) {
    return `${base} ${formatEuro(-reception.delta)} de moins que prévu, retirés du reste à vivre ${target}.`
  }
  return base
}

function SummaryCard({
  label,
  amount,
  accent,
  onShowDetail,
  detailLabel,
  note,
}: {
  label: string
  amount: number
  accent: CardAccent
  onShowDetail?: () => void
  detailLabel?: string
  /** Précision sous le montant (une phrase courte, écran mobile). */
  note?: string
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
      {note && <p className="text-xs leading-snug text-gray-600">{note}</p>}
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
  // Sprint Salary-Reception (2026-10-02) — espace perso : rendre lisible l'écart
  // entre un solde élevé et un reste à vivre faible (contribution au groupe déjà
  // déduite, salaire du mois suivant déjà dans le solde).
  const { groupContribution, salaryReception } = summary

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
        {salaryReception && (
          <SummaryCard
            label="Salaire reçu en avance"
            amount={salaryReception.received}
            accent="bank"
            note={salaryReceptionNote(salaryReception)}
          />
        )}
        <SummaryCard
          label="Reste à vivre estimé"
          amount={summary.ravEstime}
          accent="neutral"
          note={groupContribution ? 'Avant contribution au groupe.' : undefined}
        />
        <SummaryCard label="Reste à vivre effectif" amount={summary.ravEffectif} accent="neutral" />
        {groupContribution && (
          <SummaryCard
            label={groupContribution.label}
            amount={groupContribution.amount}
            accent="neutral"
            note="Déjà déduite du reste à vivre effectif."
          />
        )}
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
