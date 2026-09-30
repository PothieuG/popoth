import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { useFocusAfterSubmit } from '../useFocusAfterSubmit'

// Pattern a11y « focus sur le premier champ fautif » (CLAUDE.md §8 Form
// client a11y). Les formulaires de l'app désactivent leurs champs pendant la
// soumission (`disabled={isSubmitting}`), or RHF est encore en isSubmitting
// quand `onInvalid` s'exécute. `form.setFocus` focus dans un setTimeout qui
// courait contre le rendu React réactivant le champ (échecs intermittents
// des tests `toHaveFocus` des dialogs, 2026-09-30). `shouldFocusError: false`
// coupe le repli interne de RHF pour que seul le focus demandé compte.

const schema = z.object({
  name: z.string().min(2, 'Nom trop court'),
  note: z.string(),
})
type FormValues = z.infer<typeof schema>

type FocusMode = 'direct' | 'deferred-direct' | 'deferred-setFocus'

function Harness({ mode, onInvalidSeen }: { mode: FocusMode; onInvalidSeen?: () => void }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', note: '' },
    shouldFocusError: false,
  })
  const focusAfterSubmit = useFocusAfterSubmit(form.formState.submitCount)
  const { isSubmitting, errors } = form.formState

  const onInvalidSubmit = (formErrors: FieldErrors<FormValues>) => {
    onInvalidSeen?.()
    if (!formErrors.name) return
    const focusName = () => document.getElementById('name')?.focus()
    if (mode === 'direct') focusName()
    else if (mode === 'deferred-direct') focusAfterSubmit(focusName)
    else focusAfterSubmit(() => form.setFocus('name'))
  }

  return (
    <form onSubmit={form.handleSubmit(() => {}, onInvalidSubmit)} noValidate>
      <label htmlFor="name">Nom</label>
      <input id="name" {...form.register('name')} disabled={isSubmitting} />
      {errors.name && <p role="alert">{errors.name.message}</p>}
      <label htmlFor="note">Note</label>
      <input id="note" {...form.register('note')} disabled={isSubmitting} />
      <button type="submit" disabled={isSubmitting}>
        Valider
      </button>
    </form>
  )
}

describe('useFocusAfterSubmit', () => {
  it('premise: the field is still disabled when onInvalid runs, so a direct focus misses', async () => {
    const user = userEvent.setup()
    let disabledDuringOnInvalid: boolean | undefined
    render(
      <Harness
        mode="direct"
        onInvalidSeen={() => {
          disabledDuringOnInvalid = (screen.getByLabelText('Nom') as HTMLInputElement).disabled
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nom trop court')
    expect(disabledDuringOnInvalid).toBe(true)
    expect(screen.getByLabelText('Nom')).toBeEnabled()
    expect(screen.getByLabelText('Nom')).not.toHaveFocus()
  })

  it('runs a deferred focus in the commit that re-enables the field and renders the error', async () => {
    const user = userEvent.setup()
    render(<Harness mode="deferred-direct" />)
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nom trop court')
    expect(screen.getByLabelText('Nom')).toHaveFocus()
  })

  it('lets form.setFocus (focus in a setTimeout) land on the re-enabled field', async () => {
    const user = userEvent.setup()
    render(<Harness mode="deferred-setFocus" />)
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    await waitFor(() => expect(screen.getByLabelText('Nom')).toHaveFocus())
  })

  it('runs the queued focus once — later re-renders do not steal focus back', async () => {
    const user = userEvent.setup()
    render(<Harness mode="deferred-direct" />)
    await user.click(screen.getByRole('button', { name: 'Valider' }))
    await waitFor(() => expect(screen.getByLabelText('Nom')).toHaveFocus())
    const note = screen.getByLabelText('Note')
    await user.type(note, 'abc')
    expect(note).toHaveFocus()
    expect(note).toHaveValue('abc')
  })
})
