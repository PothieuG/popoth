'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useCompleteRecap, type RecapProgress } from '@/hooks/useMonthlyRecap'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { useProfile } from '@/hooks/useProfile'
import { ofMonth } from '@/lib/finance/salary-reception'
import { formatEuro } from '@/lib/format-currency'
import type {
  ProjectSnapshotSummary,
  RecapContext,
  RecapSummary,
  SalaryReceptionSummary,
} from '@/lib/recap'
import {
  EMPTY_REFLOAT_PLAN,
  planFromProgress,
  round2,
  sumPlanSource,
} from '@/lib/recap/refloat-plan'

const ERROR_COPY: Record<string, string> = {
  invalid_step: "Cette étape n'est plus accessible. Recharge la page.",
  not_initiator: "Tu n'es pas l'initiateur du récap.",
  no_active_recap: 'Aucun récap actif. Recharge la page.',
  stale_step: "L'étape a évolué côté serveur. Rafraîchis.",
}

function pickErrorCopy(code: string): string {
  return ERROR_COPY[code] ?? 'Une erreur est survenue. Réessaie dans un instant.'
}

interface FinalRecapStepProps {
  context: RecapContext
  summary: RecapSummary
  /** Refloat trackers from the `monthly_recaps` row (sprint 13). `null` if
   *  the status payload didn't carry them (degraded response — fallback to
   *  zeros). */
  recap: RecapProgress | null
  /** Lifted from `RecapWizard` — true iff the user successfully submitted
   *  the salary form on screen 4 during this session. False on "Non" path
   *  or on refresh (trade-off accepté). */
  salaryUpdated: boolean
  /** Sprint 14 follow-up — true iff the user belongs to a group AND that
   *  group's monthly recap is not yet completed. Drives the alternate
   *  "Aller au recap du groupe" button (vs "Retourner au dashboard"). The
   *  wizard's redirect logic mirrors this — see `RecapWizard.useEffect`. */
  groupRecapPending: boolean
  /** Group display name (from `profile.group_name`) — null when the user
   *  has no group or when the profile hasn't loaded yet. Used in the button
   *  label `Aller au recap du groupe « <name> »`. */
  groupName: string | null
}

/**
 * Sprint 14 — Écran 5 du wizard Monthly Recap V3. Synthèse détaillée par
 * source du parcours emprunté + bouton "Retourner au dashboard" qui finalise
 * le récap.
 *
 * 2 cas de rendu :
 *
 *   1. **Cas positif** (`bilanSign ∈ {'positive', 'zero'}`) : message unique
 *      "Vous avez transformé +X€ en économies".
 *
 *   2. **Cas négatif** (`bilanSign === 'negative'`) : surplus rangé dans les
 *      économies, puis "Vous avez renfloué votre déficit de X€" + détail par
 *      source (lignes > 0 uniquement). Depuis Sprint Recap-Manual-Refloat
 *      (2026-10-01), les montants viennent du plan manuel (différé, appliqué
 *      au clic sur le bouton ci-dessous) + ce que l'ancienne cascade avait
 *      déjà débité sur les récaps ouverts avant ce sprint. L'ancien cas
 *      « cascade pos/nég » (jamais déclenché) a été retiré.
 *
 * Si `salaryUpdated` est true, ligne additionnelle "Salaire mis à jour : X€"
 * (profile) ou "Contribution mise à jour : X€" (group).
 *
 * Le bouton "Retourner au dashboard" déclenche `useCompleteRecap` qui POST
 * `/api/monthly-recap/complete`. L'invalidation du queryKey status + la
 * détection `kind === 'completed'` dans `RecapWizard.useEffect` fait le
 * `router.replace` vers le dashboard adéquat. Pas de `router.replace`
 * explicite ici.
 *
 * Idempotence : si l'utilisateur double-clique, la 2e mutation reçoit `{
 * alreadyCompleted: true }` (HTTP 200, traité comme succès) et le wizard
 * a déjà entamé sa redirection.
 */
