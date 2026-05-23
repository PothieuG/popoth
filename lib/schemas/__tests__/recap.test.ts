import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  completeRecapBodySchema,
  refloatFromPiggyBodySchema,
  refloatFromSavingsBodySchema,
  saveBudgetSnapshotBodySchema,
  startRecapBodySchema,
  statusQuerySchema,
  transferSurplusesBodySchema,
  updateSalariesBodySchema,
} from '@/lib/schemas/recap'

const uuid = () => randomUUID()

describe('startRecapBodySchema', () => {
  it('accepts context=profile', () => {
    expect(startRecapBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(startRecapBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(startRecapBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context enum value', () => {
    expect(startRecapBodySchema.safeParse({ context: 'household' }).success).toBe(false)
  })

  it('rejects non-string context', () => {
    expect(startRecapBodySchema.safeParse({ context: 42 }).success).toBe(false)
  })
})

describe('transferSurplusesBodySchema', () => {
  it('accepts a single-element budgetIds list', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: [uuid()] }).success,
    ).toBe(true)
  })

  it('accepts multiple uuids', () => {
    expect(
      transferSurplusesBodySchema.safeParse({
        context: 'group',
        budgetIds: [uuid(), uuid(), uuid()],
      }).success,
    ).toBe(true)
  })

  it('rejects empty budgetIds (min(1))', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: [] }).success,
    ).toBe(false)
  })

  it('rejects non-uuid string in budgetIds', () => {
    expect(
      transferSurplusesBodySchema.safeParse({ context: 'profile', budgetIds: ['not-uuid'] })
        .success,
    ).toBe(false)
  })

  it('rejects missing context', () => {
    expect(transferSurplusesBodySchema.safeParse({ budgetIds: [uuid()] }).success).toBe(false)
  })
})

describe('refloatFromPiggyBodySchema', () => {
  it('accepts a positive 2-decimal amount', () => {
    expect(refloatFromPiggyBodySchema.safeParse({ context: 'profile', amount: 12.5 }).success).toBe(
      true,
    )
  })

  it('rejects zero amount (must be strictly positive)', () => {
    expect(refloatFromPiggyBodySchema.safeParse({ context: 'profile', amount: 0 }).success).toBe(
      false,
    )
  })

  it('rejects negative amount', () => {
    expect(refloatFromPiggyBodySchema.safeParse({ context: 'profile', amount: -1 }).success).toBe(
      false,
    )
  })

  it('rejects 3-decimal precision', () => {
    expect(
      refloatFromPiggyBodySchema.safeParse({ context: 'profile', amount: 1.234 }).success,
    ).toBe(false)
  })

  it('rejects NaN and Infinity', () => {
    expect(
      refloatFromPiggyBodySchema.safeParse({ context: 'profile', amount: Number.NaN }).success,
    ).toBe(false)
    expect(
      refloatFromPiggyBodySchema.safeParse({
        context: 'profile',
        amount: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false)
  })
})

describe('refloatFromSavingsBodySchema', () => {
  it('accepts a positive 2-decimal amount in group context', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'group', amount: 250 }).success).toBe(
      true,
    )
  })

  it('rejects zero amount', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'group', amount: 0 }).success).toBe(
      false,
    )
  })

  it('rejects negative amount', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'group', amount: -50 }).success).toBe(
      false,
    )
  })

  it('rejects missing amount', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'group' }).success).toBe(false)
  })

  it('rejects 3-decimal precision', () => {
    expect(
      refloatFromSavingsBodySchema.safeParse({ context: 'group', amount: 0.001 }).success,
    ).toBe(false)
  })
})

describe('saveBudgetSnapshotBodySchema', () => {
  it('accepts an empty snapshot record', () => {
    expect(
      saveBudgetSnapshotBodySchema.safeParse({ context: 'profile', snapshot: {} }).success,
    ).toBe(true)
  })

  it('accepts a record of uuid → non-negative money', () => {
    const id1 = uuid()
    const id2 = uuid()
    expect(
      saveBudgetSnapshotBodySchema.safeParse({
        context: 'group',
        snapshot: { [id1]: 100, [id2]: 0 },
      }).success,
    ).toBe(true)
  })

  it('rejects a non-uuid key', () => {
    const result = saveBudgetSnapshotBodySchema.safeParse({
      context: 'profile',
      snapshot: { 'not-a-uuid': 100 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a negative amount in the snapshot map', () => {
    expect(
      saveBudgetSnapshotBodySchema.safeParse({
        context: 'profile',
        snapshot: { [uuid()]: -10 },
      }).success,
    ).toBe(false)
  })

  it('rejects missing snapshot', () => {
    expect(saveBudgetSnapshotBodySchema.safeParse({ context: 'profile' }).success).toBe(false)
  })
})

describe('updateSalariesBodySchema', () => {
  it('accepts one salary entry', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 2500 }],
      }).success,
    ).toBe(true)
  })

  it('accepts a salary of zero', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 0 }],
      }).success,
    ).toBe(true)
  })

  it('rejects empty salaries array', () => {
    expect(updateSalariesBodySchema.safeParse({ context: 'group', salaries: [] }).success).toBe(
      false,
    )
  })

  it('rejects negative salary', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: -100 }],
      }).success,
    ).toBe(false)
  })

  it('rejects non-uuid profileId', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: 'bob', salary: 1000 }],
      }).success,
    ).toBe(false)
  })

  it('rejects 3-decimal salary', () => {
    expect(
      updateSalariesBodySchema.safeParse({
        context: 'group',
        salaries: [{ profileId: uuid(), salary: 1000.555 }],
      }).success,
    ).toBe(false)
  })
})

describe('completeRecapBodySchema', () => {
  it('accepts context=profile', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(completeRecapBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context value', () => {
    expect(completeRecapBodySchema.safeParse({ context: 'family' }).success).toBe(false)
  })

  it('rejects null context', () => {
    expect(completeRecapBodySchema.safeParse({ context: null }).success).toBe(false)
  })
})

describe('statusQuerySchema', () => {
  it('accepts context=profile', () => {
    expect(statusQuerySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group', () => {
    expect(statusQuerySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context (required)', () => {
    expect(statusQuerySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context enum', () => {
    expect(statusQuerySchema.safeParse({ context: 'PROFILE' }).success).toBe(false)
  })

  it('rejects array context', () => {
    expect(statusQuerySchema.safeParse({ context: ['profile'] }).success).toBe(false)
  })
})
