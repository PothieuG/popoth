import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { parseBody, BadRequestError, handleBadRequest } from '@/lib/api/parse-body'

function makeRequest(body: string | object): NextRequest {
  const url = 'http://localhost/api/test'
  const init: RequestInit =
    typeof body === 'string'
      ? { method: 'POST', body, headers: { 'content-type': 'application/json' } }
      : {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }
  return new Request(url, init) as unknown as NextRequest
}

const schema = z.object({
  context: z.enum(['profile', 'group']),
})

describe('parseBody', () => {
  it('returns parsed data on a valid body', async () => {
    const req = makeRequest({ context: 'profile' })
    const result = await parseBody(req, schema)
    expect(result).toStrictEqual({ context: 'profile' })
  })

  it('throws BadRequestError on malformed JSON', async () => {
    const req = makeRequest('{not valid json')
    await expect(parseBody(req, schema)).rejects.toBeInstanceOf(BadRequestError)
  })

  it('throws BadRequestError with issues on schema mismatch', async () => {
    const req = makeRequest({ context: 'invalid' })
    let caught: unknown
    try {
      await parseBody(req, schema)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BadRequestError)
    const err = caught as BadRequestError
    expect(err.code).toBe('BAD_REQUEST_BODY')
    expect(err.issues).toBeDefined()
    expect(err.issues?.length ?? 0).toBeGreaterThan(0)
  })

  it('throws BadRequestError on missing required field', async () => {
    const req = makeRequest({})
    await expect(parseBody(req, schema)).rejects.toBeInstanceOf(BadRequestError)
  })
})

describe('handleBadRequest', () => {
  it('returns 400 NextResponse with error + issues when given a BadRequestError', async () => {
    const err = new BadRequestError('test message', [
      { code: 'custom', message: 'custom issue', path: ['context'] } as never,
    ])
    const response = handleBadRequest(err)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(400)
    const body = (await response!.json()) as { error: string; issues: unknown[] }
    expect(body.error).toBe('test message')
    expect(body.issues).toHaveLength(1)
  })

  it('returns null for non-BadRequest errors', () => {
    expect(handleBadRequest(new Error('something else'))).toBeNull()
    expect(handleBadRequest('plain string')).toBeNull()
    expect(handleBadRequest(null)).toBeNull()
  })
})
