'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useProfile } from '@/hooks/useProfile'
import { useGroups } from '@/hooks/useGroups'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { calculateUserContribution, formatCurrency, formatPercentage } from '@/lib/contribution-calculator'
import AvatarUpload from '@/components/ui/AvatarUpload'

interface ProfileSettingsCardProps {
  className?: string
}

/**
 * Component for managing user profile settings including personal information and salary
 */
export default function ProfileSettingsCard({ className }: ProfileSettingsCardProps) {
  const { profile, isLoading, updateProfile, hasProfile, fetchProfile } = useProfile()
  const { currentGroup, hasGroup } = useGroups()
  const { contributions, fetchContributions } = useGroupContributions()
  
  // Form state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [salary, setSalary] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [successMessage, setSuccessMessage] = useState('')
  const [contributionWarning, setContributionWarning] = useState<{
    message: string
    suggestions: string[]
  } | null>(null)

  // Initialize form with profile data
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '')
      setLastName(profile.last_name || '')
      setSalary(profile.salary ? profile.salary.toString() : '')
    }
  }, [profile])

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
      .filter(contrib => contrib.profile_id !== profile?.id)
      .map(contrib => ({
        id: contrib.profile_id,
        salary: contrib.salary
      }))

    // Calculate what the contribution would be
    const calculation = calculateUserContribution(
      salaryNum,
      currentGroup.monthly_budget_estimate,
      otherMembers
    )

    if (!calculation.isValid && calculation.errorMessage && calculation.suggestions) {
      setContributionWarning({
        message: calculation.errorMessage,
        suggestions: calculation.suggestions
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
        avatar_url: avatarUrl
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
      console.error('Error updating avatar:', error)
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
        salary: salary.trim() ? parseFloat(salary) : 0
      }

      const success = await updateProfile(updates)

      if (success) {
        setIsEditing(false)
        setSuccessMessage('Profil mis à jour avec succès')
        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Handles edit cancellation
   */
  const handleCancel = () => {
    if (profile) {
      setFirstName(profile.first_name || '')
      setLastName(profile.last_name || '')
      setSalary(profile.salary ? profile.salary.toString() : '')
    }
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
      maximumFractionDigits: 0
    }).format(amount)
  }

  if (isLoading || !hasProfile) {
    return (
      <Card className={`p-6 ${className}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className={`p-6 ${className}`}>
      <div className="flex justify-between items-center mb-4">
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
        <div className="mb-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          {successMessage}
        </div>
      )}

      <div className="space-y-6">
        {/* Avatar Upload Section */}
        <div className="border-b border-gray-200 pb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Photo de profil</h3>
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
              {errors.firstName && (
                <p className="mt-1 text-sm text-red-600">{errors.firstName}</p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-900">{profile?.first_name || 'Non défini'}</p>
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
              {errors.lastName && (
                <p className="mt-1 text-sm text-red-600">{errors.lastName}</p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-900">{profile?.last_name || 'Non défini'}</p>
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
                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">
                  €
                </span>
              </div>
              {errors.salary && (
                <p className="mt-1 text-sm text-red-600">{errors.salary}</p>
              )}
              
              {/* Contribution Warning */}
              {contributionWarning && !errors.salary && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex items-start">
                    <svg className="w-5 h-5 text-red-400 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-800 mb-2">
                        {contributionWarning.message}
                      </p>
                      <div className="text-xs text-red-700">
                        <p className="font-medium mb-1">Solutions possibles :</p>
                        <ul className="list-disc list-inside space-y-1">
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
                <span className="text-red-500">*</span> Requis pour calculer votre contribution au budget du groupe
              </p>
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="text-sm text-gray-900">
                {profile?.salary && profile.salary > 0 
                  ? formatSalary(profile.salary) 
                  : <span className="text-red-600">Non défini (requis)</span>
                }
              </p>
              
              {/* Display contribution if user has a group and salary */}
              {hasGroup && currentGroup && profile?.salary && profile.salary > 0 && (
                <div className="bg-blue-50 p-2 rounded-md">
                  <p className="text-xs text-blue-700 font-medium mb-1">Votre contribution au groupe :</p>
                  {(() => {
                    const otherMembers = contributions
                      .filter(contrib => contrib.profile_id !== profile?.id)
                      .map(contrib => ({ id: contrib.profile_id, salary: contrib.salary }))
                    
                    const calculation = calculateUserContribution(
                      profile.salary,
                      currentGroup.monthly_budget_estimate,
                      otherMembers
                    )
                    
                    return (
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-semibold text-blue-800">
                          {formatCurrency(calculation.userContribution)}
                        </span>
                        <span className="text-xs text-blue-600">
                          ({formatPercentage(calculation.userPercentage)} de votre salaire, {formatPercentage((calculation.userContribution / currentGroup.monthly_budget_estimate) * 100)} du budget)
                        </span>
                      </div>
                    )
                  })()}
                </div>
              )}
              
              {profile?.salary && profile.salary > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="text-red-500">*</span> Utilisé pour le calcul des contributions
                </p>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        {isEditing && (
          <div className="flex space-x-3 pt-4 border-t border-gray-200">
            <Button
              onClick={handleSave}
              disabled={isSaving || contributionWarning !== null || Object.keys(errors).length > 0}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Annuler
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}