'use client'

import { useState, useRef } from 'react'
import type { ProfileData } from '@/app/api/profile/route'
import { logger } from '@/lib/logger'
import UserAvatar from './UserAvatar'

interface AvatarUploadProps {
  profile: ProfileData | null
  onAvatarUpdate: (avatarUrl: string | null) => Promise<void>
  isUpdating?: boolean
  className?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'stacked' | 'inline'
}

/**
 * AvatarUpload Component - Allows users to upload and change their avatar
 * Supports both photo upload and removal to revert to initials.
 *
 * Variants:
 *  - 'stacked' (default): vertical layout, big avatar + full-width buttons + help text
 *  - 'inline':            horizontal layout, smaller avatar + text-link actions next to it
 */
export default function AvatarUpload({
  profile,
  onAvatarUpdate,
  isUpdating = false,
  className = '',
  size = 'lg',
  variant = 'stacked',
}: AvatarUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Convert file to base64 data URL for avatar storage
   */
  const convertFileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  /**
   * Handle file selection and upload
   */
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Veuillez sélectionner une image valide')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("L'image doit faire moins de 5 MB")
      return
    }

    setIsProcessing(true)
    try {
      const dataUrl = await convertFileToDataUrl(file)
      await onAvatarUpdate(dataUrl)
    } catch (error) {
      logger.error('Error uploading avatar:', error)
      alert("Erreur lors du téléchargement de l'image")
    } finally {
      setIsProcessing(false)
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  /**
   * Handle avatar removal (revert to initials)
   */
  const handleRemoveAvatar = async () => {
    setIsProcessing(true)
    try {
      await onAvatarUpdate(null)
    } catch (error) {
      logger.error('Error removing avatar:', error)
      alert("Erreur lors de la suppression de l'avatar")
    } finally {
      setIsProcessing(false)
    }
  }

  /**
   * Trigger file input click
   */
  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const isLoading = isProcessing || isUpdating
  const hasCustomAvatar = profile?.avatar_url

  // Hidden file input (shared by both variants)
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={handleFileSelect}
      className="hidden"
    />
  )

  // Inline variant — horizontal, compact: avatar à gauche + text-link actions à droite
  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="relative shrink-0">
          <UserAvatar
            profile={profile}
            size={size}
            className="transition-opacity duration-200"
            style={{ opacity: isLoading ? 0.6 : 1 }}
          />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isLoading}
            className="text-left text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {hasCustomAvatar ? 'Changer la photo' : 'Ajouter une photo'}
          </button>
          {hasCustomAvatar && (
            <button
              type="button"
              onClick={handleRemoveAvatar}
              disabled={isLoading}
              className="text-left text-xs text-gray-500 transition-colors hover:text-gray-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              Supprimer
            </button>
          )}
        </div>
        {fileInput}
      </div>
    )
  }

  // Stacked variant (default) — original vertical layout
  return (
    <div className={`flex flex-col items-center space-y-4 ${className}`}>
      {/* Avatar Display */}
      <div className="relative">
        <UserAvatar
          profile={profile}
          size={size}
          className="transition-opacity duration-200"
          style={{ opacity: isLoading ? 0.6 : 1 }}
        />

        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex w-full max-w-xs flex-col space-y-2">
        {/* Upload Button */}
        <button
          onClick={handleUploadClick}
          disabled={isLoading}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
            isLoading
              ? 'cursor-not-allowed bg-gray-300 text-gray-500'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
          } `}
        >
          {hasCustomAvatar ? 'Changer la photo' : 'Ajouter une photo'}
        </button>

        {/* Remove Button (only show if user has custom avatar) */}
        {hasCustomAvatar && (
          <button
            onClick={handleRemoveAvatar}
            disabled={isLoading}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
              isLoading
                ? 'cursor-not-allowed bg-gray-300 text-gray-500'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95'
            } `}
          >
            Supprimer la photo
          </button>
        )}
      </div>

      {fileInput}

      {/* Help text */}
      <p className="max-w-xs text-center text-xs text-gray-500">
        {hasCustomAvatar
          ? 'Vous pouvez changer ou supprimer votre photo de profil'
          : 'Ajoutez une photo personnelle ou gardez vos initiales'}
      </p>
    </div>
  )
}
