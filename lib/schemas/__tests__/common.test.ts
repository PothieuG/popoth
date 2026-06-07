import { describe, it, expect } from 'vitest'
import {
  contextOnlyQuerySchema,
  deleteByIdQuerySchema,
  estimatedListQuerySchema,
  hasAtMostTwoDecimals,
  moneyFormSchema,
  moneySchema,
  summaryQuerySchema,
} from '@/lib/schemas/common'

describe('moneySchema', () => {
  it('accepts a positive amount with up to 2 decimals', () => {
    expect(moneySchema.safeParse(42.99).success).toBe(true)
    expect(moneySchema.safeParse(0.01).success).toBe(true)
    expect(moneySchema.safeParse(1000).success).toBe(true)
  })

  it('rejects negative and zero amounts', () => {
    expect(moneySchema.safeParse(-1).success).toBe(false)
    expect(moneySchema.safeParse(0).success).toBe(false)
  })

  it('rejects NaN and Infinity', () => {
    expect(moneySchema.safeParse(Number.NaN).success).toBe(false)
    expect(moneySchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(moneySchema.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false)
  })

  it('rejects more than 2 decimals', () => {
    expect(moneySchema.safeParse(0.001).success).toBe(false)
    expect(moneySchema.safeParse(1.234).success).toBe(false)
  })
})

describe('hasAtMostTwoDecimals (régression précision flottante IEEE-754)', () => {
  // Valeurs du bug rapporté 2026-06-07 : l'ancien check Math.round(v*100)===v*100
  // rejetait 16.4 / 16.42 mais acceptait 16.41 / 16.43 selon la représentation
  // binaire — incohérent. Le helper toFixed-based les accepte toutes.
  it('accepte les montants 2-décimales quelle que soit la représentation binaire', () => {
    for (const v of [16.4, 16.41, 16.42, 16.43, 0.1, 0.2, 0.3, 1.1, 2.2, 1234.56, 999999.99]) {
      expect(hasAtMostTwoDecimals(v)).toBe(true)
    }
  })

  it('rejette les montants à plus de 2 décimales', () => {
    for (const v of [16.401, 16.999, 16.005, 2.675, 0.001, 1.234]) {
      expect(hasAtMostTwoDecimals(v)).toBe(false)
    }
  })

  it('rejette les valeurs non finies', () => {
    expect(hasAtMostTwoDecimals(Number.NaN)).toBe(false)
    expect(hasAtMostTwoDecimals(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('moneyFormSchema (régression coercion décimale des forms client)', () => {
  // Le bug se manifestait surtout via moneyFormSchema (forms : ajout dépense /
  // budget / revenu, solde settings) qui coerce string→number au submit.
  it('accepte les montants 2-décimales qui échouaient avant (16.4, 16.40, 16.42)', () => {
    expect(moneyFormSchema.safeParse(16.4).success).toBe(true)
    expect(moneyFormSchema.safeParse('16.40').success).toBe(true)
    expect(moneyFormSchema.safeParse('16.42').success).toBe(true)
    expect(moneyFormSchema.safeParse('999999.99').success).toBe(true)
  })

  it('rejette toujours plus de 2 décimales avec le bon message', () => {
    const result = moneyFormSchema.safeParse('16.401')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === 'Au maximum 2 décimales')).toBe(true)
    }
  })
})

describe('contextOnlyQuerySchema', () => {
  it('defaults to profile when context is absent', () => {
    const result = contextOnlyQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('profile')
  })

  it('accepts group as context value', () => {
    const result = contextOnlyQuerySchema.safeParse({ context: 'group' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.context).toBe('group')
  })
})

describe('estimatedListQuerySchema', () => {
  it('coerces group="true" to boolean true', () => {
    const result = estimatedListQuerySchema.safeParse({ group: 'true' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.group).toBe(true)
  })

  it('coerces group="false" or absent to boolean false', () => {
    const r1 = estimatedListQuerySchema.safeParse({ group: 'false' })
    const r2 = estimatedListQuerySchema.safeParse({})
    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    if (r1.success) expect(r1.data.group).toBe(false)
    if (r2.success) expect(r2.data.group).toBe(false)
  })
})

describe('deleteByIdQuerySchema', () => {
  it('accepts a valid uuid', () => {
    const result = deleteByIdQuerySchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.success).toBe(true)
  })

  it('rejects malformed uuid or missing id', () => {
    expect(deleteByIdQuerySchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
    expect(deleteByIdQuerySchema.safeParse({}).success).toBe(false)
  })
})

describe('summaryQuerySchema', () => {
  it('defaults: context=profile, recalculate=false', () => {
    const result = summaryQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.context).toBe('profile')
      expect(result.data.recalculate).toBe(false)
    }
  })

  it('coerces recalculate="true" to boolean true', () => {
    const result = summaryQuerySchema.safeParse({ context: 'group', recalculate: 'true' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.recalculate).toBe(true)
  })
})
