'use client'

import { useState, useRef, useEffect } from 'react'
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

/**
 * Détermine la couleur selon le montant et le type
 */
const getAmountColor = (
  spent: number,
  estimated: number,
  type: 'expense' | 'income'
): string => {
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
 * Composant dropdown personnalisé avec formatage avancé
 */
export default function CustomDropdown({
  options,
  value,
  onChange,
  placeholder,
  className,
  required = false,
  disabled = false
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Fermer le dropdown si on clique à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Trouver l'option sélectionnée
  const selectedOption = options.find(option => option.id === value)

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Bouton principal */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'w-full p-3 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-left transition-colors',
          !selectedOption && 'text-gray-500',
          disabled && 'opacity-50 cursor-not-allowed bg-gray-50'
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {selectedOption ? (
          <div className="flex items-center justify-between">
            <span className="font-medium text-black">{selectedOption.name}</span>
            <span className="text-sm text-gray-600">
              {selectedOption.type === 'expense' && selectedOption.spentAmount !== undefined ? (
                <>
                  <span className={getAmountColor(selectedOption.spentAmount, selectedOption.estimatedAmount || 0, 'expense')}>
                    {selectedOption.spentAmount.toFixed(2)}€
                  </span>
                  /{selectedOption.estimatedAmount?.toFixed(2)}€
                </>
              ) : selectedOption.type === 'income' && selectedOption.receivedAmount !== undefined ? (
                <>
                  <span className={getAmountColor(selectedOption.receivedAmount, selectedOption.estimatedAmount || 0, 'income')}>
                    {selectedOption.receivedAmount.toFixed(2)}€
                  </span>
                  /{selectedOption.estimatedAmount?.toFixed(2)}€
                </>
              ) : null}
            </span>
          </div>
        ) : (
          placeholder
        )}

        {/* Icône de flèche */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
          <svg
            className={cn(
              'w-4 h-4 text-gray-500 transition-transform duration-200',
              isOpen && 'transform rotate-180'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Menu dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-gray-500 text-sm">
              Aucune option disponible
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id)
                  setIsOpen(false)
                }}
                className={cn(
                  'w-full px-3 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0 transition-colors',
                  value === option.id && 'bg-blue-50'
                )}
              >
                <div className="space-y-1">
                  {/* Ligne 1: Nom en bold noir */}
                  <div className="font-bold text-black text-sm">
                    {option.name}
                  </div>

                  {/* Ligne 2: Valeurs avec couleurs */}
                  <div className="flex items-center justify-between text-sm">
                    <div>
                      {option.type === 'expense' && option.spentAmount !== undefined ? (
                        <>
                          <span className={getAmountColor(option.spentAmount, option.estimatedAmount || 0, 'expense')}>
                            {option.spentAmount.toFixed(2)}€
                          </span>
                          <span className="text-gray-500">/{option.estimatedAmount?.toFixed(2)}€</span>
                        </>
                      ) : option.type === 'income' && option.receivedAmount !== undefined ? (
                        <>
                          <span className={getAmountColor(option.receivedAmount, option.estimatedAmount || 0, 'income')}>
                            {option.receivedAmount.toFixed(2)}€
                          </span>
                          <span className="text-gray-500">/{option.estimatedAmount?.toFixed(2)}€</span>
                        </>
                      ) : null}
                    </div>

                    {/* Parenthèse économie seulement (pas de bonus pour les revenus) */}
                    <div className="text-purple-600 text-xs">
                      {option.type === 'expense' && option.economyAmount !== undefined ? (
                        `(Économie: ${option.economyAmount.toFixed(2)}€)`
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
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