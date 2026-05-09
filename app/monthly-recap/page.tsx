'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import MonthlyRecapFlow from '@/components/monthly-recap/MonthlyRecapFlow'

function MonthlyRecapLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        <p className="text-gray-600">Chargement du récapitulatif mensuel...</p>
      </div>
    </div>
  )
}

export default function MonthlyRecapPage() {
  return (
    <Suspense fallback={<MonthlyRecapLoadingFallback />}>
      <MonthlyRecapPageContent />
    </Suspense>
  )
}

function MonthlyRecapPageContent() {
  const searchParams = useSearchParams()
  // Context is derived directly from the URL parameter — useSearchParams is
  // synchronous, so no loading state is needed here.
  const context: 'profile' | 'group' =
    searchParams.get('context') === 'group' ? 'group' : 'profile'

  // TEMPORAIREMENT DÉSACTIVÉ : Double vérification pour éviter les boucles
  // La redirection est déjà gérée par le middleware
  // useEffect(() => {
  //   const checkRecapRequired = async () => {
  //     try {
  //       const response = await fetch(`/api/monthly-recap/status?context=${context}`)
  //       const data = await response.json()

  //       if (response.ok && !data.required) {
  //         console.log('📅 [MonthlyRecapPage] Récap non requis, redirection vers le dashboard')
  //         const dashboardUrl = context === 'profile' ? '/dashboard' : '/group-dashboard'
  //         router.replace(dashboardUrl)
  //       }
  //     } catch (error) {
  //       console.error('❌ Erreur lors de la vérification du récap requis:', error)
  //     }
  //   }

  //   if (!isChecking) {
  //     checkRecapRequired()
  //   }
  // }, [context, router, isChecking])

  // Debug: Log pour voir si la page se charge
  useEffect(() => {
    console.log('📅 [MonthlyRecapPage] Page chargée avec contexte:', context)
  }, [context])

  // Gestionnaire de fin de récap
  const handleRecapComplete = () => {
    console.log('✅ [MonthlyRecapPage] Récapitulatif terminé avec succès')

    // Afficher un message de confirmation
    const confirmMessage =
      context === 'profile'
        ? 'Récapitulatif personnel terminé ! Redirection vers votre dashboard...'
        : 'Récapitulatif de groupe terminé ! Redirection vers le dashboard de groupe...'

    // Vous pouvez ajouter ici une notification toast si vous en avez un système
    console.log(confirmMessage)
  }

  // Empêcher la navigation en arrière avec le navigateur
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'Votre récapitulatif mensuel est en cours. Êtes-vous sûr de vouloir quitter ?'
    }

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault()
      // Repousser l'état actuel pour empêcher la navigation arrière
      window.history.pushState(null, '', window.location.href)
    }

    // Ajouter l'état initial pour empêcher le retour en arrière
    window.history.pushState(null, '', window.location.href)

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  return (
    <div className="monthly-recap-page">
      {/* Meta informations pour SEO et navigation */}
      <div className="sr-only">
        <h1>Récapitulatif mensuel {context === 'profile' ? 'personnel' : 'de groupe'}</h1>
        <p>Gestion des économies et bonus financiers mensuels</p>
      </div>

      {/* Composant principal du flux de récap */}
      <MonthlyRecapFlow context={context} onComplete={handleRecapComplete} />

      {/* Message d'information discret */}
      <div className="sr-only">
        <p>
          Ce récapitulatif mensuel est obligatoire et doit être complété avant de pouvoir accéder
          aux autres fonctionnalités de l&apos;application.
        </p>
      </div>
    </div>
  )
}
