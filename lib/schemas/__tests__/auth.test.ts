import { describe, it, expect } from 'vitest'
import { signupBodySchema } from '@/lib/schemas/auth'

describe('signupBodySchema', () => {
  it('accepts a valid signup body', () => {
    const result = signupBodySchema.safeParse({
      email: 'test@example.com',
      password: 'secret123',
      confirmPassword: 'secret123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects password/confirmPassword mismatch on the confirmPassword path', () => {
    const result = signupBodySchema.safeParse({
      email: 'test@example.com',
      password: 'secret123',
      confirmPassword: 'different',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const mismatch = result.error.issues.find((i) => i.path.join('.') === 'confirmPassword')
      expect(mismatch).toBeDefined()
      expect(mismatch?.message).toBe('Les mots de passe ne correspondent pas')
    }
  })

  it('rejects passwords shorter than 6 characters', () => {
    const result = signupBodySchema.safeParse({
      email: 'test@example.com',
      password: 'abc',
      confirmPassword: 'abc',
    })
    expect(result.success).toBe(false)
  })
})
