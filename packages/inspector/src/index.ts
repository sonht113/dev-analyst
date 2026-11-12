import type { ClientEvent, DevAnalystConfig } from '@devanalyst/core';

/** Future browser integration options. No UI, listeners, or DOM mutations are installed. */
export interface InspectorOptions {
  readonly theme: DevAnalystConfig['inspector']['theme'];
  readonly onEvent: (event: ClientEvent) => void;
}
