export type ContextFilter =
  | { profile_id: string; group_id?: never }
  | { group_id: string; profile_id?: never }

export type ContextIds = {
  profile_id: string | null
  group_id: string | null
}

export function resolveContextIds(filter: ContextFilter): ContextIds {
  if ('profile_id' in filter && filter.profile_id) {
    return { profile_id: filter.profile_id, group_id: null }
  }
  if ('group_id' in filter && filter.group_id) {
    return { profile_id: null, group_id: filter.group_id }
  }
  throw new Error('ContextFilter must contain either profile_id or group_id')
}

/**
 * Narrows a loose `{ profile_id?, group_id? }` shape to a typed ContextFilter.
 * Used at the boundary between callers that build filters dynamically (e.g.
 * from a row's nullable owner columns) and helpers that require the strict
 * discriminated union. group_id wins when both are present, matching the
 * priority used by the expense-allocation callers.
 */
export function asContextFilter(filter: {
  profile_id?: string | null
  group_id?: string | null
}): ContextFilter {
  if (filter.group_id) return { group_id: filter.group_id }
  if (filter.profile_id) return { profile_id: filter.profile_id }
  throw new Error('Filter must contain either profile_id or group_id')
}
