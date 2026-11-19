import { registerSourceModule } from './mapping-runtime.js';
interface BoundElement {
  readonly nodeType: number;
  readonly localName: string;
  readonly isConnected: boolean;
}
const entries = new WeakMap<
  BoundElement,
  { revision: unknown; site: unknown; ref: (node: BoundElement | null) => void }
>();
function remove(element: BoundElement): void {
  entries.get(element)?.ref(null);
  entries.delete(element);
}
function bind(element: BoundElement, binding: { value: unknown }): void {
  const value = binding.value;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('manifest' in value) ||
    typeof value.manifest !== 'object' ||
    value.manifest === null ||
    !('revision' in value.manifest) ||
    !('sites' in value.manifest) ||
    !Array.isArray(value.manifest.sites) ||
    value.manifest.sites.length !== 1
  ) {
    remove(element);
    return;
  }
  const site: unknown = value.manifest.sites[0];
  const manifest = value.manifest;
  const id = typeof site === 'object' && site !== null && 'id' in site ? site.id : null;
  const previous = entries.get(element);
  if (previous && previous.revision === manifest.revision && previous.site === id) return;
  remove(element);
  const module = registerSourceModule(manifest),
    ref = module.ref(0);
  ref(element);
  entries.set(element, { revision: manifest.revision, site: id, ref });
}
/** Public Vue directive lifecycle only. Template revisions never modify setup/ref semantics. */
export const vueSourceDirective = { mounted: bind, updated: bind, beforeUnmount: remove };
