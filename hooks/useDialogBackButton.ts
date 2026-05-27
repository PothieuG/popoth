'use client'

import { useEffect, useRef } from 'react'

/**
 * Sprint Mobile-Back-Closes-Drawers (2026-05-27). Permet au geste retour
 * mobile (swipe iOS, bouton Android) de fermer drawers et modales au lieu
 * de naviguer en arrière. Wired dans <Dialog> ([components/ui/dialog.tsx])
 * pour bénéficier automatiquement à toutes les surfaces Radix, et appelé
 * manuellement par SettingsDrawer (custom non-Radix).
 *
 * Fonctionnement :
 *   - À l'ouverture (open=true) → pushState d'un sentinel `__dialog: id`,
 *     merged avec l'état Next.js existant pour ne pas casser son routing.
 *   - À la fermeture programmatique (X / Escape / backdrop) → cleanup
 *     vérifie que le sentinel est encore en haut de l'historique et
 *     appelle history.back pour le retirer.
 *   - À la fermeture par popstate (back gesture) → flag fromPopstate
 *     évite le history.back redondant.
 *
 * Empilement : un seul listener global, stack module-level. Le popstate
 * ferme uniquement le dialog du dessus → back gesture ferme une fenêtre
 * à la fois, miroir du comportement natif iOS/Android.
 */

type DialogStackEntry = {
  id: string
  closeRef: React.RefObject<() => void>
  fromPopstate: boolean
}

const stack: DialogStackEntry[] = []
let listenerAttached = false
// Compteur des history.back() que nous déclenchons nous-mêmes (cleanup d'un
// close programmatique). Chaque popstate consomme un crédit avant d'être
// traité comme un back gesture utilisateur — sinon fermer un dialog enfant
// fait cascade et ferme aussi le parent (le history.back de cleanup déclenche
// popstate qui referme l'élément en dessous dans le stack).
let pendingProgrammaticBacks = 0

const globalPopstateHandler = () => {
  if (pendingProgrammaticBacks > 0) {
    pendingProgrammaticBacks--
    return
  }
  const top = stack[stack.length - 1]
  if (!top) return
  top.fromPopstate = true
  top.closeRef.current()
}

function ensureGlobalListener() {
  if (listenerAttached || typeof window === 'undefined') return
  listenerAttached = true
  window.addEventListener('popstate', globalPopstateHandler)
}

export function useDialogBackButton(open: boolean, onClose: () => void) {
  // Ref pour éviter de re-déclencher l'effet à chaque render (les consumers
  // passent souvent des arrow functions inline).
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    ensureGlobalListener()

    const entry: DialogStackEntry = {
      id: `dlg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      closeRef,
      fromPopstate: false,
    }
    stack.push(entry)

    // Merge avec l'état Next.js existant — son router persiste son tree
    // ({__PRIVATE_NEXTJS_INTERNALS_TREE, key, ...}) sur window.history.state
    // et le perdrait si on écrasait avec uniquement notre sentinel.
    const currentState = (window.history.state as Record<string, unknown> | null) ?? {}
    window.history.pushState({ ...currentState, __dialog: entry.id }, '')

    return () => {
      const idx = stack.indexOf(entry)
      if (idx >= 0) stack.splice(idx, 1)
      if (entry.fromPopstate) return

      // Vérifie que notre sentinel est toujours en haut : si l'utilisateur
      // a navigué vers une autre page pendant que le drawer était ouvert,
      // un history.back nous renverrait au sentinel orphelin au lieu de
      // rester sur la nouvelle page.
      const topState = window.history.state as { __dialog?: string } | null
      if (topState?.__dialog === entry.id) {
        pendingProgrammaticBacks++
        window.history.back()
      }
    }
  }, [open])
}

// Test-only reset. Le stack et le listener module-level survivent entre les
// tests d'un même fichier, ce helper isole chaque cas.
export function __resetDialogStackForTests() {
  stack.length = 0
  pendingProgrammaticBacks = 0
  if (listenerAttached && typeof window !== 'undefined') {
    window.removeEventListener('popstate', globalPopstateHandler)
  }
  listenerAttached = false
}
