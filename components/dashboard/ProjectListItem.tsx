'use client'

import { cn } from '@/lib/utils'
import { formatDeadline, formatMonthsRemaining, monthsBetween } from '@/lib/finance/projects-meta'
import type { SavingsProject } from '@/hooks/useProjects'
import DropdownMenu from '../ui/DropdownMenu'

interface ProjectListItemProps {
  project: SavingsProject
  onEdit: (project: SavingsProject) => void
  onDelete: (project: SavingsProject) => void
  className?: string
}

const RING_SIZE = 44
const RING_STROKE = 4
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Sprint Projets-Épargne 04 — row du 3ème onglet "Projets" du PlanningDrawer.
 * Mirror layout de la row Budget (rounded-xl border shadow-md p-3) mais avec
 * un cercle de progression à gauche au lieu de l'indicateur barre. Couleur
 * violet pour rester cohérent avec la palette "économies / cumulated_savings".
 *
 * % = amount_saved / target_amount (clampé 0..100 pour l'arc — un projet
 * over-funded reste à 100% visuel, le ratio numérique se voit dans le
 * "4084 / 7000€" en dessous).
 *
 * Les actions Modifier/Supprimer sont des placeholders côté drawer : la modal
 * create/edit arrive au sprint 05, la confirmation de suppression au sprint 06.
 */
export default function ProjectListItem({
  project,
  onEdit,
  onDelete,
  className,
}: ProjectListItemProps) {
  const target = Number(project.target_amount) || 0
  const saved = Number(project.amount_saved) || 0
  const rawPercentage = target > 0 ? (saved / target) * 100 : 0
  const clampedPercentage = Math.max(0, Math.min(100, rawPercentage))
  const roundedPercentage = Math.round(clampedPercentage)
  const dashOffset = RING_CIRCUMFERENCE * (1 - clampedPercentage / 100)

  return (
    <div className={cn('rounded-xl border border-gray-200 p-3 shadow-md', className)}>
      <div className="flex items-center justify-between gap-2">
        {/* Cercle de progression */}
        <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE}
              className="text-purple-100"
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="text-purple-600 transition-[stroke-dashoffset] duration-300"
            />
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center text-xs font-bold text-purple-700"
            aria-label={`${roundedPercentage}% atteint`}
          >
            {roundedPercentage}%
          </div>
        </div>

        {/* Bloc nom + deadline + montant */}
        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-semibold text-gray-900">{project.name}</h5>
          <p className="text-xs text-gray-500">
            Échéance : {formatDeadline(project.deadline_date)} ·{' '}
            {formatMonthsRemaining(monthsBetween(new Date(), project.deadline_date))}
          </p>
          <p className="mt-0.5 text-sm font-semibold">
            <span className="text-purple-700">{formatAmount(saved)}</span>
            <span className="text-gray-500"> / {formatAmount(target)}</span>
          </p>
          <p className="text-xs text-gray-500">
            {formatAmount(Number(project.monthly_allocation))}/mois
          </p>
        </div>

        {/* Menu dropdown */}
        <div className="ml-1.5 shrink-0">
          <DropdownMenu
            items={[
              {
                label: 'Modifier',
                icon: (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                ),
                onClick: () => onEdit(project),
              },
              {
                label: 'Supprimer',
                icon: (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                ),
                onClick: () => onDelete(project),
                variant: 'danger' as const,
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
