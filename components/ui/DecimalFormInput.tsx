'use client'

import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface DecimalFormInputProps<T extends FieldValues> {
  control: Control<T>
  name: FieldPath<T>
  id?: string
  placeholder?: string
  disabled?: boolean
  ariaInvalid?: boolean
  ariaDescribedby?: string
  allowNegative?: boolean
  className?: string
  autoComplete?: string
}

/**
 * Décimal input controlled by react-hook-form for forms validated via
 * z.coerce.number() schemas (Sprint Zod-Rollout v4 / Axe 2).
 *
 * Centralizes the Controller + regex + comma→dot pattern that was
 * duplicated across 8 sites (~17 LOC each). Consumer-side wrapping is
 * preserved (suffix `€` via parent `<div className="relative">` + span ;
 * focus colors via `className` prop merged with shadcn defaults).
 *
 * - `allowNegative` opts into `^-?\d*[.,]?\d*$` (e.g. EditBalanceModal).
 * - The value is kept as a raw string while typing so partial entries
 *   like `-` or `-1.` are accepted ; zodResolver runs z.coerce.number()
 *   at submit time.
 */
export function DecimalFormInput<T extends FieldValues>({
  control,
  name,
  id,
  placeholder = '0.00',
  disabled,
  ariaInvalid,
  ariaDescribedby,
  allowNegative = false,
  className,
  autoComplete,
}: DecimalFormInputProps<T>) {
  const regex = allowNegative ? /^-?\d*[.,]?\d*$/ : /^\d*[.,]?\d*$/
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input
          id={id}
          ref={field.ref}
          type="text"
          inputMode="decimal"
          value={field.value == null ? '' : String(field.value)}
          onChange={(e) => {
            const v = e.target.value
            if (v === '' || regex.test(v)) {
              field.onChange(v.replace(',', '.'))
            }
          }}
          onFocus={() => {
            // UX (2026-05-29) : si le champ vaut exactement "0" (valeur par
            // défaut), on le vide au focus pour que la frappe parte d'un champ
            // propre (sinon taper "1999" donnait "01999"). On ne touche pas aux
            // valeurs non-nulles (mode édition : "50" reste éditable). Champ
            // contrôlé → field.onChange('') suffit à vider l'affichage.
            if (String(field.value ?? '') === '0') {
              field.onChange('')
            }
          }}
          onBlur={(e) => {
            // Restaure "0" si l'utilisateur quitte le champ sans rien saisir —
            // garde l'affichage par défaut cohérent (pas de champ vide orphelin).
            if (e.target.value === '') {
              field.onChange(0)
            }
            field.onBlur()
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid ? 'true' : 'false'}
          aria-describedby={ariaDescribedby}
          className={cn(className)}
          autoComplete={autoComplete}
        />
      )}
    />
  )
}
