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
  // Sprint 07: body shape is `{ context }` only. The server computes the
  // per-budget proportional allocation via computeProportionalSavingsRefloat.
  it('accepts context=profile alone', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group alone', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(refloatFromSavingsBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context value', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'household' }).success).toBe(false)
  })

  it('silently ignores extra keys (e.g. legacy amount payload from older clients)', () => {
    expect(refloatFromSavingsBodySchema.safeParse({ context: 'profile', amount: 50 }).success).toBe(
      true,
    )
  })
})

describe('saveBudgetSnapshotBodySchema', () => {
  // Sprint 07: body shape is `{ context }` only. The server computes the
  // per-budget proportional allocation via computeProportionalBudgetSnapshot
  // and overwrites the `monthly_recaps.budget_snapshot_data` JSONB.
  it('accepts context=profile alone', () => {
    expect(saveBudgetSnapshotBodySchema.safeParse({ context: 'profile' }).success).toBe(true)
  })

  it('accepts context=group alone', () => {
    expect(saveBudgetSnapshotBodySchema.safeParse({ context: 'group' }).success).toBe(true)
  })

  it('rejects missing context', () => {
    expect(saveBudgetSnapshotBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects invalid context value', () => {
    expect(saveBudgetSnapshotBodySchema.safeParse({ context: 'family' }).success).toBe(false)
  })

  it('silently ignores extra keys (e.g. legacy snapshot payload from older clients)', () => {
    expect(
      saveBudgetSnapshotBodySchema.safeParse({
        context: 'profile',
        snapshot: { [uuid()]: 50 },
      }).success,
    ).toBe(true)
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
