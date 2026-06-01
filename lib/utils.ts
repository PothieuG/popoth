import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Fonction utilitaire pour combiner les classes CSS avec clsx et tailwind-merge
 * Permet de fusionner intelligemment les classes Tailwind CSS en évitant les conflits
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Trie une liste d'objets nommés par ordre alphabétique (locale fr) et renvoie
 * une **copie** (ne mute jamais l'entrée — important pour les tableaux issus du
 * cache TanStack Query). `sensitivity: 'base'` = insensible casse/accents,
 * `numeric: true` = « Budget 2 » avant « Budget 10 ».
 */
export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }),
  )
}
