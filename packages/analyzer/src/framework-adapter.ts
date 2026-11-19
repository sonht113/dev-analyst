import ts from 'typescript';
import type { FrameworkCapabilities, FrameworkId } from '@devanalyst/core';
import { instrumentReactSource, type InstrumentationResult } from './instrumentation.js';
import { instrumentVueSource } from './vue-source.js';

/** Pure source mapping contract. No DOM/runtime traversal, source I/O, or application evaluation. */
export interface FrameworkAdapter extends FrameworkCapabilities {
  accepts(file: string): boolean;
  instrument(code: string, file: string, runtimeUrl: string): InstrumentationResult;
}
export function createFrameworkAdapter(id: FrameworkId): FrameworkAdapter {
  if (id === 'vue-vite' || id === 'nuxt')
    return {
      id,
      source: 'vue-sfc',
      strategy: 'vue-directive-v1',
      browserBoundary: 'client-and-ssr-hydrated',
      accepts: (file) => file.endsWith('.vue'),
      instrument: (code, file, runtime) =>
        instrumentVueSource(
          code,
          file,
          id === 'nuxt'
            ? '@devanalyst/nuxt-module/vue-runtime'
            : runtime.replace(/mapping-runtime\.js$/, 'vue-runtime.js'),
          id,
        ),
    };
  return {
    id,
    source: 'jsx',
    strategy: 'compile-time-ref-v1',
    browserBoundary: 'client',
    accepts: (file) => /\.[jt]sx$/.test(file),
    instrument(code, file, runtime) {
      if (id === 'next-react') {
        const ast = ts.createSourceFile(
          file,
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        let client = false;
        for (const statement of ast.statements) {
          if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
            break;
          if (statement.expression.text === 'use client') client = true;
        }
        if (!client)
          return {
            code,
            map: null,
            manifest: { version: 1, moduleId: '0'.repeat(64), revision: '0'.repeat(64), sites: [] },
            inspections: [],
            diagnostics: [{ code: 'SERVER_BOUNDARY', source: null }],
          };
      }
      const result = instrumentReactSource(code, file, runtime);
      return {
        ...result,
        manifest: { ...result.manifest, framework: id, strategy: 'compile-time-ref-v1' },
      };
    },
  };
}
