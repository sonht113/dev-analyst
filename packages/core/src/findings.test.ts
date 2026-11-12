import { describe, expect, it } from 'vitest';
import { findingSchema, sourceReferenceSchema } from './findings.js';

const finding = {
  id: 'e29c1083-16a7-4c3c-b3e9-4ab81b5477e5',
  type: 'event-handler',
  explanation: 'A click handler is declared on the button; runtime execution is not established.',
  confidence: 'VERIFIED',
  evidence: {
    source: { file: 'src/Button.tsx', start: { line: 4, column: 3 }, end: null },
    code: '<button onClick={save}>Save</button>',
  },
  analyzedAt: '2026-11-12T04:00:00.000Z',
  cacheStatus: 'miss',
};

describe('evidence-first findings', () => {
  it('accepts explicit source evidence', () => {
    expect(findingSchema.parse(finding)).toEqual(finding);
  });

  it.each(['VERIFIED', 'INFERRED'])('rejects %s without evidence', (confidence) => {
    expect(findingSchema.safeParse({ ...finding, confidence, evidence: null }).success).toBe(false);
  });

  it('represents missing evidence as UNKNOWN without inventing source data', () => {
    expect(
      findingSchema.parse({ ...finding, confidence: 'UNKNOWN', evidence: null }).evidence,
    ).toBeNull();
  });

  it('rejects stale verified findings and accepts labeled stale inferred findings', () => {
    expect(findingSchema.safeParse({ ...finding, cacheStatus: 'stale' }).success).toBe(false);
    expect(
      findingSchema.safeParse({ ...finding, confidence: 'INFERRED', cacheStatus: 'stale' }).success,
    ).toBe(true);
  });

  it('accepts an unavailable position but rejects fabricated invalid coordinates and ranges', () => {
    expect(
      sourceReferenceSchema.safeParse({ file: 'src/App.tsx', start: null, end: null }).success,
    ).toBe(true);
    for (const source of [
      { file: 'src/App.tsx', start: { line: 0, column: 1 }, end: null },
      { file: 'src/App.tsx', start: null, end: { line: 1, column: 1 } },
      { file: 'src/App.tsx', start: { line: 2, column: 1 }, end: { line: 1, column: 1 } },
    ]) {
      expect(sourceReferenceSchema.safeParse(source).success).toBe(false);
    }
  });
});
