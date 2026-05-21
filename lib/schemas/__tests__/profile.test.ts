import { describe, it, expect } from 'vitest'
import { createProfileBodySchema, updateProfileBodySchema } from '@/lib/schemas/profile'

describe('createProfileBodySchema', () => {
  it('accepts a valid create body with all fields', () => {
    const result = createProfileBodySchema.safeParse({
      first_name: 'Alice',
      last_name: 'Doe',
      salary: 2500,
      avatar_url: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects salary above the 999999.99 cap', () => {
    const result = createProfileBodySchema.safeParse({
      first_name: 'Alice',
      last_name: 'Doe',
      salary: 1000000,
    })
    expect(result.success).toBe(false)
  })
})

describe('updateProfileBodySchema', () => {
  it('rejects an empty body (refine: at least one field required)', () => {
    const result = updateProfileBodySchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      const refineIssue = result.error.issues.find((i) =>
        i.message.includes('Aucune donnée à mettre à jour'),
      )
      expect(refineIssue).toBeDefined()
    }
  })
})
