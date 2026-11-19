import { describe, expect, it } from 'vitest';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { instrumentVueSource, parseVueSource } from './vue-source.js';
const source = `<script setup lang="ts">\nimport {ref} from 'vue';\nconst count=ref(0); function save(){count.value++}\n</script>\n<template><main><button v-for="item in [1,2]" :key="item" v-if="count >= 0" @click="save">保存</button><input ref="control"/><section data-private>PRIVATE_TEXT</section></main></template>`;
describe('Vue SFC source strategy', () => {
  it('instruments compiler template positions using directives without touching native refs or expressions', () => {
    const result = instrumentVueSource(source, 'src/App.vue', '/__devanalyst/vue-runtime.js');
    expect(result.manifest.strategy).toBe('vue-directive-v1');
    expect(result.manifest.sites.length).toBe(4);
    expect(result.code).toContain('ref="control"');
    expect(result.code).not.toContain(' ref={');
    const parsed = parse(result.code, { filename: 'App.vue' }).descriptor;
    const script = compileScript(parsed, { id: 'test' });
    const template = compileTemplate({
      source: parsed.template?.content ?? '',
      filename: 'App.vue',
      id: 'test',
      compilerOptions: script.bindings ? { bindingMetadata: script.bindings } : {},
    });
    expect(template.errors).toEqual([]);
    expect(template.code).toContain('vDevanalystOrigin');
    expect(result.inspections.find((entry) => entry.literal?.text === '保存')).toBeTruthy();
    expect(
      result.inspections.find((entry) => entry.literal?.text === 'PRIVATE_TEXT'),
    ).toBeUndefined();
    const site = result.manifest.sites.find((site) => site.tag === 'button');
    expect(site?.source.start).toEqual({ line: 5, column: 17 });
    if (!result.map) throw new Error('Missing map');
    const inserted = result.code.indexOf('function save');
    const prefix = result.code.slice(0, inserted).split('\n');
    expect(
      originalPositionFor(new TraceMap(result.map), {
        line: prefix.length,
        column: prefix.at(-1)?.length ?? 0,
      }).line,
    ).toBe(3);
  });
  it.each([
    source.replace('lang="ts"', 'lang="tsx"'),
    '<template><button/></template>',
    '<script setup src="./external.ts"/><template><button/></template>',
  ])('fails closed for unsupported SFC configuration', (code) => {
    expect(instrumentVueSource(code, 'src/App.vue', '/__devanalyst/vue-runtime.js').map).toBeNull();
  });
  it('keeps original UTF-16/newline positions in the script projection', () => {
    const parsed = parseVueSource(source, 'src/App.vue');
    expect(parsed.projection.length).toBe(source.length);
    expect(parsed.projection.indexOf('function save')).toBe(source.indexOf('function save'));
  });
});
