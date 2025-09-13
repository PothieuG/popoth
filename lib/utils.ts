import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Fonction utilitaire pour combiner les classes CSS avec clsx et tailwind-merge
 * Permet de fusionner intelligemment les classes Tailwind CSS en évitant les conflits
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}