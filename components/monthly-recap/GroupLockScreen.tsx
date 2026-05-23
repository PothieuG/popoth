'use client'

import { Button } from '@/components/ui/button'
import { useLogoutAndRedirect } from '@/hooks/useAuth'

export function GroupLockScreen({ startedByName }: { startedByName: string | null }) {
  const { logoutAndRedirect } = useLogoutAndRedirect()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Récap en cours</h1>
      <p className="mb-4 text-sm text-gray-700">
        {startedByName
          ? `${startedByName} est en train de réaliser le récap mensuel du groupe.`
          : 'Un membre du groupe est en train de réaliser le récap mensuel du groupe.'}
      </p>
      <p className="mb-8 text-sm text-gray-700">
        Vous pourrez accéder au groupe une fois le récap terminé.
      </p>
      <Button onClick={() => void logoutAndRedirect()} variant="secondary">
        Se déconnecter
      </Button>
    </div>
  )
}
