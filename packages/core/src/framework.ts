/** Concrete integrations authorized by Phase 11; no runtime framework internals are exposed. */
export type FrameworkId = 'react-vite' | 'next-react' | 'vue-vite' | 'nuxt';
export type MappingStrategy = 'compile-time-ref-v1' | 'vue-directive-v1';
export interface FrameworkCapabilities {
  readonly id: FrameworkId;
  readonly source: 'jsx' | 'vue-sfc';
  readonly strategy: MappingStrategy;
  readonly browserBoundary: 'client' | 'client-and-ssr-hydrated';
}
