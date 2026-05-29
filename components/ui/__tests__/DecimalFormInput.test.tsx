import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useForm, useWatch } from 'react-hook-form'
import { DecimalFormInput } from '../DecimalFormInput'

type Values = { amount: string | number }

function TestHost(props: {
  allowNegative?: boolean
  ariaInvalid?: boolean
  defaultValues?: Partial<Values>
}) {
  const form = useForm<Values>({
    defaultValues: props.defaultValues ?? { amount: '' },
  })
  const value = useWatch({ control: form.control, name: 'amount' })
  return (
    <>
      <DecimalFormInput
        control={form.control}
        name="amount"
        id="amount-input"
        allowNegative={props.allowNegative}
        ariaInvalid={props.ariaInvalid}
      />
      <span data-testid="display">{value === undefined ? 'UNDEFINED' : String(value)}</span>
    </>
  )
}

describe('DecimalFormInput', () => {
  it('accepts digits with a single dot separator (regex positive)', () => {
    render(<TestHost />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '12.50' } })
    expect(screen.getByTestId('display').textContent).toBe('12.50')
  })

  it('converts comma to dot on input (fr-FR decimal entry)', () => {
    render(<TestHost />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '12,50' } })
    expect(screen.getByTestId('display').textContent).toBe('12.50')
  })

  it('rejects non-numeric input (regex reject letters)', () => {
    render(<TestHost />)
    const input = screen.getByRole('textbox')
    // Try to inject 'abc' — regex should reject, field.onChange never fires
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.getByTestId('display').textContent).toBe('')
  })

  it('rejects a second decimal separator (regex reject double-dot)', () => {
    render(<TestHost />)
    const input = screen.getByRole('textbox')
    // First valid: '12.5' accepted
    fireEvent.change(input, { target: { value: '12.5' } })
    expect(screen.getByTestId('display').textContent).toBe('12.5')
    // Then attempt to inject a second dot via paste-like change: '12.5.0' rejected
    fireEvent.change(input, { target: { value: '12.5.0' } })
    expect(screen.getByTestId('display').textContent).toBe('12.5')
  })

  it('accepts negative numbers when allowNegative=true', () => {
    render(<TestHost allowNegative={true} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '-50' } })
    expect(screen.getByTestId('display').textContent).toBe('-50')
    // Partial negative entry (just '-') also accepted
    fireEvent.change(input, { target: { value: '-' } })
    expect(screen.getByTestId('display').textContent).toBe('-')
  })

  it('rejects negative numbers when allowNegative=false (default)', () => {
    render(<TestHost />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '-50' } })
    expect(screen.getByTestId('display').textContent).toBe('')
  })

  it('propagates ariaInvalid prop to the input element', () => {
    const { rerender } = render(<TestHost ariaInvalid={true} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')

    rerender(<TestHost ariaInvalid={false} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'false')
  })

  // UX (2026-05-29) — vider le "0" par défaut au focus (sinon "01999").
  it('clears the default 0 on focus', () => {
    render(<TestHost defaultValues={{ amount: 0 }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('0')
    fireEvent.focus(input)
    expect(screen.getByTestId('display').textContent).toBe('')
    expect(input.value).toBe('')
  })

  it('restores 0 on blur when the field was left empty', () => {
    render(<TestHost defaultValues={{ amount: 0 }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input) // clears the 0
    fireEvent.blur(input)
    expect(screen.getByTestId('display').textContent).toBe('0')
  })

  it('does NOT clear a non-zero value on focus (edit mode preserved)', () => {
    render(<TestHost defaultValues={{ amount: 50 }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    expect(input.value).toBe('50')
  })

  it('keeps the typed value on blur (no spurious restore)', () => {
    render(<TestHost defaultValues={{ amount: 0 }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '1999' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('display').textContent).toBe('1999')
  })

  it('displays empty string when field.value is undefined', () => {
    render(<TestHost defaultValues={{}} />)
    // form.getValues('amount') is undefined; component renders value=''
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
    // display span shows the watched undefined value
    expect(screen.getByTestId('display').textContent).toBe('UNDEFINED')
  })
})
