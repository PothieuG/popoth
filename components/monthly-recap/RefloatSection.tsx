'use client'

import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { formatEuro } from '@/lib/format-currency'
import { cn } from '@/lib/utils'

import type { RefloatTone } from './RefloatSlider'

/**
 * Sprint Recap-Manual-Refloat (2026-10-01) — section dépliable de l'écran
 * « Gestion du déficit » (une par source : tirelire, budgets, projets).
 *
 * En-tête = bouton (`aria-expanded`) : icône, titre, disponible, et à droite
 * le montant retenu pour cette source. Corps + pied « Annuler / Valider »
 * visibles une fois dépliée. Le pied reste collé en bas de l'écran tant que
 * la section est visible : avec 15 budgets, « Valider » reste à portée de
 * pouce sans redescendre toute la liste.
 */

const TONE_STYLES: Record<
  RefloatTone,
  { icon: string; pill: string; openBorder: string; validate: string }
> = {
  violet: {
    icon: 'bg-violet-100 text-violet-700',
    pill: 'bg-violet-100 text-violet-800',
    openBorder: 'border-violet-300 ring-1 ring-violet-200',
    validate: 'bg-violet-600 text-white hover:bg-violet-700',
  },
  orange: {
    icon: 'bg-orange-100 text-orange-700',
    pill: 'bg-orange-100 text-orange-800',
    openBorder: 'border-orange-300 ring-1 ring-orange-200',
    validate: 'bg-orange-600 text-white hover:bg-orange-700',
  },
  purple: {
    icon: 'bg-purple-100 text-purple-700',
    pill: 'bg-purple-100 text-purple-800',
    openBorder: 'border-purple-300 ring-1 ring-purple-200',
    validate: 'bg-purple-600 text-white hover:bg-purple-700',
  },
}

interface RefloatSectionProps {
  id: string
  tone: RefloatTone
  icon: ReactNode
  title: string
  /** Ligne sous le titre (« Disponible : 500,00 € » ou raison d'indisponibilité). */
  subtitle: string
  /** Montant retenu pour cette source (valeur en cours d'édition si dépliée). */
  amount: number
  isOpen: boolean
  isDirty: boolean
  isSaving: boolean
  /** Source vide : en-tête grisé, non dépliable. */
  isEmpty: boolean
  /** Une autre section a des changements non validés : en-tête inactif. */
  isLocked: boolean
  /** Vient d'être enregistrée : petite coche verte quelques secondes (pas de
   *  snackbar, qui masquerait le pied « Valider » de la section suivante). */
  justSaved?: boolean
  onToggle: () => void
  onCancel: () => void
  onValidate: () => void
  children: ReactNode
}

export function RefloatSection({
  id,
  tone,
  icon,
  title,
  subtitle,
  amount,
  isOpen,
  isDirty,
  isSaving,
  isEmpty,
  isLocked,
  justSaved = false,
  onToggle,
  onCancel,
  onValidate,
  children,
}: RefloatSectionProps) {
  const styles = TONE_STYLES[tone]
  const bodyId = `${id}-body`
  const headerDisabled = isEmpty || (isLocked && !isOpen)

  return (
    <section
      className={cn(
        'rounded-2xl border bg-white shadow-sm transition-shadow',
        isOpen ? styles.openBorder : 'border-gray-200',
        headerDisabled && 'bg-white/70',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={headerDisabled}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 rounded-2xl p-4 text-left disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5',
            isEmpty ? 'bg-gray-100 text-gray-400' : styles.icon,
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block text-sm font-semibold',
              isEmpty ? 'text-gray-500' : 'text-gray-900',
            )}
          >
            {title}
          </span>
          <span className="block text-xs leading-snug text-gray-500">{subtitle}</span>
        </span>
        {justSaved && (
          <Check
            aria-hidden="true"
            className="animate-in fade-in zoom-in size-4 shrink-0 text-emerald-600 duration-300"
          />
        )}
        {!isEmpty && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums',
              amount > 0.004 ? styles.pill : 'bg-gray-100 text-gray-500',
            )}
          >
            {amount > 0.004 ? `−${formatEuro(amount)}` : '0 €'}
          </span>
        )}
        {!isEmpty && (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-5 shrink-0 text-gray-400 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        )}
      </button>

      {isOpen && (
        <div id={bodyId}>
          <div className="border-t border-gray-100 px-4 pt-3 pb-4">{children}</div>
          <div className="sticky bottom-[env(safe-area-inset-bottom)] z-10 flex gap-2 rounded-b-2xl border-t border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onCancel}
              disabled={isSaving}
            >
              Annuler
            </Button>
            <Button
              type="button"
              className={cn('flex-1', styles.validate)}
              onClick={onValidate}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? 'Enregistrement…' : 'Valider'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
