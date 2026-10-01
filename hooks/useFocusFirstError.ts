'use client'

import { useEffect } from 'react'
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'

/**
 * Après une soumission invalide, place le focus sur le premier champ en erreur
 * (a11y, remplace le `setFocus` dans `onInvalidSubmit`).
 *
 * Pourquoi un effet : react-hook-form passe `isSubmitting` à `true` dès le
 * début de `handleSubmit`, validation comprise. Un champ `disabled={isSubmitting}`
 * est donc encore désactivé quand `onInvalidSubmit` s'exécute, et `focus()` sur
 * un champ désactivé ne fait rien ; le rattrapage interne de RHF (`setTimeout`)
 * ne réussit que si React a déjà ré-activé le champ, ce qui dépend de l'ordre
 * des rendus (test instable en CI le 2026-10-01). L'effet s'exécute après le
 * rendu de fin de soumission : les champs sont ré-activés, le focus est
 * déterministe.
 *
 * Ne réagit qu'à la fin d'une soumission (`submitCount` / `isSubmitting`), pas
 * aux erreurs re-validées pendant la saisie : le focus ne saute pas d'un champ
 * à l'autre pendant que l'utilisateur corrige.
 */
export function useFocusFirstError<TFieldValues extends FieldValues, TContext, TTransformedValues>(
  form: UseFormReturn<TFieldValues, TContext, TTransformedValues>,
): void {
  const { submitCount, isSubmitting, errors } = form.formState

  useEffect(() => {
    if (submitCount === 0 || isSubmitting) return
    const firstErrorKey = Object.keys(errors)[0]
    if (firstErrorKey) {
      form.setFocus(firstErrorKey as FieldPath<TFieldValues>)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `errors` exclu volontairement : focus uniquement à la fin d'une soumission, pas à chaque re-validation pendant la saisie
  }, [form, submitCount, isSubmitting])
}
