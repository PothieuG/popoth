import { NextResponse, type NextRequest } from 'next/server'
import type { ZodIssue, ZodType } from 'zod'

/**
 * Thrown by `parseBody` when the request body is malformed JSON or fails Zod
 * validation. The caller's `try/catch` should funnel this through
 * `handleBadRequest(error)` to convert it into a 400 NextResponse.
 */
export class BadRequestError extends Error {
  readonly code = 'BAD_REQUEST_BODY' as const

  constructor(
    message: string,
    public readonly issues?: ZodIssue[],
  ) {
    super(message)
    this.name = 'BadRequestError'
  }
}

/**
 * Read JSON from `request` and validate it against `schema`. Returns the
 * parsed, typed body on success. Throws `BadRequestError` on malformed JSON
 * or schema mismatch — let the route's outer `try/catch` funnel it through
 * `handleBadRequest(error)`.
 */
export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new BadRequestError('Body invalide (JSON malformé)')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new BadRequestError('Body invalide', result.error.issues)
  }
  return result.data
}

/**
 * If `error` is a `BadRequestError`, returns a 400 `NextResponse` with
 * `{ error, issues }`. Otherwise returns `null` so the caller's outer catch
 * can fall through to its 500 path.
 */
export function handleBadRequest(error: unknown): NextResponse | null {
  if (error instanceof BadRequestError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 })
  }
  return null
}
