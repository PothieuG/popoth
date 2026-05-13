import { describe, it, expect } from 'vitest'
import { loginFormSchema, sessionActionBodySchema, signupBodySchema } from '@/lib/schemas/auth'

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

describe('loginFormSchema', () => {
  it('accepts valid email + password', () => {
    expect(
      loginFormSchema.safeParse({ email: 'test@example.com', password: 'secret123' }).success,
    ).toBe(true)
  })

  it('rejects malformed email and short password', () => {
    expect(loginFormSchema.safeParse({ email: 'not-an-email', password: 'secret123' }).success).toBe(
      false,
    )
    expect(loginFormSchema.safeParse({ email: 'test@example.com', password: 'abc' }).success).toBe(
      false,
    )
  })
})

describe('sessionActionBodySchema', () => {
  it('accepts login action with valid credentials', () => {
    const result = sessionActionBodySchema.safeParse({
      action: 'login',
      email: 'test@example.com',
      password: 'secret123',
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.action === 'login') {
      expect(result.data.email).toBe('test@example.com')
    }
  })

  it('accepts refresh and logout actions without extra fields', () => {
    expect(sessionActionBodySchema.safeParse({ action: 'refresh' }).success).toBe(true)
    expect(sessionActionBodySchema.safeParse({ action: 'logout' }).success).toBe(true)
  })

  it('rejects login missing email or password', () => {
    expect(
      sessionActionBodySchema.safeParse({ action: 'login', password: 'secret123' }).success,
    ).toBe(false)
    expect(sessionActionBodySchema.safeParse({ action: 'login', email: 'x@y.z' }).success).toBe(
      false,
    )
  })

  it('rejects unknown action discriminator', () => {
    expect(sessionActionBodySchema.safeParse({ action: 'foo' }).success).toBe(false)
    expect(sessionActionBodySchema.safeParse({}).success).toBe(false)
  })
})
