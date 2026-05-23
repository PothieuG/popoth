'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAdvanceStep } from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext, RecapSummary } from '@/lib/recap'

import { BilanBlock } from '../BilanBlock'
import { SavingsDetailDrawer } from '../SavingsDetailDrawer'
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

function SummaryCard({
  label,
  amount,
  onShowDetail,
  detailLabel,
}: {
  label: string
  amount: number
  onShowDetail?: () => void
  detailLabel?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{formatEuro(amount)}</p>
      {onShowDetail && (
        <Button
          type="button"
          variant="link"
          className="-mx-1 h-auto justify-start px-1 py-0 text-left text-sm text-blue-700"
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
  const [error, setError] = useState<string | null>(null)

  const advanceMutation = useAdvanceStep(context)

  const surplusBudgets = summary.budgets.filter((b) => b.surplus > 0)
  const savingsBudgets = summary.budgets.filter((b) => b.cumulatedSavings > 0)
  const totalEconomies = summary.totalSavings + summary.piggyAmount

  const handleNext = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'summary', toStep: 'manage_bilan' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(ADVANCE_ERROR_COPY[code] ?? "Impossible de passer à l'étape suivante.")
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Récap général</h1>

      <div className="space-y-3">
        <SummaryCard label="Solde actuel" amount={summary.currentBalance} />
        <SummaryCard label="Reste à vivre estimé" amount={summary.ravEstime} />
        <SummaryCard label="Reste à vivre effectif" amount={summary.ravEffectif} />
        <SummaryCard
          label="Surplus total des budgets"
          amount={summary.totalSurplus}
          onShowDetail={() => setSurplusOpen(true)}
        />
        <SummaryCard
          label="Total des économies"
          amount={totalEconomies}
          onShowDetail={() => setSavingsOpen(true)}
        />
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
    </div>
  )
}
