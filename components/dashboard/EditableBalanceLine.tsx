'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import EditBalanceModal from './EditBalanceModal'

interface EditableBalanceLineProps {
  currentBalance: number
  onBalanceUpdate: (newBalance: number) => void
  className?: string
}

/**
 * Ligne éditable pour le solde disponible dans le menu options
 * Affiche le solde actuel avec icône crayon pour édition
 */
export default function EditableBalanceLine({
  currentBalance,
  onBalanceUpdate,
  className = ''
}: EditableBalanceLineProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleBalanceSubmit = (newBalance: number) => {
    onBalanceUpdate(newBalance)
    setIsModalOpen(false)
  }

  return (
    <>
      <div className={`flex items-center justify-between py-3 px-0 border-t border-gray-200 ${className}`}>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">Solde disponible</span>
          <span className="text-xl font-semibold text-blue-600">
            {new Intl.NumberFormat('fr-FR', {
              style: 'currency',
              currency: 'EUR'
            }).format(currentBalance)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsModalOpen(true)}
          className="p-2 hover:bg-gray-50 rounded-full"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </Button>
      </div>

      <EditBalanceModal
        isOpen={isModalOpen}
        currentBalance={currentBalance}
        onSubmit={handleBalanceSubmit}
        onCancel={() => setIsModalOpen(false)}
      />
    </>
  )
}