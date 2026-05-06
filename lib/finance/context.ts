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
