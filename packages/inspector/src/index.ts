export { startElementInspector } from './browser.js';
export type { ElementInspectorHandle, ElementInspectorOptions } from './browser.js';
export { extractElementMetadata } from './metadata.js';
export type { ElementMetadata } from './metadata.js';

import type { ClientEvent, DevAnalystConfig } from '@devanalyst/core';

/** Reserved transport integration contract retained for compatibility; DOM inspection is local. */
export interface InspectorOptions {
  readonly theme: DevAnalystConfig['inspector']['theme'];
  readonly onEvent: (event: ClientEvent) => void;
}

export { resolveElementSource } from './mapping-runtime.js';
