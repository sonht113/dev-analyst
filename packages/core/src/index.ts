export {
  configSchema,
  defineConfig,
  logLevelSchema,
  sensitivePathPatterns,
  workspacePathSchema,
  bridgeOptionsSchema,
} from './config.js';
export type { DevAnalystConfig, DevAnalystConfigInput, LogLevel } from './config.js';
export type { BridgeOptions, BridgeOptionsInput } from './config.js';
export { DevAnalystError, errorCodeSchema, serializedErrorSchema } from './errors.js';
export type { DevAnalystErrorOptions, ErrorCode, SerializedError } from './errors.js';
export {
  clientEventSchema,
  PROTOCOL_VERSION,
  serverEventSchema,
  routePayloadSchema,
  routePathSchema,
  bridgeBootstrapSchema,
} from './events.js';
export type { ClientEvent, ServerEvent, RoutePayload, BridgeBootstrap } from './events.js';
export {
  evidenceSchema,
  findingSchema,
  sourcePositionSchema,
  sourceReferenceSchema,
} from './findings.js';
export type { Evidence, Finding, SourcePosition, SourceReference } from './findings.js';
export { createLogger, logMetadataSchema } from './logger.js';
export type {
  ActiveLogLevel,
  Logger,
  LoggerOptions,
  LogMetadata,
  LogRecord,
  LogResult,
} from './logger.js';
