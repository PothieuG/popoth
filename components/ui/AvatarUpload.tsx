'use client'

import { useState, useRef } from 'react'
import { ProfileData } from '@/app/api/profile/route'
import UserAvatar from './UserAvatar'

interface AvatarUploadProps {
  profile: ProfileData | null
  onAvatarUpdate: (avatarUrl: string | null) => Promise<void>
  isUpdating?: boolean
  className?: string
}

/**
 * AvatarUpload Component - Allows users to upload and change their avatar
 * Supports both photo upload and removal to revert to initials
 */
export default function AvatarUpload({
  profile,
  onAvatarUpdate,
  isUpdating = false,
  className = ''
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
      alert('L\'image doit faire moins de 5 MB')
      return
    }

    setIsProcessing(true)
    try {
      const dataUrl = await convertFileToDataUrl(file)
      await onAvatarUpdate(dataUrl)
    } catch (error) {
      console.error('Error uploading avatar:', error)
      alert('Erreur lors du téléchargement de l\'image')
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
      console.error('Error removing avatar:', error)
      alert('Erreur lors de la suppression de l\'avatar')
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

  return (
    <div className={`flex flex-col items-center space-y-4 ${className}`}>
      {/* Avatar Display */}
      <div className="relative">
        <UserAvatar
          profile={profile}
          size="lg"
          className="transition-opacity duration-200"
          style={{ opacity: isLoading ? 0.6 : 1 }}
        />

        {/* Loading indicator */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col space-y-2 w-full max-w-xs">
        {/* Upload Button */}
        <button
          onClick={handleUploadClick}
          disabled={isLoading}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
            ${isLoading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
            }
          `}
        >
          {hasCustomAvatar ? 'Changer la photo' : 'Ajouter une photo'}
        </button>

        {/* Remove Button (only show if user has custom avatar) */}
        {hasCustomAvatar && (
          <button
            onClick={handleRemoveAvatar}
            disabled={isLoading}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${isLoading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95'
              }
            `}
          >
            Supprimer la photo
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Help text */}
      <p className="text-xs text-gray-500 text-center max-w-xs">
        {hasCustomAvatar
          ? 'Vous pouvez changer ou supprimer votre photo de profil'
          : 'Ajoutez une photo personnelle ou gardez vos initiales'
        }
      </p>
    </div>
  )
}