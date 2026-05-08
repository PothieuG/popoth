import type { NextRequest, NextResponse } from 'next/server'

type RouteHandler = (request: NextRequest) => Promise<NextResponse>

export function withDeprecation<H extends RouteHandler>(handler: H): H {
  const wrapped = (async (request: NextRequest) => {
    const response = await handler(request)
    response.headers.set('Deprecation', 'true')
    return response
  }) as H
  return wrapped
}
