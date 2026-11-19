import { describe, expect, it } from 'vitest';
import { buildOpenApi, HTTP_STATUS } from '@/agent/openapi';
import { ERROR_CODES, OPERATIONS } from '@/agent/catalog';

describe('OpenAPI document', () => {
  const doc = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, any>>; components: any };

  it('is OpenAPI 3.1 with bearer auth and one path per operation', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components.securitySchemes.bearer.scheme).toBe('bearer');
    for (const op of OPERATIONS) {
      const path = doc.paths[`/api/v1/ops/${op.name}`];
      expect(path?.post?.operationId).toBe(op.name);
      expect(path.post.requestBody.content['application/json'].schema).toEqual(op.input);
      expect(Boolean(path.get)).toBe(op.kind === 'read');
    }
  });

  it('maps every error code to an HTTP status', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(HTTP_STATUS[code as keyof typeof HTTP_STATUS]).toBeGreaterThanOrEqual(400);
  });
});
