'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import type { SavingsProjectMeta } from '@/lib/finance/types'
import { formatEuro } from '@/lib/format-currency'
import { formatDeadline, formatMonthsRemaining } from '@/lib/finance/projects-meta'

interface SavingsProjectsDetailDrawerProps {
  isOpen: boolean
  onClose: () => void
  projects: readonly SavingsProjectMeta[]
}

const RING_SIZE = 40
const RING_STROKE = 4
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * Drawer indicatif (lecture seule) listant les projets d'épargne actifs du
 * contexte courant du recap. Aucun bouton d'action — pour modifier/supprimer
 * un projet l'utilisateur passe par l'onglet "Projet" du planificateur (cf.
 * spec §5.1 : "drawer lecture seule sur l'écran initial du recap").
 *
 * Code couleur : violet (thème "économies" du récap, cohérent avec
 * `SavingsDetailDrawer`). Sprint Projets-Épargne 07.
 */
export function SavingsProjectsDetailDrawer({
  isOpen,
  onClose,
  projects,
}: SavingsProjectsDetailDrawerProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) onClose()
  }

  const isEmpty = projects.length === 0

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        <div className="shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500 text-white"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-violet-900">Projets en cours</h2>
                </DialogTitle>
                <p className="text-sm text-violet-800/80">
                  État d&apos;avancement de chaque projet.
                </p>
              </div>
            </div>
            <ModalCloseX onClose={onClose} variant="circle" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isEmpty ? (
            <p className="text-center text-sm text-gray-500">
              Tu n&apos;as aucun projet en cours pour l&apos;instant.
            </p>
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => {
                const target = project.targetAmount || 0
                const saved = project.amountSaved || 0
                const rawPercentage = target > 0 ? (saved / target) * 100 : 0
                const clampedPercentage = Math.max(0, Math.min(100, rawPercentage))
                const roundedPercentage = Math.round(clampedPercentage)
                const dashOffset = RING_CIRCUMFERENCE * (1 - clampedPercentage / 100)

                return (
                  <li
                    key={project.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2"
                  >
                    <div
                      className="relative shrink-0"
                      style={{ width: RING_SIZE, height: RING_SIZE }}
                    >
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
                          className="text-violet-100"
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
                          className="text-violet-600"
                        />
                      </svg>
                      <div
                        className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-violet-700"
                        aria-label={`${roundedPercentage}% atteint`}
                      >
                        {roundedPercentage}%
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{project.name}</p>
                      <p className="text-xs text-gray-500">
                        Échéance : {formatDeadline(project.deadlineDate)} ·{' '}
                        {formatMonthsRemaining(project.monthsRemaining)}
                      </p>
                    </div>

                    <p className="shrink-0 text-right text-sm font-medium">
                      <span className="text-violet-700">{formatEuro(saved)}</span>
                      <span className="text-gray-500"> / {formatEuro(target)}</span>
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
