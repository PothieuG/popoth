'use client'

import { useState, useRef, useEffect } from 'react'

interface DropdownMenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
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
  buttonContent
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
          `w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 ${triggerClassName || ''}`
        }
        aria-label="Options"
      >
        {buttonContent || (
          <svg
            className="w-4 h-4 text-gray-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        )}
      </button>

      {/* Menu dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              className={`w-full px-3 py-2 text-left flex items-center space-x-2 hover:bg-gray-50 transition-colors ${
                item.variant === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-gray-700'
              }`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}