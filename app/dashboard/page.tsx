'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import FirstTimeProfileDialog from '@/components/profile/FirstTimeProfileDialog'
import EditProfileDialog from '@/components/profile/EditProfileDialog'

/**
 * Dashboard page - main application page for authenticated users
 * Clean interface with sticky navbar, slide-out menu panel, and sticky footer
 */
export default function DashboardPage() {
  const { logoutAndRedirect } = useAuth()
  const { profile, hasProfile, createProfile, updateProfile, isLoading } = useProfile()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [showProfileDialog, setShowProfileDialog] = useState(false)
  const [showEditProfileDialog, setShowEditProfileDialog] = useState(false)

  /**
   * Vérifie si l'utilisateur a un profil et affiche la dialog si nécessaire
   */
  useEffect(() => {
    if (!isLoading && !hasProfile) {
      setShowProfileDialog(true)
    }
  }, [isLoading, hasProfile])

  /**
   * Gère la création du profil utilisateur
   */
  const handleProfileSubmit = async (firstName: string, lastName: string): Promise<boolean> => {
    const success = await createProfile({ 
      first_name: firstName, 
      last_name: lastName 
    })
    
    if (success) {
      setShowProfileDialog(false)
    }
    
    return success
  }

  /**
   * Gère les erreurs de création de profil
   */
  const handleProfileError = (error: string) => {
    console.error('Erreur lors de la création du profil:', error)
    // On peut ajouter une toast notification ici plus tard
  }

  /**
   * Gère la mise à jour du profil utilisateur
   */
  const handleProfileUpdate = async (firstName: string, lastName: string): Promise<boolean> => {
    const success = await updateProfile({ 
      first_name: firstName, 
      last_name: lastName 
    })
    
    return success
  }

  /**
   * Ouvre la dialog d'édition du profil
   */
  const handleEditProfile = () => {
    setShowEditProfileDialog(true)
    setIsMenuOpen(false) // Fermer le menu
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
        <div className="flex justify-between items-center p-4">
          <div className="flex flex-col">
            <div className="text-lg font-semibold text-gray-900">
              Popoth App
            </div>
            {profile && (
              <div className="text-sm text-gray-600">
                Bonjour {profile.first_name} !
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMenuOpen(true)}
            className="p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1">
        {/* Empty content area for now */}
      </main>

      {/* Sticky Footer */}
      <footer className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
        {/* Empty footer for now */}
      </footer>

      {/* Slide-out Menu Panel */}
      <>
        {/* Overlay */}
        <div
          className={`fixed inset-0 z-50 bg-black transition-all duration-300 ease-in-out ${
            isMenuOpen ? 'bg-opacity-50 visible' : 'bg-opacity-0 invisible'
          }`}
          onClick={() => setIsMenuOpen(false)}
        />
        
        {/* Menu Panel */}
        <div className={`fixed inset-y-0 right-0 z-50 w-full bg-white shadow-xl transform transition-all duration-300 ease-in-out ${
          isMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}>
          <div className="flex flex-col h-full">
            {/* Menu Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMenuOpen(false)}
                className="p-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
            
            {/* Menu Content */}
            <div className="flex-1 p-4">
              {/* Profil utilisateur */}
              {profile && (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <h3 className="font-medium text-gray-900 mb-2">Mon profil</h3>
                    <p className="text-sm text-gray-600">{profile.first_name} {profile.last_name}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEditProfile}
                      className="mt-2 w-full"
                    >
                      Modifier
                    </Button>
                  </div>
                </div>
              )}
            </div>
            
            {/* Menu Footer with Logout */}
            <div className="p-4 border-t border-gray-200">
              <Button
                onClick={logoutAndRedirect}
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
              >
                Se déconnecter
              </Button>
            </div>
          </div>
        </div>
      </>

      {/* First Time Profile Dialog */}
      <FirstTimeProfileDialog
        isOpen={showProfileDialog}
        onSubmit={handleProfileSubmit}
        onError={handleProfileError}
      />

      {/* Edit Profile Dialog */}
      {profile && (
        <EditProfileDialog
          isOpen={showEditProfileDialog}
          onClose={() => setShowEditProfileDialog(false)}
          profile={profile}
          onSubmit={handleProfileUpdate}
          onError={handleProfileError}
        />
      )}
    </div>
  )
}