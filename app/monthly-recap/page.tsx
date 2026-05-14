'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import MonthlyRecapFlow from '@/components/monthly-recap/MonthlyRecapFlow'

function MonthlyRecapLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100">
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
  const context: 'profile' | 'group' = searchParams.get('context') === 'group' ? 'group' : 'profile'

  // Note : la redirection conditionnelle "récap requis" est gérée par le middleware.

  // Gestionnaire de fin de récap
  const handleRecapComplete = () => {
    // L'UI montre déjà la confirmation dans MonthlyRecapFlow (setTimeout redirect 2s).
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
