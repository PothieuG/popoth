'use client'

import { useState, useRef, useEffect } from 'react'

interface DropdownMenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  className?: string
  disabled?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  triggerClassName?: string
  buttonClassName?: string
  buttonContent?: React.ReactNode
}

/**
 * Composant menu dropdown avec icône 3 points verticaux
 * Affiche un menu contextuel avec différentes options
 */
export default function DropdownMenu({
  items,
  triggerClassName,
  buttonClassName,
  buttonContent,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Ferme le dropdown si on clique à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bouton trigger avec 3 points verticaux */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          buttonClassName ||
          `flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-gray-100 ${triggerClassName || ''}`
        }
        aria-label="Options"
      >
        {buttonContent || (
          <svg className="h-4 w-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </svg>
        )}
      </button>

      {/* Menu dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick()
                  setIsOpen(false)
                }
              }}
              disabled={item.disabled}
              className={`flex w-full items-center space-x-2 px-3 py-2 text-left transition-colors ${
                item.disabled
                  ? 'cursor-not-allowed text-gray-400'
                  : item.variant === 'danger'
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
