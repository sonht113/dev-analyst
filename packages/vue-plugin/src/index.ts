import {
  devanalyst,
  type DevAnalystPlugin,
  type ViteIntegrationOptions,
} from '@devanalyst/vite-plugin';
/** Vue SFC directives and compiler positions; React JSX instrumentation is never applied. */
export function devanalystVue(
  options: Omit<ViteIntegrationOptions, 'framework'> = {},
): DevAnalystPlugin {
  return devanalyst({ ...options, framework: 'vue-vite' });
}
export default devanalystVue;

export { defineConfig } from '@devanalyst/vite-plugin';
export type { ConfigurationFile } from '@devanalyst/vite-plugin';
