import { describe, expect, it } from 'vitest';
import { makeEnvelope, makeManifest, parseEnvelope, parseManifest, serializeEnvelope } from '../envelope';

describe('storage envelope', () => {
  it('round-trips records through serialize/parse', () => {
    const records = [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }];
    const text = serializeEnvelope(makeEnvelope('tasks', records, 3, 1234));

    const result = parseEnvelope<{ id: string; title: string }>(text, 'tasks');

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.envelope).toMatchObject({
      format: 'lifeos-collection',
      collection: 'tasks',
      schemaVersion: 3,
      savedAt: 1234,
    });
    expect(result.envelope?.records).toEqual(records);
  });

  it('treats an absent or empty file as "not there yet", not as corruption', () => {
    for (const input of [null, '', '   ']) {
      const result = parseEnvelope(input, 'tasks');
      expect(result.ok).toBe(false);
      expect(result.envelope).toBeNull();
      expect(result.error).toBeNull();
    }
  });

  it('accepts a bare array, so a hand-written file still loads', () => {
    const result = parseEnvelope('[{"id":"x"}]', 'goals');
    expect(result.ok).toBe(true);
    expect(result.envelope?.records).toEqual([{ id: 'x' }]);
    expect(result.envelope?.collection).toBe('goals');
  });

  it('reports truncated JSON with a readable error rather than throwing', () => {
    const result = parseEnvelope('{"format":"lifeos-collection","records":[{"id":', 'tasks');
    expect(result.ok).toBe(false);
    expect(result.envelope).toBeNull();
    expect(result.error).toMatch(/not valid JSON/i);
    expect(result.error).toContain('tasks');
  });

  it('refuses an unrelated JSON object', () => {
    const result = parseEnvelope('{"hello":"world"}', 'tasks');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a LifeOS collection file/);
  });

  it('refuses an envelope whose records are missing', () => {
    const result = parseEnvelope('{"format":"lifeos-collection","schemaVersion":3}', 'tasks');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no "records" array/);
  });

  it('defaults a header-less envelope to schema v1 so migrations still run', () => {
    const result = parseEnvelope('{"format":"lifeos-collection","records":[]}', 'blocks');
    expect(result.ok).toBe(true);
    expect(result.envelope?.schemaVersion).toBe(1);
  });
});

describe('storage manifest', () => {
  it('round-trips counts and the writing adapter', () => {
    const manifest = makeManifest({ tasks: 12, goals: 3 }, 'http', 999);
    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed).toMatchObject({
      format: 'lifeos-manifest',
      counts: { tasks: 12, goals: 3 },
      writtenBy: 'http',
      savedAt: 999,
    });
  });

  it('returns null for junk rather than throwing', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('not json')).toBeNull();
    expect(parseManifest('{"format":"something-else"}')).toBeNull();
  });
});
