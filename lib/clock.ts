/**
 * Date du jour vue par l'appli.
 *
 * Partout sauf sur la base de test : l'heure réelle, sans exception.
 *
 * Sur la base de test (projet Supabase dev) uniquement,
 * `NEXT_PUBLIC_DEV_TODAY=AAAA-MM-JJ` simule une autre date (ou `DEV_TODAY`, sans
 * préfixe : `next.config.js` la recopie sous ce nom — Vercel refuse le préfixe
 * public sur une variable de type secret). Sert à rejouer une
 * fin de mois : saisir sur le dashboard « la veille », puis avancer au 1er pour
 * que le récap mensuel se déclenche. Sans ça, le dashboard est inaccessible dès
 * le 1er tant que le récap du mois écoulé n'est pas terminé.
 *
 * Le garde-fou porte sur la BASE, pas sur l'environnement d'exécution : le site
 * de test en ligne tourne en `NODE_ENV=production`, et un `pnpm dev` local peut
 * pointer sur la prod. Simuler une date contre la prod y déclencherait un vrai
 * récap : la variable y est donc ignorée, où qu'elle soit posée.
 *
 * Ne remplace que les dates MÉTIER (mois en cours, mois recapé, date par
 * défaut d'une saisie). Les horodatages techniques (`updated_at`,
 * `applied_to_balance_at`, expiration de session) restent sur l'heure réelle,
 * tout comme les `CURRENT_DATE` / `NOW()` des fonctions SQL.
 *
 * Midi, heure locale : `toISOString().split('T')[0]` redonne alors le même
 * jour quel que soit le fuseau.
 */

const DEV_SUPABASE_REF = 'ddehmjucyfgyppfkbddr'
const DEV_TODAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Date simulée, ou `null` hors base de test / si la variable est absente ou invalide. */
export function getSimulatedToday(): Date | null {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(DEV_SUPABASE_REF)) return null
  const match = DEV_TODAY_PATTERN.exec(process.env.NEXT_PUBLIC_DEV_TODAY ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12, 0, 0)
  // 2026-02-31 → le constructeur glisserait sur mars : refusé plutôt que deviné.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/** À utiliser à la place de `new Date()` pour toute date métier. */
export function now(): Date {
  return getSimulatedToday() ?? new Date()
}

/** Date métier du jour, `AAAA-MM-JJ`. */
export function todayIso(): string {
  return now().toISOString().split('T')[0] as string
}
