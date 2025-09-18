'use client'

import { useState, useEffect } from 'react'
import { ProfileData } from '@/app/api/profile/route'

interface UserAvatarProps {
  profile: ProfileData | null
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
  style?: React.CSSProperties
}

/**
 * UserAvatar Component - Displays user avatar with custom photo or initials
 * Can be clicked to trigger actions (like opening menu)
 * Supports both custom avatar images and fallback to initials
 */
export default function UserAvatar({
  profile,
  onClick,
  size = 'md',
  className = '',
  style = {}
}: UserAvatarProps) {
  const [imageLoadError, setImageLoadError] = useState(false)
  const [imageKey, setImageKey] = useState(0)

  // Reset image state when avatar_url changes
  useEffect(() => {
    setImageLoadError(false)
    setImageKey(prev => prev + 1) // Force image reload
  }, [profile?.avatar_url])

  // Generate initials from profile
  const getInitials = () => {
    if (!profile || !profile.first_name || !profile.last_name) {
      return '??'
    }
    return `${profile.first_name.charAt(0)}${profile.last_name.charAt(0)}`.toUpperCase()
  }

  // Generate background color from initials for consistency
  const getAvatarColor = () => {
    if (!profile) return 'bg-gray-400'
    
    const initials = getInitials()
    const colors = [
      'bg-blue-500',
      'bg-purple-500', 
      'bg-green-500',
      'bg-yellow-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-red-500',
      'bg-teal-500'
    ]
    
    // Use first letter for color selection
    const charCode = initials.charCodeAt(0)
    return colors[charCode % colors.length]
  }

  // Size classes
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  }

  // Check if user has custom avatar and no load error
  const hasCustomAvatar = profile?.avatar_url && !imageLoadError

  return (
    <button
      onClick={onClick}
      style={style}
      className={`
        ${sizeClasses[size]}
        ${hasCustomAvatar ? 'bg-gray-200' : getAvatarColor()}
        rounded-full
        flex items-center justify-center
        text-white font-semibold
        shadow-sm
        transition-all duration-200
        overflow-hidden
        ${onClick ? 'hover:shadow-md hover:scale-105 active:scale-95' : ''}
        ${className}
      `}
      disabled={!onClick}
    >
      {hasCustomAvatar ? (
        <img
          key={imageKey} // Force re-render when key changes
          src={profile.avatar_url}
          alt={`Avatar de ${profile.first_name} ${profile.last_name}`}
          className="w-full h-full object-cover"
          onError={() => {
            setImageLoadError(true)
          }}
          onLoad={() => {
            setImageLoadError(false)
          }}
        />
      ) : null}

      {/* Initials fallback - shown when no avatar or when image fails to load */}
      {!hasCustomAvatar && (
        <span className="w-full h-full flex items-center justify-center">
          {getInitials()}
        </span>
      )}
    </button>
  )
}