import { z, type ZodType } from 'zod'

import { type RouteDef, routes } from './registry'

/**
 * Generate the OpenAPI 3.1.0 document from the registry.
 *
 * Why 3.1 and not 3.0: OpenAPI 3.1 uses JSON Schema 2020-12 natively, which
 * is exactly what `z.toJSONSchema()` produces in Zod 4. Targeting 3.0 would
 * require lossy transforms (`exclusiveMinimum: 0` → `minimum: 0 + exclusiveMinimum: true`,
 * etc.).
 *
 * Limitations preserved verbatim from `z.toJSONSchema`:
 * - `.refine(...)` is dropped (custom predicates aren't representable in JSON Schema).
 *   The error message stays embedded in the Zod schema for runtime use; doc readers
 *   see only the structural shape (e.g. `transferSavingsBodySchema.refine` for
 *   same-id rejection is documented in the route summary instead).
 * - `.transform(...)` outputs `{}` (any) — we pass `{ unrepresentable: 'any' }`
 *   to make this explicit rather than throw.
 *
 * Response bodies are stubbed with generic shapes (`{ data?: ... }` for 2xx,
 * `{ error: string, issues?: [] }` for 4xx). Documenting per-route response
 * schemas would require auditing 39 handlers — out of scope for this sprint.
 */
const VERSION = '0.1.0'

interface OpenAPIDocument {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    description: string
  }
  servers: Array<{ url: string; description?: string }>
  tags: Array<{ name: string; description?: string }>
  paths: Record<string, Record<string, unknown>>
  components: {
    securitySchemes: Record<string, unknown>
    schemas?: Record<string, unknown>
  }
  security: Array<Record<string, string[]>>
}

let cached: OpenAPIDocument | null = null

export function generateOpenAPI(): OpenAPIDocument {
  if (cached) return cached
  cached = buildDocument()
  return cached
}

function buildDocument(): OpenAPIDocument {
  const tags = new Map<string, { name: string }>()
  const paths: Record<string, Record<string, unknown>> = {}

  for (const route of routes) {
    tags.set(route.tag, { name: route.tag })

    const operation = buildOperation(route)
    const pathItem = (paths[route.path] ??= {})
    pathItem[route.method] = operation
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Popoth API',
      version: VERSION,
      description:
        'PWA francophone de gestion financière personnelle et en groupe.\n\n' +
        'Tous les endpoints (sauf `POST /api/auth/session` action `login`) ' +
        'requièrent un cookie `session` (JWT signé via jose). 401 si absent ou expiré, ' +
        '404 si profil non trouvé pour les routes wrappées en `withAuthAndProfile`.\n\n' +
        'Format réponse standard : `{ data: T }` (2xx) ou `{ error: string, issues?: ZodIssue[] }` (4xx/5xx).\n\n' +
        'Sources : schemas Zod dans `lib/schemas/**`, registry dans `lib/openapi/registry.ts`. ' +
        'Doc générée automatiquement par `lib/openapi/generate.ts` (z.toJSONSchema natif Zod 4).',
    },
    servers: [{ url: '/', description: 'Current host' }],
    tags: Array.from(tags.values()).sort((a, b) => a.name.localeCompare(b.name)),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
          description: 'JWT cookie set by `POST /api/auth/session` (action: `login`).',
        },
      },
    },
    security: [{ sessionCookie: [] }],
  }
}

function buildOperation(route: RouteDef): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: route.summary,
    tags: [route.tag],
  }

  // Auth: opt-out for the login route (it sets the cookie).
  if (route.requiresAuth === false) {
    op.security = []
  }

  const parameters: unknown[] = []

  if (route.pathParams) {
    for (const name of route.pathParams) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      })
    }
  }

  if (route.querySchema) {
    parameters.push(...buildQueryParameters(route.querySchema))
  }

  if (parameters.length > 0) {
    op.parameters = parameters
  }

  if (route.bodySchema) {
    op.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: zodToJsonSchema(route.bodySchema),
        },
      },
    }
  }

  op.responses = buildResponses(route)

  return op
}

function buildQueryParameters(querySchema: ZodType): unknown[] {
  const json = zodToJsonSchema(querySchema)
  if (!isObjectSchema(json)) return []

  const required = new Set<string>(Array.isArray(json.required) ? json.required : [])
  const props = (json.properties ?? {}) as Record<string, Record<string, unknown>>

  return Object.entries(props).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema,
  }))
}

function buildResponses(route: RouteDef): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    '200': {
      description: 'Success — `{ data: ... }` or domain-specific shape (cf. handler).',
      content: {
        'application/json': {
          schema: { type: 'object' },
        },
      },
    },
    '500': {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: errorSchema(),
        },
      },
    },
  }

  if (route.bodySchema || route.querySchema || route.pathParams) {
    responses['400'] = {
      description:
        'Bad request — body/query/param failed Zod validation. `issues` lists ZodIssue paths.',
      content: {
        'application/json': {
          schema: errorWithIssuesSchema(),
        },
      },
    }
  }

  if (route.requiresAuth !== false) {
    responses['401'] = {
      description: 'Session invalide — missing or expired `session` cookie.',
      content: {
        'application/json': {
          schema: errorSchema(),
        },
      },
    }
  }

  return responses
}

function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' })
  // Strip the $schema header — OpenAPI components/schema don't carry it.
  const { $schema: _, ...rest } = json as Record<string, unknown>
  return rest
}

function isObjectSchema(
  json: Record<string, unknown>,
): json is Record<string, unknown> & { properties?: Record<string, unknown>; required?: string[] } {
  return json.type === 'object'
}

function errorSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: { error: { type: 'string' } },
    required: ['error'],
  }
}

function errorWithIssuesSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      error: { type: 'string' },
      issues: {
        type: 'array',
        items: { type: 'object' },
        description: 'ZodIssue[] — see https://zod.dev/?id=zoderror',
      },
    },
    required: ['error'],
  }
}
