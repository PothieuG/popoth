'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useProfile } from '@/hooks/useProfile'
import { useGroups } from '@/hooks/useGroups'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import {
  calculateUserContribution,
  formatCurrency,
  formatPercentage,
} from '@/lib/contribution-calculator'
import { logger } from '@/lib/logger'
import AvatarUpload from '@/components/ui/AvatarUpload'
import type { ProfileData } from '@/app/api/profile/route'

interface ProfileSettingsCardProps {
  className?: string
}

/**
 * Outer wrapper: fetches the profile and gates the form on a non-null
 * profile, so the inner form can lazy-init its useState from `profile.*`
 * without a sync effect. The `key={profile.id}` remounts the form if the
 * underlying profile identity changes (e.g. account swap).
 */
export default function ProfileSettingsCard({ className }: ProfileSettingsCardProps) {
  const { profile, isLoading } = useProfile()

  if (isLoading || !profile) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="animate-pulse">
          <div className="mb-4 h-6 rounded bg-gray-200"></div>
          <div className="space-y-3">
            <div className="h-4 w-3/4 rounded bg-gray-200"></div>
            <div className="h-4 w-1/2 rounded bg-gray-200"></div>
          </div>
        </div>
      </Card>
    )
  }

  return <ProfileSettingsForm key={profile.id} profile={profile} className={className} />
}

interface ProfileSettingsFormProps {
  profile: ProfileData
  className?: string
}

/**
 * Inner form: receives a non-null profile prop and lazy-inits the form
 * fields from it. Remounts cleanly via `key={profile.id}` if the outer
 * swaps profile identity.
 */
