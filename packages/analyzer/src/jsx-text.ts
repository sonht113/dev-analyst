import ts from 'typescript';
import type { Evidence, SourceReference } from '@devanalyst/core';
export interface JSXInspectionOrigin {
  readonly siteId: string;
  readonly private: boolean;
  readonly literal: { readonly text: string; readonly evidence: Evidence } | null;
}
/** Static text only. Expressions, custom components, controls and private ancestors fail closed. */
export function inspectJSXText(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ast: ts.SourceFile,
  siteId: string,
  source: (node: ts.Node) => SourceReference,
): JSXInspectionOrigin {
  function excluded(opening: ts.JsxOpeningLikeElement): boolean {
    const tag = opening.tagName.getText(ast);
    return (
      /^(?:input|textarea|select|option|script|style|template|noscript)$/.test(tag) ||
      opening.attributes.properties.some(
        (property) =>
          ts.isJsxAttribute(property) &&
          ['data-private', 'data-devanalyst-private', 'contentEditable'].includes(
            property.name.getText(ast),
          ),
      )
    );
  }
  for (let parent: ts.Node | undefined = node; parent; parent = parent.parent) {
    if (
      ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
        excluded(parent)) ||
      (ts.isJsxElement(parent) && excluded(parent.openingElement))
    )
      return { siteId, private: true, literal: null };
  }
  const fragments: string[] = [];
  let count = 0,
    valid = true;
  function decode(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_all, name: string) => {
      const known: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      if (!name.startsWith('#')) return known[name.toLowerCase()] ?? '';
      const code = name.toLowerCase().startsWith('#x')
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      return code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    });
  }
  function visit(child: ts.Node): void {
    if (++count > 100) {
      valid = false;
      return;
    }
    if (ts.isJsxText(child)) {
      fragments.push(decode(child.getText(ast)));
      return;
    }
    if (ts.isJsxExpression(child)) {
      if (!child.expression) return;
      if (ts.isStringLiteralLike(child.expression)) {
        fragments.push(child.expression.text);
        return;
      }
      valid = false;
      return;
    }
    if (ts.isJsxElement(child)) {
      if (
        excluded(child.openingElement) ||
        !/^[a-z][a-zA-Z0-9]*$/.test(child.openingElement.tagName.getText(ast))
      ) {
        valid = false;
        return;
      }
      child.children.forEach(visit);
      return;
    }
    if (ts.isJsxSelfClosingElement(child)) {
      valid = false;
      return;
    }
    valid = false;
  }
  const subject = ts.isJsxOpeningElement(node) ? node.parent : node;
  if (ts.isJsxElement(subject)) subject.children.forEach(visit);
  let text = fragments
    .map((fragment) => fragment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  if (!text)
    for (const name of ['aria-label', 'alt', 'title']) {
      const property = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.getText(ast) === name,
      );
      if (
        property &&
        ts.isJsxAttribute(property) &&
        property.initializer &&
        ts.isStringLiteral(property.initializer)
      ) {
        text = property.initializer.text;
        break;
      }
    }
  text = text.replace(/\s+/g, ' ').trim();
  const code = subject.getText(ast);
  return {
    siteId,
    private: false,
    literal:
      valid && text.length > 0 && text.length <= 500 && code.length <= 2048
        ? { text, evidence: { source: source(subject), code } }
        : null,
  };
}