export function FinalRecapStep({
  context,
  summary,
  recap,
  salaryUpdated,
  groupRecapPending,
  groupName,
}: FinalRecapStepProps) {
  const [error, setError] = useState<string | null>(null)

  const completeMutation = useCompleteRecap(context)
  const { profile } = useProfile()
  const { contributions } = useGroupContributions()

  const plan = recap ? planFromProgress(recap) : EMPTY_REFLOAT_PLAN
  const fromPiggy = round2(plan.legacyPiggy + plan.piggy)
  const fromSavings = round2(
    plan.legacySavings + Object.values(plan.savings).reduce((s, v) => s + v, 0),
  )
  const fromNextBudgets = round2(Object.values(plan.budgets).reduce((s, v) => s + v, 0))
  const fromProjects = sumPlanSource(plan, 'projects')
  const surplusToSavings = round2(
    Object.values(recap?.surplusSavingsData ?? {}).reduce((s, v) => s + v, 0),
  )

  const handleComplete = async () => {
    setError(null)
    try {
      await completeMutation.mutateAsync()
      // The wizard's useEffect on `kind === 'completed'` triggers the
      // router.replace after invalidation refetches the new status.
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      if (code === 'stale_step' || code === 'invalid_step') return
      setError(pickErrorCopy(code))
    }
  }

  // Salary / contribution line (only when salaryUpdated flag is set).
  let salaryLine: { label: string; amount: number } | null = null
  if (salaryUpdated && profile) {
    if (context === 'profile') {
      salaryLine = { label: 'Salaire mis à jour', amount: profile.salary }
    } else {
      const userContribution = contributions.find((c) => c.profile_id === profile.id)
      if (userContribution) {
        salaryLine = {
          label: 'Contribution mise à jour',
          amount: userContribution.contribution_amount,
        }
      }
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Récapitulatif final</h1>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-800">
        {summary.bilanSign === 'negative' ? (
          <NegativeSummary
            surplusToSavings={surplusToSavings}
            fromPiggy={fromPiggy}
            fromSavings={fromSavings}
            fromNextBudgets={fromNextBudgets}
            fromProjects={fromProjects}
          />
        ) : (
          <PositiveSummary totalSurplus={summary.totalSurplus} />
        )}

        {summary.savingsProjects.length > 0 && summary.projectSnapshot && (
          <ProjectsSummary
            projectCount={summary.savingsProjects.length}
            snapshot={summary.projectSnapshot}
          />
        )}

        {salaryLine && (
          <p className="mt-4 border-t border-gray-200 pt-3 text-gray-700">
            <span className="font-medium">{salaryLine.label} :</span>{' '}
            <span className="tabular-nums">{formatEuro(salaryLine.amount)}</span>
          </p>
        )}

        {summary.salaryReception && <SalaryReceptionLine reception={summary.salaryReception} />}
      </section>

      <Button
        type="button"
        className="w-full"
        onClick={handleComplete}
        disabled={completeMutation.isPending}
      >
        {completeMutation.isPending
          ? 'Finalisation…'
          : groupRecapPending && groupName
            ? `Aller au recap du groupe « ${groupName} »`
            : 'Retourner au dashboard'}
      </Button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Sprint Salary-Reception (2026-10-02). Le salaire du mois qui s'ouvre a déjà
 * été reçu (option « Réception du salaire ») : à la finalisation il devient la
 * ligne « Salaire » de ce mois, déjà validée — aucune ligne à valider sur le
 * dashboard — et son écart avec le salaire prévu entre dans le reste à vivre.
 * Miroir de `create_salary_income_for_recap`.
 */
function SalaryReceptionLine({ reception }: { reception: SalaryReceptionSummary }) {
  const target = ofMonth(reception.fundedMonth)
  return (
    <div className="mt-4 border-t border-gray-200 pt-3 text-gray-700">
      <p>
        <span className="font-medium">Salaire {target} déjà reçu :</span>{' '}
        <span className="tabular-nums">{formatEuro(reception.received)}</span>
      </p>
      {reception.delta > 0 && (
        <p className="mt-1 text-xs text-gray-600">
          <span className="font-semibold text-green-700 tabular-nums">
            +{formatEuro(reception.delta)}
          </span>{' '}
          par rapport au salaire prévu, ajoutés à votre reste à vivre {target}.
        </p>
      )}
      {reception.delta < 0 && (
        <p className="mt-1 text-xs text-gray-600">
          <span className="font-semibold text-red-700 tabular-nums">
            −{formatEuro(-reception.delta)}
          </span>{' '}
          par rapport au salaire prévu, retirés de votre reste à vivre {target}.
        </p>
      )}
    </div>
  )
}

function PositiveSummary({ totalSurplus }: { totalSurplus: number }) {
  if (totalSurplus <= 0.01) {
    return <p>Votre mois est équilibré. Vous pouvez retourner au dashboard.</p>
  }
  return (
    <p>
      Vous avez transformé{' '}
      <span className="font-semibold text-green-700 tabular-nums">+{formatEuro(totalSurplus)}</span>{' '}
      en économies.
    </p>
  )
}

function NegativeSummary({
  surplusToSavings,
  fromPiggy,
  fromSavings,
  fromNextBudgets,
  fromProjects,
}: {
  surplusToSavings: number
  fromPiggy: number
  fromSavings: number
  fromNextBudgets: number
  fromProjects: number
}) {
  const totalRefloated = round2(fromPiggy + fromSavings + fromNextBudgets + fromProjects)
  const lines: Array<{ label: string; amount: number; tone: string }> = [
    { label: 'Via la tirelire', amount: fromPiggy, tone: 'text-violet-800' },
    { label: 'Via les économies des budgets', amount: fromSavings, tone: 'text-violet-800' },
    { label: 'Via les budgets du mois prochain', amount: fromNextBudgets, tone: 'text-orange-800' },
    { label: 'Via les mensualités des projets', amount: fromProjects, tone: 'text-purple-800' },
  ]
  return (
    <>
      {surplusToSavings > 0.01 && (
        <p className="mb-3">
          Surplus de vos budgets rangé en économies :{' '}
          <span className="font-semibold text-green-700 tabular-nums">
            +{formatEuro(surplusToSavings)}
          </span>
        </p>
      )}
      <p>
        Vous avez renfloué votre déficit de{' '}
        <span className="font-semibold text-red-700 tabular-nums">
          {formatEuro(totalRefloated)}
        </span>
      </p>
      <ul className="mt-3 space-y-1">
        {lines
          .filter((line) => line.amount > 0.01)
          .map((line) => (
            <li key={line.label} className="flex items-baseline justify-between gap-2">
              <span className={line.tone}>• {line.label}</span>
              <span className={`font-semibold tabular-nums ${line.tone}`}>
                {formatEuro(line.amount)}
              </span>
            </li>
          ))}
      </ul>
    </>
  )
}

/**
 * Sprint Projets-Épargne 10 — section "Projets" affichée sous le bloc bilan
 * dans FinalRecapStep, dès que l'owner a au moins 1 projet actif.
 *
 * Réécrit Sprint Carryover-Self-Healing 2026-05-26 : la ligne "ont reçu leur
 * allocation mensuelle" était trompeuse quand `totalRefunded > 0` (laissait
 * croire que les projets avaient touché leur allocation totale alors qu'ils
 * étaient en réalité partiellement ou totalement prélevés). Nouveau format :
 *
 *   - Ligne 1 (toujours) : "💰 X € épargnés sur tes N projet(s) ce mois" —
 *     montant net effectivement crédité à `amount_saved` au finalize.
 *     X = `snapshot.totalSaved` (= sum(monthly - refund) sur tous les projets).
 *   - Ligne 2 (si refloat > 0) : "📋 Y € prélevés pour combler le déficit" —
 *     Y = `snapshot.totalRefunded`.
 *   - Liste shifted (si non vide) : "{name} : décalage de Z mois" — ne
 *     liste que les projets dont la deadline va effectivement bouger d'au
 *     moins 1 mois (cf. `ProjectSnapshotSummary.shifted`).
 *
 * Théme violet (cohérent avec les économies + RefloatProjectsLine).
 */
function ProjectsSummary({
  projectCount,
  snapshot,
}: {
  projectCount: number
  snapshot: ProjectSnapshotSummary
}) {
  const hasRefund = snapshot.totalRefunded > 0.01
  return (
    <div className="mt-4 border-t border-gray-200 pt-3 text-gray-800">
      <p className="font-medium text-violet-900">Projets</p>
      <ul className="mt-2 space-y-1">
        <li className="flex items-baseline gap-2">
          <span aria-hidden="true">💰</span>
          <span>
            <span className="font-semibold text-violet-800 tabular-nums">
              {formatEuro(snapshot.totalSaved)}
            </span>{' '}
            épargnés sur {projectCount === 1 ? 'ton projet' : `tes ${projectCount} projets`} ce
            mois.
          </span>
        </li>
        {hasRefund && (
          <li className="flex items-baseline gap-2">
            <span aria-hidden="true">📋</span>
            <span>
              <span className="font-semibold text-violet-800 tabular-nums">
                −{formatEuro(snapshot.totalRefunded)}
              </span>{' '}
              prélevés sur les mensualités pour combler le déficit.
            </span>
          </li>
        )}
      </ul>
      {snapshot.shifted.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {snapshot.shifted.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate">{s.name}</span>
              <span className="shrink-0 text-violet-700">
                → décalage de {s.monthsShift} {s.monthsShift === 1 ? 'mois' : 'mois'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