function ProfileSettingsForm({ profile, className }: ProfileSettingsFormProps) {
  const { updateProfile } = useProfile()
  const { currentGroup, hasGroup } = useGroups()
  const { contributions, fetchContributions } = useGroupContributions()

  // Form state — lazy init from the (non-null) profile prop. The outer
  // gates rendering until profile is loaded, so the legacy sync effect
  // (and its eslint-disable) is no longer needed.
  const [firstName, setFirstName] = useState(() => profile.first_name || '')
  const [lastName, setLastName] = useState(() => profile.last_name || '')
  const [salary, setSalary] = useState(() => (profile.salary ? profile.salary.toString() : ''))
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [successMessage, setSuccessMessage] = useState('')
  const [contributionWarning, setContributionWarning] = useState<{
    message: string
    suggestions: string[]
  } | null>(null)

  // Load contributions when component mounts and user has a group
  useEffect(() => {
    if (hasGroup && currentGroup) {
      fetchContributions()
    }
  }, [hasGroup, currentGroup, fetchContributions])

  /**
   * Validates salary against potential contribution
   */
  const validateSalaryVsContribution = (salaryValue: string) => {
    setContributionWarning(null)

    // Only validate if user is in a group and salary is provided
    if (!hasGroup || !currentGroup || !salaryValue.trim()) {
      return
    }

    const salaryNum = parseFloat(salaryValue)
    if (isNaN(salaryNum) || salaryNum <= 0) {
      return
    }

    // Get other group members' salaries (excluding current user)
    const otherMembers = contributions
      .filter((contrib) => contrib.profile_id !== profile.id)
      .map((contrib) => ({
        id: contrib.profile_id,
        salary: contrib.salary,
      }))

    // Calculate what the contribution would be
    const calculation = calculateUserContribution(
      salaryNum,
      currentGroup.monthly_budget_estimate,
      otherMembers,
    )

    if (!calculation.isValid && calculation.errorMessage && calculation.suggestions) {
      setContributionWarning({
        message: calculation.errorMessage,
        suggestions: calculation.suggestions,
      })
    }
  }

  /**
   * Validates form fields
   */
  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!firstName.trim()) {
      newErrors.firstName = 'Le prénom est requis'
    } else if (firstName.trim().length < 1) {
      newErrors.firstName = 'Le prénom ne peut pas être vide'
    }

    if (!lastName.trim()) {
      newErrors.lastName = 'Le nom est requis'
    } else if (lastName.trim().length < 1) {
      newErrors.lastName = 'Le nom ne peut pas être vide'
    }

    // Salary is now required
    if (!salary.trim()) {
      newErrors.salary = 'Le salaire est requis'
    } else {
      const salaryNum = parseFloat(salary)
      if (isNaN(salaryNum) || salaryNum <= 0 || salaryNum > 999999.99) {
        newErrors.salary = 'Le salaire doit être un nombre entre 1 et 999,999.99 €'
      }
    }

    // Check if there's a contribution warning (blocking error)
    if (contributionWarning) {
      newErrors.salary = contributionWarning.message
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  /**
   * Handles avatar update
   */
  const handleAvatarUpdate = async (avatarUrl: string | null) => {
    try {
      const updates = {
        avatar_url: avatarUrl,
      }

      const success = await updateProfile(updates)
      if (success) {
        setSuccessMessage('Photo de profil mise à jour avec succès')

        // Force page refresh after a short delay to show success message
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      }
    } catch (error) {
      logger.error('Error updating avatar:', error)
      throw error
    }
  }

  /**
   * Handles form submission
   */
  const handleSave = async () => {
    setSuccessMessage('')

    if (!validateForm()) {
      return
    }

    setIsSaving(true)
    try {
      const updates = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        salary: salary.trim() ? parseFloat(salary) : 0,
      }

      const success = await updateProfile(updates)

      if (success) {
        setIsEditing(false)
        setSuccessMessage('Profil mis à jour avec succès')
        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error) {
      logger.error('Error saving profile:', error)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Handles edit cancellation — revert form to current profile values.
   */
  const handleCancel = () => {
    setFirstName(profile.first_name || '')
    setLastName(profile.last_name || '')
    setSalary(profile.salary ? profile.salary.toString() : '')
    setIsEditing(false)
    setErrors({})
    setSuccessMessage('')
    setContributionWarning(null)
  }

  /**
   * Handles salary change with validation
   */
  const handleSalaryChange = (value: string) => {
    setSalary(value)
    // Validate in real-time with a small delay
    setTimeout(() => validateSalaryVsContribution(value), 300)
  }

  /**
   * Formats salary for display
   */
  const formatSalary = (amount: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return (
    <Card className={`p-6 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Mon profil</h2>
        {!isEditing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            disabled={isSaving}
          >
            Modifier
          </Button>
        )}
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mb-4 rounded border border-green-400 bg-green-100 p-3 text-green-700">
          {successMessage}
        </div>
      )}

      <div className="space-y-6">
        {/* Avatar Upload Section */}
        <div className="border-b border-gray-200 pb-6">
          <h3 className="mb-4 text-sm font-medium text-gray-700">Photo de profil</h3>
          <AvatarUpload
            profile={profile}
            onAvatarUpdate={handleAvatarUpdate}
            isUpdating={isSaving}
            className="mx-auto"
          />
        </div>

        {/* First Name */}
        <div>
          <Label htmlFor="firstName" className="text-sm font-medium text-gray-700">
            Prénom
          </Label>
          {isEditing ? (
            <div className="mt-1">
              <Input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Votre prénom"
                className={errors.firstName ? 'border-red-300 focus:border-red-500' : ''}
              />
              {errors.firstName && <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-900">{profile.first_name || 'Non défini'}</p>
          )}
        </div>

        {/* Last Name */}
        <div>
          <Label htmlFor="lastName" className="text-sm font-medium text-gray-700">
            Nom
          </Label>
          {isEditing ? (
            <div className="mt-1">
              <Input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Votre nom"
                className={errors.lastName ? 'border-red-300 focus:border-red-500' : ''}
              />
              {errors.lastName && <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-900">{profile.last_name || 'Non défini'}</p>
          )}
        </div>

        {/* Salary */}
        <div>
          <Label htmlFor="salary" className="text-sm font-medium text-gray-700">
            Salaire mensuel <span className="text-red-500">*</span>
          </Label>
          {isEditing ? (
            <div className="mt-1">
              <div className="relative">
                <Input
                  id="salary"
                  type="number"
                  min="0"
                  max="999999.99"
                  step="0.01"
                  value={salary}
                  onChange={(e) => handleSalaryChange(e.target.value)}
                  placeholder="Ex: 2500"
                  className={`pr-8 ${errors.salary || contributionWarning ? 'border-red-300 focus:border-red-500' : ''}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 transform text-sm text-gray-500">
                  €
                </span>
              </div>
              {errors.salary && <p className="mt-1 text-sm text-red-600">{errors.salary}</p>}

              {/* Contribution Warning */}
              {contributionWarning && !errors.salary && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="flex items-start">
                    <svg
                      className="mr-2 mt-0.5 h-5 w-5 flex-shrink-0 text-red-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="mb-2 text-sm font-medium text-red-800">
                        {contributionWarning.message}
                      </p>
                      <div className="text-xs text-red-700">
                        <p className="mb-1 font-medium">Solutions possibles :</p>
                        <ul className="list-inside list-disc space-y-1">
                          {contributionWarning.suggestions.map((suggestion, index) => (
                            <li key={index}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <p className="mt-1 text-xs text-gray-500">
                <span className="text-red-500">*</span> Requis pour calculer votre contribution au
                budget du groupe
              </p>
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="text-sm text-gray-900">
                {profile.salary && profile.salary > 0 ? (
                  formatSalary(profile.salary)
                ) : (
                  <span className="text-red-600">Non défini (requis)</span>
                )}
              </p>

              {/* Display contribution if user has a group and salary */}
              {hasGroup && currentGroup && profile.salary && profile.salary > 0 && (
                <div className="rounded-md bg-blue-50 p-2">
                  <p className="mb-1 text-xs font-medium text-blue-700">
                    Votre contribution au groupe :
                  </p>
                  {(() => {
                    const otherMembers = contributions
                      .filter((contrib) => contrib.profile_id !== profile.id)
                      .map((contrib) => ({ id: contrib.profile_id, salary: contrib.salary }))

                    const calculation = calculateUserContribution(
                      profile.salary,
                      currentGroup.monthly_budget_estimate,
                      otherMembers,
                    )

                    return (
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-blue-800">
                          {formatCurrency(calculation.userContribution)}
                        </span>
                        <span className="text-xs text-blue-600">
                          ({formatPercentage(calculation.userPercentage)} de votre salaire,{' '}
                          {formatPercentage(
                            (calculation.userContribution / currentGroup.monthly_budget_estimate) *
                              100,
                          )}{' '}
                          du budget)
                        </span>
                      </div>
                    )
                  })()}
                </div>
              )}

              {profile.salary && profile.salary > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="text-red-500">*</span> Utilisé pour le calcul des contributions
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {isEditing && (
          <div className="flex space-x-3 border-t border-gray-200 pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving || contributionWarning !== null || Object.keys(errors).length > 0}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              Annuler
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
