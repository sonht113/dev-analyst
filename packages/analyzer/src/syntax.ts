import ts from 'typescript';
import type { Evidence, SourceReference, StaticCondition } from '@devanalyst/core';
export const virtualRoot = '/__devanalyst_workspace__/';
export function sourceOf(node: ts.Node): SourceReference {
  const sf = node.getSourceFile();
  const a = sf.getLineAndCharacterOfPosition(node.getStart(sf)),
    b = sf.getLineAndCharacterOfPosition(node.end);
  return {
    file: sf.fileName.slice(virtualRoot.length),
    start: { line: a.line + 1, column: a.character + 1 },
    end: { line: b.line + 1, column: b.character + 1 },
  };
}
export function textOf(node: ts.Node): string {
  return node.getText(node.getSourceFile()).slice(0, 2048);
}
export function evidenceOf(node: ts.Node): Evidence {
  return { source: sourceOf(node), code: textOf(node).trim() || '<empty source>' };
}
export function unwrap(node: ts.Node): ts.Node {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}
export function literal(node: ts.Node | undefined): string | null {
  if (!node) return null;
  node = unwrap(node);
  return ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}
export function property(node: ts.Node | undefined, name: string): ts.Expression | undefined {
  if (!node) return undefined;
  node = unwrap(node);
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  for (let index = node.properties.length - 1; index >= 0; index--) {
    const item = node.properties[index];
    if (!item) continue;
    if (ts.isSpreadAssignment(item) || (item.name && ts.isComputedPropertyName(item.name)))
      return undefined;
    if (!item.name || item.name.getText().replace(/^['"]|['"]$/g, '') !== name) continue;
    if (ts.isPropertyAssignment(item)) return item.initializer;
    if (ts.isShorthandPropertyAssignment(item)) return item.name;
    return undefined;
  }
  return undefined;
}
export function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}
function contains(parent: ts.Node, child: ts.Node) {
  return parent.pos <= child.pos && parent.end >= child.end;
}
function terminates(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const last = statement.statements.at(-1);
    return !!last && terminates(last);
  }
  return false;
}
/** Branch syntax/dominators only; never evaluates conditions or predicts current visibility. */
export function conditionsOf(node: ts.Node): StaticCondition[] {
  const result: StaticCondition[] = [];
  const add = (expression: ts.Expression, branch: StaticCondition['branch']) => {
    if (result.length < 16)
      result.push({ expression: textOf(expression), branch, evidence: evidenceOf(expression) });
  };
  for (
    let current: ts.Node | undefined = node.parent;
    current && !ts.isSourceFile(current);
    current = current.parent
  ) {
    if (isFunction(current)) break;
    if (ts.isIfStatement(current)) {
      if (contains(current.thenStatement, node)) add(current.expression, 'truthy');
      else if (current.elseStatement && contains(current.elseStatement, node))
        add(current.expression, 'falsy');
    }
    if (ts.isConditionalExpression(current)) {
      if (contains(current.whenTrue, node)) add(current.condition, 'truthy');
      else if (contains(current.whenFalse, node)) add(current.condition, 'falsy');
    }
    if (ts.isBinaryExpression(current) && contains(current.right, node)) {
      const kind = current.operatorToken.kind;
      if (kind === ts.SyntaxKind.AmpersandAmpersandToken) add(current.left, 'truthy');
      if (kind === ts.SyntaxKind.BarBarToken) add(current.left, 'falsy');
      if (kind === ts.SyntaxKind.QuestionQuestionToken) add(current.left, 'nullish');
    }
    if (ts.isWhileStatement(current) && contains(current.statement, node))
      add(current.expression, 'truthy');
    if (ts.isForStatement(current) && current.condition && contains(current.statement, node))
      add(current.condition, 'truthy');
    if (
      (ts.isForOfStatement(current) || ts.isForInStatement(current)) &&
      contains(current.statement, node)
    )
      add(current.expression, 'iteration');
    if (ts.isBlock(current))
      for (const statement of current.statements) {
        if (statement.pos >= node.pos || contains(statement, node)) break;
        if (ts.isIfStatement(statement)) {
          if (terminates(statement.thenStatement) && !statement.elseStatement)
            add(statement.expression, 'falsy');
          else if (
            statement.elseStatement &&
            terminates(statement.elseStatement) &&
            !terminates(statement.thenStatement)
          )
            add(statement.expression, 'truthy');
        }
      }
  }
  return result;
}
