import { z } from 'zod';
import { serializedErrorSchema } from './errors.js';
import { findingSchema, sourceReferenceSchema } from './findings.js';
import { workspacePathSchema } from './config.js';
import { inspectorUpdateSchema } from './inspector.js';
import { pageElementSchema, pageProgressSchema } from './preanalysis.js';

/** Versioned local bridge protocol. */
export const PROTOCOL_VERSION = 1;

export const bridgeBootstrapSchema = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  endpoint: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'ws:' &&
        url.hostname === '127.0.0.1' &&
        url.pathname === '/__devanalyst/ws' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'Expected a loopback WebSocket endpoint'),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  reconnectAttempts: z.number().int().min(0).max(20),
});

export type BridgeBootstrap = z.infer<typeof bridgeBootstrapSchema>;

const envelope = {
  version: z.literal(PROTOCOL_VERSION),
  id: z.uuid(),
  timestamp: z.iso.datetime({ offset: true }),
};

/** Excludes query strings and fragments; callers must also avoid sensitive path segments. */
export const routePathSchema = z
  .string()
  .min(1)
  .max(2048)
  .startsWith('/')
  .refine(
    (value) =>
      !value.includes('?') &&
      !value.includes('#') &&
      [...value].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ),
    'Expected a route pathname only',
  );

/** Query strings and opaque fragments are never collected. Hash routes are pathnames only. */
export const routePayloadSchema = z.strictObject({
  pathname: routePathSchema,
  hashPath: routePathSchema.nullable().optional(),
  reason: z
    .enum(['initial', 'pushState', 'replaceState', 'popstate', 'hashchange', 'reconnect'])
    .optional(),
});

export type RoutePayload = z.infer<typeof routePayloadSchema>;

export const clientEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('inspector.request'),
    payload: z.strictObject({
      requestId: z.uuid(),
      pageId: z.uuid(),
      element: pageElementSchema,
      route: routePayloadSchema,
      textDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .nullable(),
      mode: z.enum(['compact', 'expanded']),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('inspector.cancel'),
    payload: z.strictObject({ requestId: z.uuid() }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('page.index'),
    payload: z.strictObject({
      requestId: z.uuid(),
      route: routePayloadSchema,
      elements: z.array(pageElementSchema).max(8),
      limited: z.boolean(),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('page.priority'),
    payload: z.strictObject({
      requestId: z.uuid(),
      element: pageElementSchema,
      priority: z.enum(['hovered', 'selected']),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('route.changed'),
    payload: routePayloadSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('inspection.requested'),
    payload: z.strictObject({
      requestId: z.uuid(),
      elementId: z.string().min(1).max(128),
      pathname: routePathSchema,
      source: sourceReferenceSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('analysis.cancelled'),
    payload: z.strictObject({ requestId: z.uuid() }),
  }),
]);

export const serverEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('inspector.update'),
    payload: inspectorUpdateSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('page.progress'), payload: pageProgressSchema }),
  z.strictObject({
    ...envelope,
    type: z.literal('bridge.ready'),
    payload: z.strictObject({ clientId: z.uuid() }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('route.acknowledged'),
    payload: z.strictObject({ clientId: z.uuid(), route: routePayloadSchema }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('source.changed'),
    payload: z.strictObject({
      file: workspacePathSchema,
      kind: z.enum(['add', 'change', 'unlink']),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('analysis.completed'),
    payload: z.strictObject({ requestId: z.uuid(), findings: z.array(findingSchema).max(500) }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('analysis.progress'),
    payload: z
      .strictObject({
        requestId: z.uuid(),
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .refine((value) => value.completed <= value.total, 'Completed work exceeds total work'),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('bridge.error'),
    payload: z.strictObject({ requestId: z.uuid().nullable(), error: serializedErrorSchema }),
  }),
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
