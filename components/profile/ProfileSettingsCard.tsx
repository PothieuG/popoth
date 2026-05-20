'use client'

import { useState } from 'react'
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
        <div className="animate-pulse space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-gray-200" />
            <div className="h-4 w-32 rounded bg-gray-200" />
          </div>
          <div className="h-4 w-3/4 rounded bg-gray-200" />
          <div className="h-4 w-1/2 rounded bg-gray-200" />
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
  const { contributions } = useGroupContributions()

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
        setSuccessMessage('Photo de profil mise à jour')
        setTimeout(() => setSuccessMessage(''), 3000)
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

  // Pre-compute contribution display (single source of truth for view-mode dl row)
  const contributionDisplay = (() => {
    if (!hasGroup || !currentGroup || !profile.salary || profile.salary <= 0) return null
    const otherMembers = contributions
      .filter((c) => c.profile_id !== profile.id)
      .map((c) => ({ id: c.profile_id, salary: c.salary }))
    const calc = calculateUserContribution(
      profile.salary,
      currentGroup.monthly_budget_estimate,
      otherMembers,
    )
    return {
      amount: calc.userContribution,
      percentOfSalary: calc.userPercentage,
      percentOfBudget:
        currentGroup.monthly_budget_estimate > 0
          ? (calc.userContribution / currentGroup.monthly_budget_estimate) * 100
          : 0,
    }
  })()

  const hasSalary = profile.salary !== null && profile.salary > 0

  return (
    <Card className={`p-6 ${className}`}>
      {/* Snackbar — fixed bottom, slide-in, auto-dismiss 3s. z-[60] passe au-dessus du drawer (z-50). */}
      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          className="animate-in slide-in-from-bottom-4 fade-in fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg duration-300"
        >
          {successMessage}
        </div>
      )}

      {/* Avatar block — compact inline (smaller avatar + text-link actions à côté) */}
      <AvatarUpload
        profile={profile}
        onAvatarUpdate={handleAvatarUpdate}
        isUpdating={isSaving}
        size="md"
        variant="inline"
      />

      {/* Divider subtil entre avatar et infos */}
      <div className="my-3 border-t border-gray-200" />

      {!isEditing ? (
        /* View mode — sous-titre + bouton Modifier inline, suivi des rows flat */
        <>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Informations</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              disabled={isSaving}
            >
              Modifier
            </Button>
          </div>

          <dl className="text-sm">
            <div className="flex items-center justify-between border-b border-gray-100 py-2">
              <dt className="text-gray-600">Prénom</dt>
              <dd className="font-medium text-gray-900">
                {profile.first_name || <span className="text-gray-400">Non défini</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 py-2">
              <dt className="text-gray-600">Nom</dt>
              <dd className="font-medium text-gray-900">
                {profile.last_name || <span className="text-gray-400">Non défini</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 py-2">
              <dt className="text-gray-600">
                Salaire mensuel <span className="text-red-500">*</span>
              </dt>
              <dd className={hasSalary ? 'font-medium text-gray-900' : 'font-medium text-red-600'}>
                {hasSalary && profile.salary !== null ? formatSalary(profile.salary) : 'Non défini'}
              </dd>
            </div>
            {contributionDisplay && (
              <div className="flex items-start justify-between py-2">
                <dt className="pt-0.5 text-gray-600">Contribution</dt>
                <dd className="text-right">
                  <div className="font-semibold text-blue-700">
                    {formatCurrency(contributionDisplay.amount)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatPercentage(contributionDisplay.percentOfSalary)} salaire ·{' '}
                    {formatPercentage(contributionDisplay.percentOfBudget)} budget
                  </div>
                </dd>
              </div>
            )}
          </dl>

          {!hasSalary && (
            <p className="mt-1.5 text-xs text-gray-500">
              <span className="text-red-500">*</span> Requis pour calculer votre contribution au
              groupe
            </p>
          )}
        </>
      ) : (
        /* Edit mode — grid horizontal (label gauche, input droite) pour matcher le <dl> view-mode */
        <>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            <Label htmlFor="firstName" className="text-sm text-gray-600">
              Prénom
            </Label>
            <Input
              id="firstName"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Votre prénom"
              className={errors.firstName ? 'border-red-300 focus:border-red-500' : ''}
            />
            {errors.firstName && (
              <p className="col-start-2 -mt-1 text-xs text-red-600">{errors.firstName}</p>
            )}

            <Label htmlFor="lastName" className="text-sm text-gray-600">
              Nom
            </Label>
            <Input
              id="lastName"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Votre nom"
              className={errors.lastName ? 'border-red-300 focus:border-red-500' : ''}
            />
            {errors.lastName && (
              <p className="col-start-2 -mt-1 text-xs text-red-600">{errors.lastName}</p>
            )}

            <Label htmlFor="salary" className="text-sm text-gray-600">
              Salaire <span className="text-red-500">*</span>
            </Label>
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
              <span className="absolute top-1/2 right-3 -translate-y-1/2 transform text-sm text-gray-500">
                €
              </span>
            </div>
            {errors.salary && (
              <p className="col-start-2 -mt-1 text-xs text-red-600">{errors.salary}</p>
            )}

            {/* Contribution Warning — span both columns */}
            {contributionWarning && !errors.salary && (
              <div className="col-span-2 rounded-md border border-red-200 bg-red-50 p-3">
                <div className="flex items-start">
                  <svg
                    className="mt-0.5 mr-1.5 h-5 w-5 shrink-0 text-red-400"
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
                    <p className="mb-1.5 text-sm font-medium text-red-800">
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

            <p className="col-start-2 text-xs text-gray-500">
              <span className="text-red-500">*</span> Requis pour la contribution au groupe
            </p>
          </div>

          {/* Action Buttons */}
          <div className="mt-3 flex gap-1.5">
            <Button
              onClick={handleSave}
              disabled={isSaving || contributionWarning !== null || Object.keys(errors).length > 0}
              className="flex-1 bg-linear-to-r from-blue-600 to-purple-600 text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              Annuler
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}
