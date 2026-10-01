import { getSimulatedToday } from '@/lib/clock'

/**
 * Pastille « Date simulée » — visible uniquement quand `lib/clock` simule une
 * date (base de test + `NEXT_PUBLIC_DEV_TODAY`). Sans elle, rien ne distingue
 * à l'écran un dashboard « au 30 septembre » d'un dashboard du jour, et un
 * test oublié en date simulée ressemble à un bug de calcul.
 *
 * Gris neutre (ni ambre ni couleur métier), non cliquable, au-dessus de tout.
 */
export function SimulatedDateBadge() {
  const simulated = getSimulatedToday()
  if (!simulated) return null

  const label = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(simulated)

  return (
    <div
      role="status"
      className="pointer-events-none fixed top-[env(safe-area-inset-top)] left-1/2 z-[70] -translate-x-1/2 rounded-b-md bg-gray-900/85 px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-white"
    >
      Date simulée : {label}
    </div>
  )
}
