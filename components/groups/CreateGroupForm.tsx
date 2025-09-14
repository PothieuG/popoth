'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

interface CreateGroupFormProps {
  onSubmit: (name: string, budget: number) => Promise<boolean>
  onCancel: () => void
}

/**
 * Form component for creating a new group
 */
export default function CreateGroupForm({ onSubmit, onCancel }: CreateGroupFormProps) {
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Handles form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!name.trim()) {
      setError('Le nom du groupe est requis')
      return
    }
    
    const budgetNumber = parseFloat(budget)
    if (!budget || isNaN(budgetNumber) || budgetNumber <= 0) {
      setError('Veuillez entrer un budget valide (nombre positif)')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const success = await onSubmit(name.trim(), budgetNumber)
      if (success) {
        // Reset form
        setName('')
        setBudget('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Group Name */}
          <div className="space-y-2">
            <Label htmlFor="groupName" className="text-sm font-medium text-gray-700">
              Nom du groupe *
            </Label>
            <Input
              id="groupName"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Ex: Famille Dupont"
              className="w-full"
              disabled={isSubmitting}
              maxLength={100}
            />
          </div>

          {/* Monthly Budget */}
          <div className="space-y-2">
            <Label htmlFor="monthlyBudget" className="text-sm font-medium text-gray-700">
              Budget mensuel estimé (€) *
            </Label>
            <Input
              id="monthlyBudget"
              type="number"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value)
                if (error) setError(null)
              }}
              placeholder="Ex: 2500"
              className="w-full"
              disabled={isSubmitting}
              min="0"
              step="0.01"
            />
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !name.trim() || !budget}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
          >
            {isSubmitting ? 'Création...' : 'Créer le groupe'}
          </Button>
        </div>

        {/* Helper Text */}
        <div className="text-xs text-gray-500">
          * Champs obligatoires. Le budget est utilisé pour les statistiques et peut être modifié plus tard.
        </div>
      </form>
    </Card>
  )
}