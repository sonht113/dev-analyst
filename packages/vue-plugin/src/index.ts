import type { DevAnalystConfigInput } from '@devanalyst/core';

/** Configuration contract for the planned Vue and Nuxt integrations. */
export interface VueIntegrationOptions {
  readonly framework: 'vue' | 'nuxt';
  readonly config?: DevAnalystConfigInput;
}
