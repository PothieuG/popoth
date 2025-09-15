'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useProfile } from '@/hooks/useProfile'
import { useGroupContributions } from '@/hooks/useGroupContributions'
import { useFinancialData } from '@/hooks/useFinancialData'
import FirstTimeProfileDialog from '@/components/profile/FirstTimeProfileDialog'
import ProfileSettingsCard from '@/components/profile/ProfileSettingsCard'
import UserInfoNavbar from '@/components/ui/UserInfoNavbar'
import UserAvatar from '@/components/ui/UserAvatar'
import FinancialIndicators from '@/components/dashboard/FinancialIndicators'

/**
 * Dashboard page - main application page for authenticated users
 * Clean interface with sticky navbar, slide-out menu panel, and sticky footer
 */
export default function DashboardPage() {
  const { logoutAndRedirect } = useAuth()
  const { profile, hasProfile, createProfile, updateProfile, isLoading } = useProfile()
  const { getUserContribution, fetchContributions } = useGroupContributions()
  const { financialData, loading: financialLoading, error: financialError, cached, context, refreshFinancialData } = useFinancialData()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  /**
   * Gère la création du profil utilisateur
   */
  const handleProfileSubmit = async (firstName: string, lastName: string): Promise<boolean> => {
    const success = await createProfile({ 
      first_name: firstName, 
      last_name: lastName 
    })
    
    return success
  }

  /**
   * Gère les erreurs de création de profil
   */
  const handleProfileError = (error: string) => {
    console.error('Erreur lors de la création du profil:', error)
    // On peut ajouter une toast notification ici plus tard
  }

  // Récupérer les contributions quand le profil est chargé
  useEffect(() => {
    if (profile?.group_id && !isLoading) {
      fetchContributions()
    }
  }, [profile?.group_id, isLoading, fetchContributions])


  // Afficher loader pendant le chargement du profil ou des données financières
  if (isLoading || financialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">
            {isLoading ? 'Chargement du profil...' : 'Calcul des données financières...'}
          </p>
          {cached && <p className="text-xs text-gray-500 mt-2">Données mises en cache</p>}
        </div>
      </div>
    )
  }

  // Une fois chargé, si pas de profil, montrer la dialog
  if (!hasProfile) {
    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100" />
        <FirstTimeProfileDialog
          isOpen={true}
          onSubmit={handleProfileSubmit}
          onError={handleProfileError}
        />
      </>
    )
  }

  // Si profil existe, afficher le dashboard normal
  return (
    <div className="min-h-screen flex flex-col bg-blue-50/50">
      {/* Sticky Navbar */}
      <nav className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200">
        <div className="flex justify-between items-center p-4">
          <UserInfoNavbar 
            profile={profile}
            userContribution={profile?.id ? getUserContribution(profile.id) : null}
          />
          <UserAvatar
            profile={profile}
            onClick={() => setIsMenuOpen(true)}
            size="md"
          />
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4">
        <div className="space-y-6">
          {/* Financial Indicators */}
          {financialError ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center space-x-2">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-red-800 font-medium">Erreur de calcul des données financières</p>
                  <p className="text-red-600 text-sm">{financialError}</p>
                </div>
              </div>
            </div>
          ) : (
            <FinancialIndicators
              availableBalance={financialData?.availableBalance || 0}
              remainingToLive={financialData?.remainingToLive || 0}
              totalSavings={financialData?.totalSavings || 0}
              onPlanningChange={refreshFinancialData}
            />
          )}


        </div>
      </main>

      {/* Navigation Footer */}
      <footer className="sticky bottom-0 z-40 bg-white border-t border-gray-200">
        <div className="flex justify-center items-center p-4 h-16">
          <div className="flex space-x-8">
            {/* Personal Finance Button - Always visible */}
            <button 
              className="flex flex-col items-center justify-center p-3 rounded-lg transition-colors duration-200 hover:bg-gray-50 text-gray-600"
            >
              <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs">Personnel</span>
            </button>

            {/* Group Finance Button - Only visible if user belongs to a group */}
            {profile?.group_id && (
              <button 
                className="flex flex-col items-center justify-center p-3 rounded-lg hover:bg-gray-50 transition-colors duration-200"
              >
                <svg className="w-6 h-6 text-purple-600 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="text-xs text-gray-600">{profile.group_name || 'Groupe'}</span>
              </button>
            )}
          </div>
        </div>
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
              <h2 className="text-lg font-semibold text-gray-900">Paramètres</h2>
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
              {/* Navigation Links */}
              <div className="space-y-3 mb-6">
                <Button
                  variant="ghost"
                  onClick={() => {
                    window.location.href = '/settings'
                    setIsMenuOpen(false)
                  }}
                  className="w-full justify-start text-left"
                >
                  <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Gestion du groupe
                </Button>
              </div>

              {/* Profil utilisateur */}
              {profile && (
                <div className="space-y-4">
                  <ProfileSettingsCard className="bg-transparent border-0 shadow-none p-0" />
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

    </div>
  )
}