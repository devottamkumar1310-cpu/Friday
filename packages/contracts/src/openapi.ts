import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { z } from './zod';
import { API_PREFIX, API_VERSION, ENDPOINTS, type EndpointDef } from './registry';
import { ERROR_CODES } from './errors';

const ErrorBodySchema = z
  .object({
    error: z.object({
      code: z.enum(Object.values(ERROR_CODES) as [string, ...string[]]),
      message: z.string(),
      details: z
        .array(z.object({ field: z.string().optional(), issue: z.string() }).passthrough())
        .optional(),
      requestId: z.string().uuid(),
      docsUrl: z.string().url(),
      retryable: z.boolean(),
    }),
  })
  .openapi('Error');

/** Responses attached to every operation, so clients see the full surface. */
function commonResponses(authRequired: boolean) {
  const errorContent = { 'application/json': { schema: ErrorBodySchema } };
  return {
    400: { description: 'Malformed request', content: errorContent },
    ...(authRequired
      ? { 401: { description: 'Missing or invalid session', content: errorContent } }
      : {}),
    404: {
      description: 'Not found, or not owned by the caller — deliberately indistinguishable',
      content: errorContent,
    },
    422: { description: 'Valid JSON, failed domain validation', content: errorContent },
    429: { description: 'Rate limited', content: errorContent },
    500: { description: 'Unexpected error', content: errorContent },
  };
}

export function buildOpenApiDocument(): OpenAPIObject {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'friday_session',
    description:
      'Opaque session token. The server stores only a hash, so the raw value is never recoverable from the database.',
  });

  for (const def of Object.values(ENDPOINTS) as EndpointDef[]) {
    registry.registerPath({
      method: def.method.toLowerCase() as Lowercase<EndpointDef['method']>,
      path: def.path,
      summary: def.summary,
      tags: [...def.tags],
      ...(def.auth ? { security: [{ sessionCookie: [] }] } : {}),
      request: def.body
        ? { body: { required: true, content: { 'application/json': { schema: def.body } } } }
        : {},
      responses: {
        [def.status]: {
          description: 'Success',
          content: { 'application/json': { schema: def.response } },
        },
        ...commonResponses(def.auth),
      },
    });
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'FRIDAY API',
      version: API_VERSION,
      description:
        'FRIDAY — an AI Learning Operating System.\n\n' +
        'Clients must ignore unknown response fields and must not exhaustively ' +
        'switch on response enums without a default branch. That contract is what ' +
        'makes additive evolution non-breaking (API_SPECIFICATION §7.2).',
    },
    servers: [
      { url: API_PREFIX, description: 'Same-origin' },
      { url: `https://api.friday.app${API_PREFIX}`, description: 'Production' },
    ],
    tags: [
      { name: 'Auth', description: 'Sign-up, sign-in, sessions' },
      { name: 'Me', description: 'Profile, preferences, consents' },
      { name: 'Goals', description: 'Learning goals' },
      { name: 'Curriculum', description: 'The knowledge graph — concepts and prerequisites' },
      { name: 'Planning', description: 'Plan versions, schedule, feasibility' },
      { name: 'NextAction', description: 'The deterministic priority engine, on the hot path' },
      { name: 'Execution', description: 'Sessions and evidence' },
      { name: 'MissionControl', description: "Today's Mission, Next Action, Progress, Risks" },
      { name: 'Intelligence', description: 'Progress, weak concepts, trends, insights' },
      { name: 'Assessment', description: 'Practice sets, grading, question bank' },
      { name: 'Coach', description: 'Conversational coaching over real learner state' },
      { name: 'Memory', description: 'Mastery, due reviews, and reflective beliefs' },
    ],
  });
}
