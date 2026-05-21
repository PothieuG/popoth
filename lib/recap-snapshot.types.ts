import type { Tables } from '@/lib/database.types'

export interface SnapshotPayloadV1 {
  snapshot_version?: 1
  context?: 'profile' | 'group'
  estimated_incomes: Tables<'estimated_incomes'>[]
  estimated_budgets: Tables<'estimated_budgets'>[]
  real_income_entries: Tables<'real_income_entries'>[]
  real_expenses: Tables<'real_expenses'>[]
  bank_balance: number
}

export interface SnapshotPayloadV2 {
  snapshot_version: 2
  context: 'profile' | 'group'
  created_at: string
  profiles: Tables<'profiles'>[]
  estimated_incomes: Tables<'estimated_incomes'>[]
  estimated_budgets: Tables<'estimated_budgets'>[]
  real_income_entries: Tables<'real_income_entries'>[]
  real_expenses: Tables<'real_expenses'>[]
  bank_balances: Tables<'bank_balances'>[]
  bank_balance: number | null
  piggy_bank: Tables<'piggy_bank'>[]
  remaining_to_live_snapshots: Tables<'remaining_to_live_snapshots'>[]
  budget_transfers: Tables<'budget_transfers'>[]
  monthly_recaps: Tables<'monthly_recaps'>[]
  _warnings?: string[]
  _table_counts: Record<string, number>
  groups?: Tables<'groups'>[]
  group_contributions?: Tables<'group_contributions'>[]
}

export type SnapshotPayload = SnapshotPayloadV1 | SnapshotPayloadV2

export function isSnapshotV2(s: SnapshotPayload): s is SnapshotPayloadV2 {
  return s.snapshot_version === 2
}
