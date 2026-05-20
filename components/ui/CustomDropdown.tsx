'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export interface DropdownOption {
  id: string
  name: string
  spentAmount?: number
  estimatedAmount?: number
  receivedAmount?: number
  bonusAmount?: number
  economyAmount?: number
  type?: 'expense' | 'income'
}

interface CustomDropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
  required?: boolean
  disabled?: boolean
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

/**
 * Détermine la couleur selon le montant et le type
 */
const getAmountColor = (spent: number, estimated: number, type: 'expense' | 'income'): string => {
  if (type === 'expense') {
    const percentage = (spent / estimated) * 100
    if (percentage > 100) return 'text-red-600'
    if (percentage === 100) return 'text-blue-600'
    if (percentage >= 80) return 'text-orange-600'
    return 'text-green-600'
  } else {
    const percentage = (spent / estimated) * 100
    if (percentage > 100) return 'text-green-600'
    if (percentage === 100) return 'text-blue-600'
    if (percentage >= 80) return 'text-orange-600'
    return 'text-gray-600'
  }
}

/**
 * Rendu unifie d'une option (utilise dans la selection ET dans les items du menu)
 */
function OptionDisplay({ option }: { option: DropdownOption }) {
  return (
    <div className="space-y-0.5">
      <div className="text-sm font-bold text-black">{option.name}</div>
      <div className="flex items-center justify-between text-sm">
        <div>
          {option.type === 'expense' && option.spentAmount !== undefined ? (
            <>
              <span
                className={getAmountColor(
                  option.spentAmount,
                  option.estimatedAmount || 0,
                  'expense',
                )}
              >
                {option.spentAmount.toFixed(2)}€
              </span>
              <span className="text-gray-500">/{option.estimatedAmount?.toFixed(2)}€</span>
            </>
          ) : option.type === 'income' && option.receivedAmount !== undefined ? (
            <>
              <span
                className={getAmountColor(
                  option.receivedAmount,
                  option.estimatedAmount || 0,
                  'income',
                )}
              >
                {option.receivedAmount.toFixed(2)}€
              </span>
              <span className="text-gray-500">/{option.estimatedAmount?.toFixed(2)}€</span>
            </>
          ) : null}
        </div>
        {option.type === 'expense' &&
          option.economyAmount !== undefined &&
          option.economyAmount !== 0 && (
            <div
              className={`text-xs ${option.economyAmount < 0 ? 'text-red-600' : 'text-purple-600'}`}
            >
              {option.economyAmount >= 0
                ? `(Économie: ${option.economyAmount.toFixed(2)}€)`
                : `(Déficit: ${Math.abs(option.economyAmount).toFixed(2)}€)`}
            </div>
          )}
      </div>
    </div>
  )
}

/**
 * Composant dropdown personnalisé avec formatage avancé.
 *
 * **Portal + fixed positioning (Sprint Modal-Dropdown-Portal 2026-05-21)** : le menu
 * est rendu via React Portal directement dans `document.body` au lieu d'être un
 * enfant de DialogContent. Raisons :
 * - Radix DialogContent a `overflow-hidden` (pour respecter max-h-[85vh]) — un menu
 *   en `position: absolute` y serait clipped.
 * - `position: fixed` ne suffit pas car DialogContent a `transform: translateY(-50%)`
 *   qui crée un containing-block pour les descendants fixed-positioned.
 * - Donc le seul moyen d'échapper au clipping est de portaler hors du subtree.
 *
 * **Max-height dynamique** : à chaque ouverture (et sur scroll/resize), on calcule
 * `viewport.height - button.bottom - 10vh - 4px` pour garantir 10% de marge au
 * bas de l'écran (le menu peut atteindre le haut du viewport mais jamais sortir
 * du bas).
 *
 * **Anti-Radix-close** : `onPointerDown` + `onMouseDown` stopPropagation sur le
 * menu portaled empêchent DismissableLayer (utilisé par Radix Dialog) de
 * détecter un "clic outside" qui fermerait la modal parente. Radix listen en
 * bubble phase sur document — stopProp à l'élément menu empêche l'event d'y
 * remonter.
 */
export default function CustomDropdown({
  options,
  value,
  onChange,
  placeholder,
  className,
  required = false,
  disabled = false,
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const computeMenuPosition = useCallback((): MenuPosition | null => {
    if (!buttonRef.current) return null
    const rect = buttonRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const bottomMargin = viewportHeight * 0.1
    const availableHeight = viewportHeight - rect.bottom - bottomMargin - 4
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(availableHeight, 120),
    }
  }, [])

  // Reposition the menu on scroll (any element) and viewport resize while open.
  // The capture-phase listener catches scrolls inside the modal body too.
  useEffect(() => {
    if (!isOpen) return
    const update = () => {
      const next = computeMenuPosition()
      if (next) setMenuPos(next)
    }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [isOpen, computeMenuPosition])

  // Click outside (anywhere not inside the button or the portaled menu) closes
  // the dropdown. Both refs are checked because the menu lives in a separate
  // DOM subtree (document.body) via portal.
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const toggleOpen = () => {
    if (disabled) return
    if (!isOpen) {
      const pos = computeMenuPosition()
      if (pos) setMenuPos(pos)
    }
    setIsOpen((prev) => !prev)
  }

  const selectedOption = options.find((option) => option.id === value)

  return (
    <div className={cn('relative', className)}>
      {/* Bouton principal */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white p-3 pr-10 text-left transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500',
          !selectedOption && 'text-gray-500',
          disabled && 'cursor-not-allowed bg-gray-50 opacity-50',
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {selectedOption ? <OptionDisplay option={selectedOption} /> : placeholder}

        {/* Icône de flèche */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <svg
            className={cn(
              'h-4 w-4 text-gray-500 transition-transform duration-200',
              isOpen && 'rotate-180 transform',
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Menu dropdown — portaled to document.body to escape the parent modal's
          overflow:hidden + transform clipping. */}
      {isOpen &&
        !disabled &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
            className="z-[100] overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">Aucune option disponible</div>
            ) : (
              options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  onClick={() => {
                    onChange(option.id)
                    setIsOpen(false)
                  }}
                  className={cn(
                    'w-full border-b border-gray-100 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-gray-50 focus:bg-gray-50 focus:outline-hidden',
                    value === option.id && 'bg-blue-50',
                  )}
                >
                  <OptionDisplay option={option} />
                </button>
              ))
            )}
          </div>,
          document.body,
        )}

      {/* Input caché pour la validation des formulaires */}
      <input
        type="hidden"
        value={value}
        required={required}
        onChange={() => {}} // Contrôlé par le composant
      />
    </div>
  )
}
