import ts from 'typescript';
import type { SemanticModel } from './semantic.js';
import { sourceOf, textOf } from './syntax.js';

/** Describe lexical declarations, without executing getters, calls or resolving current values. */
export function valueBindings(model: SemanticModel, expression: ts.Node): string[] {
  const bindings = new Set<string>();
  const stack = [expression];
  let visited = 0;
  while (stack.length && visited++ < 100 && bindings.size < 4) {
    model.budget.check();
    const node = stack.pop();
    if (!node) break;
    if (ts.isIdentifier(node)) {
      const symbol = model.symbol(node);
      const declaration = symbol ? model.canonical(symbol).valueDeclaration : undefined;
      if (declaration && model.project.files.has(sourceOf(declaration).file)) {
        let origin: ts.Node = declaration;
        if (ts.isBindingElement(origin)) {
          while (origin.parent && !ts.isVariableDeclaration(origin) && !ts.isParameter(origin))
            origin = origin.parent;
        }
        if (ts.isVariableDeclaration(origin) || ts.isParameter(origin))
          bindings.add(textOf(origin).slice(0, 240));
      }
    }
    ts.forEachChild(node, (child) => {
      stack.push(child);
    });
  }
  return [...bindings];
}
