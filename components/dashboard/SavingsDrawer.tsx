'use client'

import SavingsDistributionDrawer from './SavingsDistributionDrawer'

interface SavingsDrawerProps {
  isOpen: boolean
  onClose: () => void
  context?: 'profile' | 'group'
  onSavingsChange?: () => void
}

/**
 * Wrapper component for the SavingsDistributionDrawer
 * Provides a simplified interface for the dashboard
 */
export default function SavingsDrawer({
  isOpen,
  onClose,
  context = 'profile',
  onSavingsChange
}: SavingsDrawerProps) {
  return (
    <SavingsDistributionDrawer
      isOpen={isOpen}
      onClose={onClose}
      context={context}
      onSavingsChange={onSavingsChange}
    />
  )
}