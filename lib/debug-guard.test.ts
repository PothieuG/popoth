import { afterEach, describe, expect, it, vi } from 'vitest'
import { blockInProduction } from './debug-guard'

describe('blockInProduction', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns a 404 response when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = blockInProduction()
    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  it('returns null when NODE_ENV is development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(blockInProduction()).toBeNull()
  })

  it('returns null when NODE_ENV is test', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(blockInProduction()).toBeNull()
  })

  it('returns null when NODE_ENV is undefined', () => {
    vi.stubEnv('NODE_ENV', undefined)
    expect(blockInProduction()).toBeNull()
  })
})
