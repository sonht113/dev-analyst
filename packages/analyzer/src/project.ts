import ts from 'typescript';
import { posix, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DevAnalystError, type AnalysisDiagnostic, type SourceReference } from '@devanalyst/core';
import { createWorkspaceAccess } from './workspace.js';
import type { AnalysisBudget } from './analysis-options.js';
import { AnalysisStop, type ResolvedAnalyzerOptions } from './analysis-options.js';
import { sourceOf, virtualRoot } from './syntax.js';
export interface ModuleImport {
  readonly specifier: string;
  readonly node: ts.Node;
  readonly target: string | null;
}
export interface StaticProject {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly files: ReadonlyMap<string, ts.SourceFile>;
  readonly imports: ReadonlyMap<string, readonly ModuleImport[]>;
  readonly hashes: Readonly<Record<string, string>>;
  readonly canonicalPaths: ReadonlyMap<string, string>;
}
export async function loadProject(
  options: ResolvedAnalyzerOptions,
  roots: readonly SourceReference[],
  budget: AnalysisBudget,
  diagnostic: (value: AnalysisDiagnostic) => void,
): Promise<StaticProject> {
  const access = await createWorkspaceAccess(options.workspaceRoot, options.source).catch(
    (cause: unknown) => {
      throw new DevAnalystError(
        'WORKSPACE_ACCESS_DENIED',
        'Open an accessible workspace root for source analysis.',
        { cause },
      );
    },
  );
  const texts = new Map<string, string>(),
    aliases = new Map<string, string>(),
    missed = new Set<string>();
  const normalized = (file: string) => {
    const path = posix.normalize(file.replaceAll('\\', '/'));
    return path === '..' || path.startsWith('../') || path.startsWith('/') || path.includes(':')
      ? null
      : path;
  };
  async function read(file: string): Promise<string | null> {
    budget.check();
    const path = normalized(file);
    if (!path) return null;
    const previous = aliases.get(path);
    if (previous) return texts.get(previous) ?? null;
    if (missed.has(path)) return null;
    if (++budget.resolutionAttempts > budget.limits.maxResolutionAttempts)
      throw new AnalysisStop('RESOLUTION_LIMIT');
    const canonical = await access.canonicalSourcePath(resolve(options.workspaceRoot, path));
    if (!canonical) {
      missed.add(path);
      return null;
    }
    aliases.set(path, canonical);
    aliases.set(canonical, canonical);
    if (texts.has(canonical)) return texts.get(canonical) ?? null;
    if (budget.files >= budget.limits.maxFiles) throw new AnalysisStop('FILE_LIMIT');
    try {
      const code = await access.readSource(canonical);
      budget.check();
      const bytes = Buffer.byteLength(code);
      if (budget.bytes + bytes > budget.limits.maxBytes) throw new AnalysisStop('BYTE_LIMIT');
      budget.bytes += bytes;
      budget.files++;
      texts.set(canonical, code);
      return code;
    } catch (error: unknown) {
      if (error instanceof AnalysisStop) throw error;
      missed.add(path);
      diagnostic({
        code: 'SOURCE_UNAVAILABLE',
        message:
          'An allowed source could not be read consistently or exceeded the per-file policy.',
        source: { file: canonical, start: null, end: null },
      });
      return null;
    }
  }
  let baseUrl = options.compilerOptions.baseUrl ?? '.';
  const paths: Record<string, readonly string[]> = Object.create(null);
  const configs = new Set<string>();
  const configStack = new Set<string>();
  let configFailure = false;
  async function config(file: string, depth: number): Promise<void> {
    if (depth > 8 || configStack.has(file)) {
      diagnostic({
        code: 'CONFIG_CYCLE',
        message: 'Configuration extension cycle/depth is unsupported.',
        source: null,
      });
      configFailure = true;
      return;
    }
    if (configs.has(file)) return;
    configs.add(file);
    configStack.add(file);
    try {
      const code = await read(file);
      if (code === null) {
        diagnostic({
          code: 'CONFIG_UNAVAILABLE',
          message: 'Explicitly include permitted JSON configuration files in source policy.',
          source: null,
        });
        configFailure = true;
        return;
      }
      const parsed = ts.parseConfigFileTextToJson(file, code);
      if (parsed.error) {
        diagnostic({
          code: 'CONFIG_PARSE_ERROR',
          message: 'Configuration JSON could not be parsed.',
          source: { file, start: null, end: null },
        });
        configFailure = true;
        return;
      }
      const value: unknown = parsed.config;
      if (typeof value === 'object' && value !== null && 'extends' in value) {
        const extensions =
          typeof value.extends === 'string'
            ? [value.extends]
            : Array.isArray(value.extends)
              ? value.extends
              : [];
        if (!extensions.length || extensions.length > 8) {
          configFailure = true;
          diagnostic({
            code: 'CONFIG_EXTENDS_UNSUPPORTED',
            message: 'Only bounded explicit local JSON extensions are supported.',
            source: { file, start: null, end: null },
          });
          return;
        }
        for (const extension of extensions) {
          if (typeof extension !== 'string' || !extension.startsWith('.')) {
            configFailure = true;
            diagnostic({
              code: 'CONFIG_EXTENDS_UNSUPPORTED',
              message: 'Package/absolute config extensions are not loaded.',
              source: { file, start: null, end: null },
            });
            continue;
          }
          const parent = normalized(
            posix.join(
              posix.dirname(file),
              extension.endsWith('.json') ? extension : extension + '.json',
            ),
          );
          if (parent) await config(parent, depth + 1);
          else configFailure = true;
        }
      }
    } finally {
      configStack.delete(file);
    }
  }
  if (options.tsconfig) {
    await config(options.tsconfig, 0);
    if (!configFailure) {
      const configured = ts.getParsedCommandLineOfConfigFile(
        virtualRoot + options.tsconfig,
        {},
        {
          useCaseSensitiveFileNames: true,
          getCurrentDirectory: () => virtualRoot,
          fileExists: (name) =>
            texts.has(
              aliases.get(name.slice(virtualRoot.length)) ?? name.slice(virtualRoot.length),
            ),
          readFile: (name) =>
            texts.get(
              aliases.get(name.slice(virtualRoot.length)) ?? name.slice(virtualRoot.length),
            ),
          readDirectory: () => [],
          onUnRecoverableConfigFileDiagnostic: () => {
            configFailure = true;
          },
        },
      );
      // TS18003 (empty include) is expected: discovery is deliberately disabled; requested roots define scope.
      if (!configured || configured.errors.some((error) => error.code !== 18003)) {
        configFailure = true;
        diagnostic({
          code: 'CONFIG_INVALID',
          message: 'Configuration is invalid or requires unsupported filesystem discovery.',
          source: null,
        });
      }
      if (configured && !configFailure) {
        // Read legacy project configuration without adopting baseUrl in our compiler options.
        const legacyPaths: { readonly baseUrl?: string } = configured.options;
        const base = legacyPaths.baseUrl;
        const declaredBase =
          typeof configured.options['pathsBasePath'] === 'string'
            ? configured.options['pathsBasePath']
            : virtualRoot + posix.dirname(options.tsconfig);
        const pathsBase = base ?? declaredBase;
        if (
          !(pathsBase === virtualRoot.slice(0, -1) || pathsBase.startsWith(virtualRoot)) ||
          (base && !(base === virtualRoot.slice(0, -1) || base.startsWith(virtualRoot)))
        ) {
          diagnostic({
            code: 'CONFIG_OUTSIDE_POLICY',
            message: 'Alias bases outside the workspace are not analyzed.',
            source: null,
          });
        } else {
          if (base) baseUrl = base.slice(virtualRoot.length) || '.';
          for (const [key, targets] of Object.entries(configured.options.paths ?? {})) {
            if (
              Object.keys(paths).length >= 64 ||
              key.length > 256 ||
              targets.length > 8 ||
              targets.some((target) => target.length > 1024)
            )
              throw new AnalysisStop('CONFIG_LIMIT');
            paths[key] = targets.map((target) =>
              posix.join(pathsBase.slice(virtualRoot.length), target),
            );
          }
        }
      }
    }
  }
  if (options.compilerOptions.baseUrl !== undefined) baseUrl = options.compilerOptions.baseUrl;
  for (const [key, targets] of Object.entries(options.compilerOptions.paths))
    paths[key] = targets.map((target) =>
      posix.join(options.compilerOptions.baseUrl ?? '.', target),
    );
  for (const [name, target] of Object.entries(options.aliases)) {
    paths[name] = [target];
    paths[name + '/*'] = [target + '/*'];
  }
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noLib: true,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    baseUrl: virtualRoot,
    paths: Object.fromEntries(Object.entries(paths).map(([name, targets]) => [name, [...targets]])),
    noEmit: true,
  };
  const host: ts.ModuleResolutionHost = {
    fileExists: (name) =>
      texts.has(name.slice(virtualRoot.length)) ||
      texts.has(aliases.get(name.slice(virtualRoot.length)) ?? ''),
    readFile: (name) =>
      texts.get(aliases.get(name.slice(virtualRoot.length)) ?? name.slice(virtualRoot.length)),
    getCurrentDirectory: () => virtualRoot,
  };
  const imports = new Map<string, ModuleImport[]>(),
    asts = new Map<string, ts.SourceFile>(),
    queue: { file: string; depth: number }[] = roots.map((root) => ({ file: root.file, depth: 0 }));
  const visited = new Set<string>();
  function bases(specifier: string, importer: string): string[] {
    if (specifier.startsWith('.')) return [posix.join(posix.dirname(importer), specifier)];
    const alias = Object.entries(options.aliases)
      .sort(([a], [b]) => b.length - a.length)
      .find(([key]) => specifier === key || specifier.startsWith(key + '/'));
    if (alias) return [posix.join(alias[1], specifier.slice(alias[0].length))];
    const matches = Object.entries(paths)
      .filter(([pattern]) => {
        const [prefix, suffix] = pattern.split('*');
        return pattern.includes('*')
          ? specifier.startsWith(prefix ?? '') && specifier.endsWith(suffix ?? '')
          : pattern === specifier;
      })
      .sort(([a], [b]) => b.replace('*', '').length - a.replace('*', '').length);
    if (matches[0]) {
      const [pattern, targets] = matches[0];
      const [prefix, suffix] = pattern.split('*');
      const match = pattern.includes('*')
        ? specifier.slice(prefix?.length ?? 0, specifier.length - (suffix?.length ?? 0))
        : '';
      return targets.map((target) => target.replace('*', match));
    }
    return baseUrl !== '.' ? [posix.join(baseUrl, specifier)] : [];
  }
  async function resolveImport(specifier: string, importer: string): Promise<string | null> {
    if (specifier.startsWith('/') || specifier.includes('\0') || specifier.includes('?'))
      return null;
    for (const base of bases(specifier, importer)) {
      const stem = /\.[cm]?[jt]sx?$/.test(base) ? base.replace(/\.[cm]?[jt]sx?$/, '') : base;
      const candidates = /\.[tj]sx?$/.test(base)
        ? [stem + '.ts', stem + '.tsx', stem + '.d.ts', base, stem + '.js', stem + '.jsx']
        : [
            base,
            ...[
              '.ts',
              '.tsx',
              '.d.ts',
              '.js',
              '.jsx',
              '.mjs',
              '.cjs',
              '/index.ts',
              '/index.tsx',
              '/index.js',
              '/index.jsx',
            ].map((extension) => base + extension),
          ];
      for (const candidate of new Set(candidates)) await read(candidate);
    }
    const resolved = ts.resolveModuleName(
      specifier,
      virtualRoot + importer,
      compilerOptions,
      host,
    ).resolvedModule;
    return resolved
      ? (aliases.get(resolved.resolvedFileName.slice(virtualRoot.length)) ??
          resolved.resolvedFileName.slice(virtualRoot.length))
      : null;
  }
  for (let index = 0; index < queue.length; index++) {
    budget.check();
    const item = queue[index];
    if (!item) continue;
    if (item.depth > budget.limits.maxDepth) {
      diagnostic({
        code: 'IMPORT_DEPTH_LIMIT',
        message: 'Import traversal depth is bounded; deeper sources were omitted.',
        source: null,
      });
      continue;
    }
    const code = await read(item.file);
    const file = aliases.get(item.file) ?? item.file;
    if (code === null) {
      diagnostic({
        code: 'SOURCE_UNAVAILABLE',
        message: 'Source is unavailable or excluded by workspace policy.',
        source: roots.some((root) => root.file === item.file)
          ? { file: item.file, start: null, end: null }
          : null,
      });
      continue;
    }
    if (visited.has(file)) continue;
    visited.add(file);
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) {
      diagnostic({
        code: 'UNSUPPORTED_SOURCE_FORMAT',
        message: 'Only TypeScript/JavaScript source modules are parsed.',
        source: { file, start: null, end: null },
      });
      continue;
    }
    const sf = ts.createSourceFile(virtualRoot + file, code, ts.ScriptTarget.ES2022, true);
    asts.set(file, sf);
    const moduleImports: ModuleImport[] = [];
    const stack: ts.Node[] = [sf];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      budget.node();
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        if (moduleImports.length >= 128) throw new AnalysisStop('IMPORT_COUNT_LIMIT');
        const specifier = node.moduleSpecifier.text,
          target = await resolveImport(specifier, file);
        moduleImports.push({ specifier, node, target });
        if (target && !visited.has(target)) queue.push({ file: target, depth: item.depth + 1 });
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        diagnostic({
          code: 'DYNAMIC_IMPORT',
          message: 'Dynamic import execution and lazy dependency selection are not evaluated.',
          source: sourceOf(node),
        });
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
    imports.set(file, moduleImports);
  }
  const invalid = new Set<string>();
  const makeProgram = () => {
    const compilerHost: ts.CompilerHost = {
      ...host,
      getSourceFile: (name) =>
        invalid.has(name.slice(virtualRoot.length))
          ? undefined
          : asts.get(name.slice(virtualRoot.length)),
      writeFile: () => undefined,
      getDefaultLibFileName: () => '',
      getCurrentDirectory: () => virtualRoot,
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      resolveModuleNames: (names, containing) =>
        names.map((name) => {
          const edge = imports
            .get(containing.slice(virtualRoot.length))
            ?.find((item) => item.specifier === name);
          if (!edge?.target || invalid.has(edge.target)) return undefined;
          const extension = edge.target.endsWith('.tsx')
            ? ts.Extension.Tsx
            : edge.target.endsWith('.jsx')
              ? ts.Extension.Jsx
              : edge.target.endsWith('.ts')
                ? ts.Extension.Ts
                : ts.Extension.Js;
          return {
            resolvedFileName: virtualRoot + edge.target,
            extension,
            isExternalLibraryImport: false,
          };
        }),
    };
    return ts.createProgram(
      [...asts.keys()].filter((file) => !invalid.has(file)).map((file) => virtualRoot + file),
      compilerOptions,
      compilerHost,
    );
  };
  let program = makeProgram();
  for (const [file, sf] of asts) {
    budget.check();
    if (program.getSyntacticDiagnostics(sf).length) {
      invalid.add(file);
      diagnostic({
        code: 'SOURCE_PARSE_ERROR',
        message: 'Malformed source is excluded from semantic findings.',
        source: { file, start: null, end: null },
      });
    }
  }
  if (invalid.size) {
    for (const file of invalid) asts.delete(file);
    program = makeProgram();
  }
  const hashes = Object.fromEntries(
    [...asts].map(([file, sf]) => [file, createHash('sha256').update(sf.text).digest('hex')]),
  );
  budget.check();
  return {
    program,
    checker: program.getTypeChecker(),
    files: asts,
    imports,
    hashes,
    canonicalPaths: aliases,
  };
}
