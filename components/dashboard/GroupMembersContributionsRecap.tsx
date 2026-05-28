'use client'

import { cn } from '@/lib/utils'
import type { GroupMemberContributionRow } from '@/lib/finance/group-members-contributions-preview'

interface GroupMembersContributionsRecapProps {
  rows: GroupMemberContributionRow[]
  /**
   * Si false, le recap est masqué (input utilisateur encore vide /
   * non-modifié). Le parent contrôle ce flag via son `showPreview` local.
   */
  showPreview: boolean
  /**
   * Surplus groupe projeté (revenus prévus − budgets prévus, clampé à 0
   * vers le bas). Si > 0, le groupe a une cagnotte ; affiché en footer
   * sous le message "Le RAV du groupe augmente du surplus".
   */
  projectedGroupSurplus: number
}

const formatAmount = (amount: number): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount)

/**
 * Recap "Contributions par membre" affiché dans `AddIncomeDialog` /
 * `EditIncomeDialog` en contexte groupe (Sprint Group-Income-Cascade
 * 2026-05-28). Miroir conceptuel inverse de `GroupMembersRavRecap` :
 *
 *  - Pour CHAQUE membre : contribution actuelle → contribution projetée.
 *    Le delta apparaît en vert (réduction) ou gris (no-op).
 *  - Footer informatif : explique que le RAV groupe ne change pas
 *    (cas R ≤ B) ou qu'il augmente du surplus (cas R > B).
 *
 * Layout mobile-first (≤ 430px) : flex baseline, prénom tronqué à gauche,
 * montants shrink-0 à droite. Aucune mise en garde rouge — au pire, la
 * contribution baisse à 0, jamais en négatif.
 */
export default function GroupMembersContributionsRecap({
  rows,
  showPreview,
  projectedGroupSurplus,
}: GroupMembersContributionsRecapProps) {
  if (!showPreview || rows.length === 0) return null

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50/50 p-4"
      data-testid="group-members-contributions-recap"
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Impact sur les contributions :</p>
        <div className="space-y-2">
          {rows.map((row) => {
            const reduced = row.delta < 0
            return (
              <div
                key={row.profileId}
                className="flex items-baseline justify-between gap-2 border-b border-blue-100 pb-2 text-sm last:border-0 last:pb-0"
              >
                <span className="truncate text-gray-700">{row.firstName || 'Membre'}</span>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span className="text-gray-500">{formatAmount(row.currentContribution)}</span>
                  <span className="text-gray-400">→</span>
                  <span
                    className={cn('font-semibold', reduced ? 'text-green-700' : 'text-gray-900')}
                  >
                    {formatAmount(row.projectedContribution)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
        {projectedGroupSurplus > 0 ? (
          <p className="pt-1 text-xs text-gray-600">
            Surplus groupe :{' '}
            <span className="font-semibold text-green-700">
              {formatAmount(projectedGroupSurplus)}
            </span>{' '}
            — reste dans la cagnotte commune (reste-à-vivre du groupe).
          </p>
        ) : (
          <p className="pt-1 text-xs text-gray-600">
            Le reste-à-vivre du groupe n&apos;est pas affecté ; seules les contributions baissent.
          </p>
        )}
      </div>
    </div>
  )
}
