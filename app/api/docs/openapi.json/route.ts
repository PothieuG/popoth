import { NextResponse } from 'next/server'

import { generateOpenAPI } from '@/lib/openapi/generate'

/**
 * GET /api/docs/openapi.json — serve the OpenAPI 3.1 document.
 *
 * Public (no auth) so that browser-based Swagger UI clients and offline
 * tools (Postman import, Insomnia, openapi-typescript) can fetch it.
 * The schemas it documents are inferable from the public repo anyway.
 */
export function GET() {
  const doc = generateOpenAPI()
  return NextResponse.json(doc, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    },
  })
}
