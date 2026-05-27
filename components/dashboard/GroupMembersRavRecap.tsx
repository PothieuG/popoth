'use client'

import { cn } from '@/lib/utils'
import type { GroupMemberRavRow } from '@/lib/finance/group-members-rav-preview'

interface GroupMembersRavRecapProps {
  rows: GroupMemberRavRow[]
  /**
   * Si false, le recap est masqué (input utilisateur encore vide /
   * non-modifié). Le parent contrôle ce flag via son `showPreview` local.
   */
  showPreview: boolean
}

const formatAmount = (amount: number): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount)

/**
 * Recap "RAV par membre" affiché dans les modals AddBudget/EditBudget/
 * AddProject/EditProject en contexte groupe (Sprint Group-RAV-Recap).
 *
 * Pour chaque membre : affiche son RAV actuel → RAV projeté après ajout/
 * édition. Mise en évidence rouge + message d'avertissement si le membre
 * passerait en RAV négatif. La validation reste "warning mais autoriser"
 * (les schémas Zod sont déjà passés en strictRav=false côté groupe), donc
 * le bouton "Ajouter / Sauvegarder" reste actif même si des warnings sont
 * visibles — l'utilisateur prend la décision en connaissance de cause.
 *
 * Layout mobile-first (≤ 430px) : flex baseline justify-between, prénom
 * tronqué à gauche, montants shrink-0 à droite. `role="alert"` sur le
 * message d'avertissement pour les lecteurs d'écran.
 */
export default function GroupMembersRavRecap({ rows, showPreview }: GroupMembersRavRecapProps) {
  if (!showPreview || rows.length === 0) return null

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50/50 p-4"
      data-testid="group-members-rav-recap"
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Impact sur le reste à vivre :</p>
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.profileId}
              className="flex flex-col gap-1 border-b border-blue-100 pb-2 last:border-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-gray-700">{row.firstName || 'Membre'}</span>
                <div className="flex shrink-0 items-baseline gap-1">
                  <span className="text-gray-500">{formatAmount(row.currentRav)}</span>
                  <span className="text-gray-400">→</span>
                  <span
                    className={cn(
                      'font-semibold',
                      row.willGoNegative ? 'text-red-600' : 'text-gray-900',
                    )}
                  >
                    {formatAmount(row.projectedRav)}
                  </span>
                </div>
              </div>
              {row.willGoNegative && (
                <p role="alert" className="text-xs text-red-600">
                  Avertissement : le reste à vivre de {row.firstName || 'ce membre'} deviendrait
                  négatif.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
