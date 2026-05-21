import type { KeyboardEvent } from 'react'

/**
 * onKeyDown handler à brancher sur les <form> des modals/drawers. Empêche
 * Enter (touche "Go"/"Return" sur le clavier mobile) de déclencher le submit
 * implicite quand l'utilisateur veut juste fermer le clavier. L'utilisateur
 * doit cliquer explicitement sur le bouton de validation.
 *
 * Passe-droit : <textarea> (multi-line), <button> (clic intentionnel sur un
 * bouton focus), <a> (lien). Les modificateurs (Shift/Ctrl/Meta/Alt) sont
 * aussi laissés passer pour ne pas bloquer un raccourci futur.
 */
export function preventEnterSubmit(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (target.tagName === 'TEXTAREA') return
  if (target.tagName === 'BUTTON') return
  if (target.tagName === 'A') return
  e.preventDefault()
  target.blur()
}
