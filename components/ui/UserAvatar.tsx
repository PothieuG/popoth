'use client'

import { ProfileData } from '@/app/api/profile/route'

interface UserAvatarProps {
  profile: ProfileData | null
  onClick?: () => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * UserAvatar Component - Displays user avatar with initials
 * Can be clicked to trigger actions (like opening menu)
 * Future: will support image upload
 */
export default function UserAvatar({ 
  profile, 
  onClick, 
  size = 'md', 
  className = '' 
}: UserAvatarProps) {
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

  return (
    <button
      onClick={onClick}
      className={`
        ${sizeClasses[size]}
        ${getAvatarColor()}
        rounded-full
        flex items-center justify-center
        text-white font-semibold
        shadow-sm
        transition-all duration-200
        ${onClick ? 'hover:shadow-md hover:scale-105 active:scale-95' : ''}
        ${className}
      `}
      disabled={!onClick}
    >
      {getInitials()}
    </button>
  )
}