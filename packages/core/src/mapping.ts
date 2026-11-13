import type { SourceReference } from './findings.js';

/** Compile-time JSX ownership, not a private React runtime component stack. */
export interface ComponentIdentity {
  readonly id: string;
  readonly name: string;
  readonly source: SourceReference;
}
export interface MappingSite {
  readonly id: string;
  readonly tag: string;
  readonly source: SourceReference;
  readonly component: ComponentIdentity | null;
}
export interface SourceModuleManifest {
  readonly version: 1;
  readonly moduleId: string;
  readonly revision: string;
  readonly sites: readonly MappingSite[];
}
export type MappingUnknownReason =
  | 'NOT_INSTRUMENTED'
  | 'DETACHED_ELEMENT'
  | 'STALE_SOURCE'
  | 'AMBIGUOUS_BINDING'
  | 'TAG_MISMATCH'
  | 'REGISTRY_LIMIT';
export type ElementSourceMapping =
  | {
      readonly status: 'VERIFIED';
      readonly source: SourceReference;
      readonly component: ComponentIdentity | null;
      readonly elementId: string;
      readonly runtimeId: string;
      readonly revision: string;
      readonly strategy: 'compile-time-ref-v1';
      readonly observedAt: string;
      readonly cache: 'none';
    }
  | {
      readonly status: 'UNKNOWN';
      readonly reason: MappingUnknownReason;
      readonly source: null;
      readonly component: null;
      readonly runtimeId: string | null;
      readonly observedAt: string;
      readonly cache: 'none';
    };
