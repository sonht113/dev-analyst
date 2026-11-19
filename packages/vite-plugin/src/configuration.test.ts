import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfiguration, routeExcluded, analysisLimits } from './configuration.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(source?: string) {
  const root = await mkdtemp(join(tmpdir(), 'devanalyst-config-'));
  roots.push(root);
  if (source) await writeFile(join(root, 'devanalyst.config.ts'), source);
  return root;
}
describe('trusted typed configuration', () => {
  it('loads defaults without a file and never enables AI', async () => {
    const config = await loadConfiguration(await fixture());
    expect(config.ai.enabled).toBe(false);
    expect(config.bridge.port).toBe(0);
    expect(config.editor.command).toBe('code');
  });
  it('loads TypeScript, merges sections by Vite mode and applies inline precedence', async () => {
    const root = await fixture(
      `const depth = 'deep' as const; export default { source: {include:['app/**'],exclude:['app/private/**']}, analysis:{depth}, inspector:{theme:'dark'}, environments:{test:{inspector:{language:'vi'},source:{exclude:['app/test/**']}},development:{analysis:{depth:'shallow'}}}} satisfies Record<string,unknown>`,
    );
    const config = await loadConfiguration(root, 'test', { inspector: { theme: 'light' } });
    expect(config.inspector).toMatchObject({ theme: 'light', language: 'vi' });
    expect(config.source.include).toEqual(['app/**']);
    expect(config.source.exclude).toContain('**/.env.*');
    expect(config.source.exclude).toContain('app/test/**');
    expect(config.source.exclude).not.toContain('app/private/**');
    expect(analysisLimits(config).maxDepth).toBe(24);
    expect(analysisLimits(await loadConfiguration(root)).maxDepth).toBe(4);
  });
  it('applies inline precedence consistently when validating every declared mode', async () => {
    const root = await fixture('export default { environments:{test:{ai:{enabled:true}}} }');
    expect((await loadConfiguration(root, 'test', { ai: { enabled: false } })).ai.enabled).toBe(
      false,
    );
    expect((await loadConfiguration(await fixture(), 'constructor')).ai.enabled).toBe(false);
  });
  it.each([
    'export default { ai:{enabled:true} }',
    "export default { environments: { test:{analysis:{depth:'invalid-private-value'}} } }",
    "export default { inspector:{shortcuts:{toggle:'Alt+KeyP'}} }",
    "export default { inspector:{shortcuts:{toggle:'Alt+Alt+KeyI'}} }",
    "export default { bridge:{host:'0.0.0.0'} }",
    "export default { routes:{exclude:['secret?value']} }",
    'export default { environments:{test: {environments:{}}} }',
    "export default {cache:{directory:'../private-value'}}",
    'export default {__proto__: {ai:{enabled:true}}}',
    "export default {ai: {enabled: 'private-value'}}",
    'export default {',
  ])('fails closed with safe recovery: %s', async (source) => {
    await expect(loadConfiguration(await fixture(source))).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
    try {
      await loadConfiguration(await fixture(source));
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  });
  it('rejects symlinked and oversized configuration files', async () => {
    const root = await fixture();
    const other = await fixture('export default {}');
    await symlink(join(other, 'devanalyst.config.ts'), join(root, 'devanalyst.config.ts'));
    await expect(loadConfiguration(root)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(loadConfiguration(await fixture(' '.repeat(65537)))).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
    });
  });
  it('matches bounded route globs and hash routes independently of file excludes', async () => {
    const config = await loadConfiguration(
      await fixture(
        "export default {routes:{exclude:['/admin/**','/user/*']},source:{exclude:['src/private/**']}}",
      ),
    );
    expect(routeExcluded(config, { pathname: '/admin/settings' })).toBe(true);
    expect(routeExcluded(config, { pathname: '/', hashPath: '/admin/keys' })).toBe(true);
    expect(routeExcluded(config, { pathname: '/user/a/b' })).toBe(false);
    expect(routeExcluded(config, { pathname: '/other' })).toBe(false);
  });
});
