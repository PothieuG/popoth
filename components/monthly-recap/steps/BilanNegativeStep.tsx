'use client'

import { PiggyBank, Target, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  useAdvanceStep,
  usePrepareDeficit,
  useSaveRefloatPlan,
  type RecapProgress,
} from '@/hooks/useMonthlyRecap'
import { formatEuro } from '@/lib/format-currency'
import type { RecapContext, RecapSummary } from '@/lib/recap'
import {
  autoDistributeBudgets,
  budgetRefloatCapacity,
  budgetTotalsFromPlan,
  canLeaveDeficitStep,
  deficitRemainingForPlan,
  planFromProgress,
  REFLOAT_EPSILON,
  remainingRefloatCapacity,
  round2,
  splitBudgetTotals,
  sumPlanSource,
  type RefloatPlan,
  type RefloatSource,
} from '@/lib/recap/refloat-plan'
import { sortByName } from '@/lib/utils'

import { DeficitProgressHeader } from '../DeficitProgressHeader'
import {
  BudgetsRefloatPanel,
  deMonth,
  PiggyRefloatPanel,
  ProjectsRefloatPanel,
} from '../RefloatPanels'
import { RefloatSection } from '../RefloatSection'

const ERROR_COPY: Record<string, string> = {
  invalid_step: "Cette étape n'est plus accessible. Recharge la page.",
  not_initiator: "Tu n'es pas l'initiateur du récap.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
  no_deficit: "Plus de déficit à combler. L'écran va s'actualiser.",
  not_prepared: 'Tes économies ne sont pas encore prêtes. Recharge la page.',
  overflow: 'Le montant dépasse ce qu’il reste à renflouer.',
  piggy_insufficient: "La tirelire n'a pas ce montant disponible.",
  budget_capacity_exceeded: "Un budget dépasse ce qu'il peut donner (économies + budget).",
  project_capacity_exceeded: 'Un projet dépasse sa mensualité.',
  unknown_budget: 'Un budget a changé entre-temps. Recharge la page.',
  unknown_project: 'Un projet a changé entre-temps. Recharge la page.',
  deficit_not_covered: 'Il reste un montant à renflouer avant de continuer.',
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

const MONTH_FORMATTER = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

function monthName(month1: number): string {
  return MONTH_FORMATTER.format(new Date(2000, month1 - 1, 1))
}

interface Drafts {
  piggy: number
  budgets: Record<string, number>
  projects: Record<string, number>
}

const EMPTY_DRAFTS: Drafts = { piggy: 0, budgets: {}, projects: {} }

interface BilanNegativeStepProps {
  context: RecapContext
  summary: RecapSummary
  recap: RecapProgress
  /** Mois recapé (1-12) — pour les libellés « septembre » / « octobre ». */
  recapMonth: number
}

/**
 * Écran « Gestion du déficit » (étape 4 quand le bilan est négatif).
 * Refonte Sprint Recap-Manual-Refloat (2026-10-01) — remplace la cascade
 * automatique et proportionnelle des sprints 13 / Projets-Épargne 09.
 *
 *  1. **Préparation** : à l'arrivée, le surplus de chaque budget est versé
 *     dans ses économies (`usePrepareDeficit`, une seule fois par récap).
 *
 *  2. **3 sections dépliables**, une ouverte à la fois : tirelire, budgets
 *     (économies puis budget du mois suivant), projets (mensualité du mois).
 *     L'utilisateur choisit librement où prendre l'argent, dans l'ordre qu'il
 *     veut. Les valeurs en cours d'édition vivent ici (`drafts`) ; « Valider »
 *     les enregistre (`useSaveRefloatPlan`), « Annuler » les abandonne. Tant
 *     qu'une section a des changements non validés, les autres sont inactives.
 *
 *  3. **Bandeau collant** : reste à renflouer toujours visible, recalculé à
 *     chaque mouvement de curseur (plan enregistré + valeurs en cours).
 *
 *  4. **Rien n'est débité ici** : tout est appliqué à la finalisation du récap
 *     — le plan reste modifiable jusque-là.
 *
 *  5. **« Continuer »** n'est actif que si le déficit est couvert, ou si plus
 *     aucune source ne peut rien donner (règle partagée avec le serveur,
 *     `canLeaveDeficitStep`).
 *
 * Couleurs : tirelire/économies = violet, budgets = orange, projets = purple
 * (miroir dashboard), déficit = rouge, couvert = vert.
 */
export function BilanNegativeStep({ context, summary, recap, recapMonth }: BilanNegativeStepProps) {
  const prepare = usePrepareDeficit(context)
  const saveMutation = useSaveRefloatPlan(context)
  const advanceMutation = useAdvanceStep(context)

  const [open, setOpen] = useState<RefloatSource | null>(null)
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS)
  const [error, setError] = useState<string | null>(null)
  /** Section tout juste enregistrée (coche verte ~2,5 s dans son en-tête). */
  const [savedSource, setSavedSource] = useState<RefloatSource | null>(null)

  // --- 1. Préparation (surplus → économies), une seule fois ---------------
  const needsPrepare = recap.surplusSavingsData === null
  const { mutate: runPrepare } = prepare
  const prepareRequested = useRef(false)
  useEffect(() => {
    if (!needsPrepare || prepareRequested.current) return
    prepareRequested.current = true
    runPrepare()
  }, [needsPrepare, runPrepare])

  useEffect(() => {
    if (!savedSource) return
    const timer = setTimeout(() => setSavedSource(null), 2500)
    return () => clearTimeout(timer)
  }, [savedSource])

  const savedPlan = useMemo(() => planFromProgress(recap), [recap])
  const savingsById = useMemo(
    () => new Map(summary.budgets.map((b) => [b.budgetId, b.cumulatedSavings])),
    [summary.budgets],
  )

  const recapMonthName = monthName(recapMonth)
  const nextMonthName = monthName((recapMonth % 12) + 1)

  if (needsPrepare) {
    return (
      <div className="space-y-4">
        <StepTitle recapMonthName={recapMonthName} />
        {prepare.isError ? (
          <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-4">
            <p role="alert" className="text-sm text-red-700">
              {pickErrorCopy(prepare.error.message)}
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={() => runPrepare()}>
              Réessayer
            </Button>
          </section>
        ) : (
          <div role="status" className="space-y-3">
            <p className="text-sm text-gray-600">
              On range le surplus de tes budgets dans leurs économies…
            </p>
            <div className="h-28 w-full animate-pulse rounded-2xl bg-white/70" />
            <div className="h-20 w-full animate-pulse rounded-2xl bg-white/60" />
            <div className="h-20 w-full animate-pulse rounded-2xl bg-white/60" />
          </div>
        )}
      </div>
    )
  }

  // --- 2. Plan en direct (enregistré + section en cours d'édition) --------
  const livePlan: RefloatPlan =
    open === 'piggy'
      ? { ...savedPlan, piggy: drafts.piggy }
      : open === 'budgets'
        ? { ...savedPlan, ...splitBudgetTotals(drafts.budgets, savingsById) }
        : open === 'projects'
          ? { ...savedPlan, projects: drafts.projects }
          : savedPlan

  const deficitTotal = round2(Math.abs(Math.min(0, summary.bilan)))
  const liveRemaining = deficitRemainingForPlan(summary.bilan, livePlan)

  const isDirty =
    open === 'piggy'
      ? Math.abs(drafts.piggy - savedPlan.piggy) > 0.004
      : open === 'budgets'
        ? !sameAmounts(drafts.budgets, budgetTotalsFromPlan(savedPlan))
        : open === 'projects'
          ? !sameAmounts(drafts.projects, savedPlan.projects)
          : false

  // --- Sources -----------------------------------------------------------
  const budgetRows = sortByName(
    summary.budgets.map((b) => ({
      budgetId: b.budgetId,
      name: b.budgetName,
      savings: b.cumulatedSavings,
      estimatedAmount: b.estimatedAmount,
    })),
  )
  const budgetsAvailable = round2(
    budgetRows.reduce(
      (s, r) =>
        s +
        budgetRefloatCapacity({ cumulatedSavings: r.savings, estimatedAmount: r.estimatedAmount }),
      0,
    ),
  )
  const totalSavings = round2(budgetRows.reduce((s, r) => s + Math.max(0, r.savings), 0))
  const projectRows = sortByName(summary.savingsProjects)
  const projectsAvailable = round2(
    projectRows.reduce((s, p) => s + Math.max(0, p.monthlyAllocation), 0),
  )

  const piggyEmpty = summary.piggyAmount <= 0.004 && savedPlan.piggy <= 0.004
  const budgetsEmpty = budgetsAvailable <= 0.004
  const projectsEmpty = projectsAvailable <= 0.004

  // --- 5. Sortie de l'écran (sur le plan ENREGISTRÉ, comme le serveur) ----
  const savedRemaining = deficitRemainingForPlan(summary.bilan, savedPlan)
  const capacityLeft = remainingRefloatCapacity(
    {
      piggyAmount: summary.piggyAmount,
      budgets: summary.budgets,
      projects: summary.savingsProjects,
    },
    savedPlan,
  )
  const savedCovered = savedRemaining <= REFLOAT_EPSILON
  const canLeave = canLeaveDeficitStep(savedRemaining, capacityLeft)

  // --- Handlers ------------------------------------------------------------
  const openSection = (source: RefloatSource) => {
    setError(null)
    if (open === source) {
      setOpen(null)
      return
    }
    setDrafts({
      piggy: savedPlan.piggy,
      budgets: budgetTotalsFromPlan(savedPlan),
      projects: { ...savedPlan.projects },
    })
    setOpen(source)
  }

  const cancel = () => {
    setError(null)
    setOpen(null)
  }

  const validate = async () => {
    if (!open) return
    setError(null)
    try {
      if (open === 'piggy') {
        await saveMutation.mutateAsync({ source: 'piggy', amount: round2(drafts.piggy) })
      } else if (open === 'budgets') {
        await saveMutation.mutateAsync({
          source: 'budgets',
          allocations: cleanAmounts(drafts.budgets),
        })
      } else {
        await saveMutation.mutateAsync({
          source: 'projects',
          allocations: cleanAmounts(drafts.projects),
        })
      }
      setSavedSource(open)
      setOpen(null)
    } catch (e) {
      setError(pickErrorCopy(e instanceof Error ? e.message : 'unknown'))
    }
  }

  const autoDistribute = () => {
    setDrafts((d) => ({
      ...d,
      budgets: autoDistributeBudgets(Math.max(0, liveRemaining), summary.budgets, d.budgets),
    }))
  }

  const handleContinue = async () => {
    setError(null)
    try {
      await advanceMutation.mutateAsync({ fromStep: 'manage_bilan', toStep: 'salary_update' })
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      if (code !== 'invalid_step' && code !== 'stale_step') {
        setError(pickErrorCopy(code))
      }
    }
  }

  const surplusMoved = round2(
    Object.values(recap.surplusSavingsData ?? {}).reduce((s, v) => s + v, 0),
  )
  const legacyTotal = round2(savedPlan.legacyPiggy + savedPlan.legacySavings)
  const isSaving = saveMutation.isPending

  return (
    <div className="space-y-4">
      <StepTitle recapMonthName={recapMonthName} />

      <DeficitProgressHeader
        deficitTotal={deficitTotal}
        remaining={liveRemaining}
        piggy={round2(livePlan.legacyPiggy + sumPlanSource(livePlan, 'piggy'))}
        budgets={round2(livePlan.legacySavings + sumPlanSource(livePlan, 'budgets'))}
        projects={sumPlanSource(livePlan, 'projects')}
      />

      {surplusMoved > REFLOAT_EPSILON && (
        <p className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-900">
          Le surplus de tes budgets {deMonth(recapMonthName)} (
          <span className="font-semibold tabular-nums">{formatEuro(surplusMoved)}</span>) a été
          rangé dans leurs économies. Tu peux t&apos;en servir dans «&nbsp;Budgets&nbsp;».
        </p>
      )}

      {legacyTotal > REFLOAT_EPSILON && (
        <p className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">
          Déjà renfloué avant la mise à jour de cet écran :{' '}
          <span className="font-semibold tabular-nums">{formatEuro(legacyTotal)}</span>. Ce montant
          n&apos;est plus modifiable.
        </p>
      )}

      <RefloatSection
        id="refloat-piggy"
        tone="violet"
        icon={<PiggyBank />}
        title="Tirelire"
        subtitle={
          piggyEmpty ? 'Ta tirelire est vide' : `Disponible : ${formatEuro(summary.piggyAmount)}`
        }
        amount={livePlan.piggy}
        isOpen={open === 'piggy'}
        isDirty={open === 'piggy' && isDirty}
        isSaving={isSaving}
        isEmpty={piggyEmpty}
        isLocked={isDirty && open !== 'piggy'}
        justSaved={savedSource === 'piggy'}
        onToggle={() => openSection('piggy')}
        onCancel={cancel}
        onValidate={validate}
      >
        <PiggyRefloatPanel
          piggyAmount={summary.piggyAmount}
          value={drafts.piggy}
          remaining={liveRemaining}
          onChange={(v) => setDrafts((d) => ({ ...d, piggy: v }))}
        />
      </RefloatSection>

      <RefloatSection
        id="refloat-budgets"
        tone="orange"
        icon={<Wallet />}
        title="Budgets"
        subtitle={
          budgetsEmpty
            ? 'Aucun budget disponible'
            : `Disponible : ${formatEuro(budgetsAvailable)} dont ${formatEuro(totalSavings)} d’économies`
        }
        amount={sumPlanSource(livePlan, 'budgets')}
        isOpen={open === 'budgets'}
        isDirty={open === 'budgets' && isDirty}
        isSaving={isSaving}
        isEmpty={budgetsEmpty}
        isLocked={isDirty && open !== 'budgets'}
        justSaved={savedSource === 'budgets'}
        onToggle={() => openSection('budgets')}
        onCancel={cancel}
        onValidate={validate}
      >
        <BudgetsRefloatPanel
          rows={budgetRows}
          values={drafts.budgets}
          remaining={liveRemaining}
          nextMonthName={nextMonthName}
          onChange={(id, v) => setDrafts((d) => ({ ...d, budgets: { ...d.budgets, [id]: v } }))}
          onAutoDistribute={autoDistribute}
          onReset={() => setDrafts((d) => ({ ...d, budgets: {} }))}
        />
      </RefloatSection>

      <RefloatSection
        id="refloat-projects"
        tone="purple"
        icon={<Target />}
        title="Projets d’épargne"
        subtitle={
          projectsEmpty
            ? 'Aucun projet en cours'
            : `Mensualités ${deMonth(recapMonthName)} : ${formatEuro(projectsAvailable)}`
        }
        amount={sumPlanSource(livePlan, 'projects')}
        isOpen={open === 'projects'}
        isDirty={open === 'projects' && isDirty}
        isSaving={isSaving}
        isEmpty={projectsEmpty}
        isLocked={isDirty && open !== 'projects'}
        justSaved={savedSource === 'projects'}
        onToggle={() => openSection('projects')}
        onCancel={cancel}
        onValidate={validate}
      >
        <ProjectsRefloatPanel
          rows={projectRows}
          values={drafts.projects}
          remaining={liveRemaining}
          recapMonthName={recapMonthName}
          onChange={(id, v) => setDrafts((d) => ({ ...d, projects: { ...d.projects, [id]: v } }))}
        />
      </RefloatSection>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Annonce lecteur d'écran ; visuellement, une coche verte apparaît dans
          l'en-tête de la section enregistrée. */}
      {savedSource && (
        <p role="status" className="sr-only">
          Choix enregistré
        </p>
      )}

      <section className="space-y-2 pt-2">
        {open && isDirty ? (
          <p className="text-center text-xs text-gray-600">
            Valide ou annule tes changements pour continuer.
          </p>
        ) : !canLeave ? (
          <p className="text-center text-xs text-gray-600">
            Il reste{' '}
            <span className="font-semibold text-red-700 tabular-nums">
              {formatEuro(savedRemaining)}
            </span>{' '}
            à renflouer avant de continuer.
          </p>
        ) : !savedCovered ? (
          <p className="text-center text-xs leading-relaxed text-gray-600">
            Tout ce qui était disponible est utilisé. Les{' '}
            <span className="font-semibold tabular-nums">{formatEuro(savedRemaining)}</span>{' '}
            restants ne pourront pas être renfloués ce mois-ci.
          </p>
        ) : null}
        <Button
          type="button"
          className="w-full"
          onClick={handleContinue}
          disabled={!canLeave || (open !== null && isDirty) || advanceMutation.isPending}
        >
          {advanceMutation.isPending
            ? 'Chargement…'
            : canLeave && !savedCovered
              ? 'Continuer sans tout renflouer'
              : 'Continuer'}
        </Button>
      </section>
    </div>
  )
}

function StepTitle({ recapMonthName }: { recapMonthName: string }) {
  return (
    <header>
      <h1 className="text-xl font-semibold text-gray-900">Gestion du déficit</h1>
      <p className="mt-1 text-sm leading-relaxed text-gray-600">
        Choisis où prendre l&apos;argent pour combler le déficit {deMonth(recapMonthName)}. Rien
        n&apos;est débité avant la fin du récap : tu peux revenir sur tes choix.
      </p>
    </header>
  )
}

/** Retire les montants nuls et arrondit au centime. */
function cleanAmounts(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(values)) {
    const amount = round2(v)
    if (amount > 0) out[id] = amount
  }
  return out
}

function sameAmounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const ca = cleanAmounts(a)
  const cb = cleanAmounts(b)
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)])
  for (const k of keys) {
    if (Math.abs((ca[k] ?? 0) - (cb[k] ?? 0)) > 0.004) return false
  }
  return true
}
