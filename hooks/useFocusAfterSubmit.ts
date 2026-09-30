'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Déplace le focus une fois la soumission react-hook-form terminée — pour le
 * pattern a11y « focus sur le premier champ fautif » des `onInvalidSubmit`.
 *
 * Pourquoi pas `form.setFocus` directement dans `onInvalidSubmit` : RHF passe
 * `isSubmitting` à true AVANT la validation et ne le repasse à false qu'APRÈS
 * `onInvalid`. Les formulaires qui désactivent leurs champs pendant la
 * soumission (`disabled={isSubmitting}`) ont donc encore le champ fautif
 * désactivé quand `onInvalid` s'exécute. Un `.focus()` direct y échoue
 * toujours ; `form.setFocus` (et le repli `shouldFocusError`) focus dans un
 * `setTimeout`, en course avec le rendu React qui réactive le champ : quand
 * le timer passait en premier, le focus restait sur le bouton de validation
 * (tests `toHaveFocus` intermittents, diagnostiqué 2026-09-30).
 *
 * L'action est mémorisée puis exécutée dans le layout effect du rendu où
 * `submitCount` s'incrémente — la même mise à jour RHF que
 * `isSubmitting: false` : le champ est de nouveau actif dans le DOM. Un
 * `.focus()` direct y est posé dans ce commit ; `form.setFocus` y arme son
 * timer, qui trouve le champ actif.
 */
export function useFocusAfterSubmit(submitCount: number): (focus: () => void) => void {
  const pendingFocusRef = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const focus = pendingFocusRef.current
    pendingFocusRef.current = null
    focus?.()
  }, [submitCount])

  return useCallback((focus: () => void) => {
    pendingFocusRef.current = focus
  }, [])
}
