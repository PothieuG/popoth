import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'

import { useFocusFirstError } from '../useFocusFirstError'

/**
 * Formulaire minimal reproduisant le piège : champs `disabled={isSubmitting}`.
 * `shouldFocusError: false` coupe le rattrapage interne de react-hook-form,
 * pour que seul le hook puisse placer le focus (sinon le test passerait selon
 * l'ordre des rendus, exactement l'instabilité corrigée).
 */
function TestForm() {
  const form = useForm<{ first: string; second: string }>({
    defaultValues: { first: '', second: '' },
    shouldFocusError: false,
  })
  const isSubmitting = form.formState.isSubmitting
  useFocusFirstError(form)
  return (
    <form onSubmit={form.handleSubmit(() => {})}>
      <input
        aria-label="Premier"
        {...form.register('first', { required: true })}
        disabled={isSubmitting}
      />
      <input
        aria-label="Second"
        {...form.register('second', { required: true })}
        disabled={isSubmitting}
      />
      <button type="submit">Valider</button>
    </form>
  )
}

describe('useFocusFirstError', () => {
  it('place le focus sur le premier champ en erreur malgré les champs désactivés pendant la soumission', async () => {
    const user = userEvent.setup()
    render(<TestForm />)
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    await waitFor(() => expect(screen.getByLabelText('Premier')).toHaveFocus())
  })

  it('ne déplace pas le focus quand les erreurs sont re-validées pendant la saisie', async () => {
    const user = userEvent.setup()
    render(<TestForm />)
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    const first = screen.getByLabelText('Premier')
    await waitFor(() => expect(first).toHaveFocus())
    // L'utilisateur corrige le premier champ : la re-validation retire son
    // erreur, le premier champ en erreur devient « Second ». Le focus doit
    // rester là où il tape, pas sauter au champ suivant.
    await user.type(first, 'abc')
    await new Promise((r) => setTimeout(r, 50))
    expect(first).toHaveFocus()
    expect(first).toHaveValue('abc')
  })

  it('ne fait rien avant la première soumission', () => {
    render(<TestForm />)
    expect(document.body).toHaveFocus()
  })
})
