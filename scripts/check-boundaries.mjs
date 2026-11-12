import { builtinModules } from 'node:module';
import console from 'node:console';
import process from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/** @typedef {{exports?: Record<string, unknown>, name: string, dependencies?: Record<string, string>, devDependencies?: Record<string, string>, peerDependencies?: Record<string, string>, optionalDependencies?: Record<string, string>}} Manifest */
/** @typedef {{directory: string, manifest: Manifest}} Workspace */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserPackages = new Set(['@devanalyst/core', '@devanalyst/inspector']);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

/** @param {string} root @returns {Promise<Workspace[]>} */
export async function readWorkspaces(root) {
  const workspaces = [];
  for (const group of ['packages', 'apps']) {
    const entries = await readdir(resolve(root, group), { withFileTypes: true });
    const allowed =
      group === 'packages'
        ? new Set(['core', 'vite-plugin', 'inspector', 'analyzer', 'ai', 'cache', 'cli'])
        : new Set(['playground-react']);
    for (const entry of entries.filter((value) => value.isDirectory() && allowed.has(value.name))) {
      const directory = resolve(root, group, entry.name);
      /** @type {Manifest} */
      const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
      workspaces.push({ directory, manifest });
    }
  }
  return workspaces;
}

/** @param {ReadonlyMap<string, readonly string[]>} graph @returns {string[]} */
export function findCycles(graph) {
  const finished = new Set();
  /** @type {string[]} */
  const active = [];
  /** @type {string[]} */
  const cycles = [];
  /** @param {string} name */
  function visit(name) {
    if (active.includes(name)) {
      cycles.push([...active.slice(active.indexOf(name)), name].join(' -> '));
      return;
    }
    if (finished.has(name)) return;
    active.push(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    active.pop();
    finished.add(name);
  }
  for (const name of graph.keys()) visit(name);
  return cycles;
}

/** @param {string} directory @returns {Promise<string[]>} */
async function sourceFiles(directory) {
  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:[cm]?[jt]sx?|vue)$/.test(entry.name) && !entry.name.includes('.test.')) {
      files.push(path);
    }
  }
  return files;
}

/** Finds static, re-exported, import-type, dynamic-import and require dependencies.
 * @param {string} text @param {string} file @returns {{imports: string[], dynamic: boolean}}
 */
export function extractImports(text, file) {
  const source = file.endsWith('.vue')
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
    : text;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  /** @type {string[]} */
  const imports = [];
  let dynamic = false;
  /** @param {ts.Node} node */
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteralLike(node.argument.literal)) imports.push(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) imports.push(argument.text);
      else dynamic = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, dynamic };
}

/** @param {string} specifier */
function packageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? specifier);
}

/** @param {string} root @returns {Promise<string[]>} */
export async function checkBoundaries(root = repositoryRoot) {
  const workspaces = await readWorkspaces(root);
  const byName = new Map(workspaces.map((workspace) => [workspace.manifest.name, workspace]));
  /** @type {Map<string, string[]>} */
  const graph = new Map();
  /** @type {string[]} */
  const errors = [];
  if (byName.size !== workspaces.length) errors.push('Workspace names must be unique');

  for (const { manifest, directory } of workspaces) {
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    graph.set(
      manifest.name,
      Object.keys(dependencies).filter((name) => byName.has(name)),
    );
    for (const [name, version] of Object.entries(dependencies)) {
      if (byName.has(name) && !version.startsWith('workspace:')) {
        errors.push(`${manifest.name}: internal dependency ${name} must use workspace:`);
      }
      if (name.startsWith('@devanalyst/') && !byName.has(name)) {
        errors.push(`${manifest.name}: unknown workspace dependency ${name}`);
      }
      if (browserPackages.has(manifest.name) && byName.has(name) && !browserPackages.has(name)) {
        errors.push(`${manifest.name}: browser package cannot depend on ${name}`);
      }
    }
    if (!relative(root, directory).startsWith(`packages${sep}`)) continue;
    for (const file of await sourceFiles(resolve(directory, 'src'))) {
      const { imports, dynamic } = extractImports(await readFile(file, 'utf8'), file);
      if (dynamic)
        errors.push(`${relative(root, file)}: non-literal module loading is not allowed`);
      for (const specifier of imports) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (!target.startsWith(`${resolve(directory, 'src')}${sep}`)) {
            errors.push(`${relative(root, file)}: cross-boundary relative import ${specifier}`);
          }
          continue;
        }
        if (specifier.startsWith('/') || specifier.startsWith('#')) {
          errors.push(`${relative(root, file)}: unsupported module path ${specifier}`);
          continue;
        }
        if (specifier.startsWith('node:') || builtins.has(specifier)) {
          if (browserPackages.has(manifest.name)) {
            errors.push(`${relative(root, file)}: Node.js import ${specifier} in browser code`);
          }
          continue;
        }
        const dependency = packageName(specifier);
        if (!dependencies[dependency]) {
          errors.push(`${relative(root, file)}: undeclared dependency ${dependency}`);
        }
        const exportedSubpath = specifier.slice(dependency.length);
        const publicExports = byName.get(dependency)?.manifest.exports;
        if (
          byName.has(dependency) &&
          specifier !== dependency &&
          !publicExports?.[`.${exportedSubpath}`]
        ) {
          errors.push(`${relative(root, file)}: internal deep import ${specifier}`);
        }
      }
    }
  }
  errors.push(...findCycles(graph).map((cycle) => `Circular workspace dependency: ${cycle}`));
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const errors = await checkBoundaries();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('Workspace boundaries passed; no circular package dependencies.');
  }
}
