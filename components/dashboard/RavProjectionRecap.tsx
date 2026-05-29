'use client'

import { cn } from '@/lib/utils'
import { ravColorClass } from './rav-color'

interface RavProjectionRecapProps {
  /** RAV courant (authoritative) avant l'opération. */
  currentRav: number
  /** RAV projeté après l'opération en cours de saisie. */
  projectedRav: number
  /**
   * Si false, l'encart est masqué (montant pas encore saisi). Le parent
   * contrôle ce flag — add : `montant > 0` ; edit : `true` (toujours visible,
   * affiche `actuel → actuel` tant que rien n'a changé).
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
 * Encart « reste à vivre estimé : actuel → projeté » des modals solo
 * Add/Edit Budget/Income/Project du planificateur. Miroir solo de
 * `GroupMembersRavRecap` (même panel bleu). Le montant projeté est coloré
 * vert s'il reste positif, rouge s'il devient négatif (`ravColorClass`).
 * Avertissement rouge `role="alert"` si le RAV passerait négatif — le bouton
 * de soumission reste actif (RAV négatif autorisé depuis 2026-05-27).
 *
 * Layout mobile-first (≤ 430px) : flex baseline.
 */
export default function RavProjectionRecap({
  currentRav,
  projectedRav,
  showPreview,
}: RavProjectionRecapProps) {
  if (!showPreview) return null

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50/50 p-4"
      data-testid="rav-projection-recap"
    >
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Reste à vivre estimé :</p>
        <div className="flex items-baseline gap-2 text-sm">
          <span className="text-gray-500">{formatAmount(currentRav)}</span>
          <span className="text-gray-400">→</span>
          <span className={cn('font-semibold', ravColorClass(projectedRav))}>
            {formatAmount(projectedRav)}
          </span>
        </div>
        {projectedRav < 0 && (
          <p role="alert" className="text-xs text-red-600">
            Attention : ton reste à vivre deviendrait négatif.
          </p>
        )}
      </div>
    </div>
  )
}
