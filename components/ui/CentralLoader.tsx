'use client'

interface CentralLoaderProps {
  message?: string
}

/**
 * Loader centré dans son conteneur parent (`flex-1`), pour rendre à
 * l'intérieur d'un `<main>` sans masquer la navbar ou le footer du layout.
 * Ne JAMAIS utiliser `min-h-screen` ou `fixed inset-0` ici — le loader
 * est volontairement inline.
 */
export default function CentralLoader({ message }: CentralLoaderProps) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
        {message ? <p className="text-gray-600">{message}</p> : null}
      </div>
    </div>
  )
}
