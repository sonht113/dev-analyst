import ts from 'typescript';
import type { AnalysisConfidence, SourceReference } from '@devanalyst/core';
import type { SemanticModel } from './semantic.js';
import { conditionsOf, isFunction, literal, property, sourceOf, textOf, unwrap } from './syntax.js';
export interface TraceRoot {
  readonly expression: ts.Node;
  readonly subjectId: string;
  readonly source: ts.Node;
  readonly confidence: AnalysisConfidence;
  readonly edgeKind: 'handler' | 'calls' | 'callback';
}
export function extractStructure(model: SemanticModel): TraceRoot[] {
  const roots: TraceRoot[] = [];
  for (const sf of model.project.files.values()) {
    const stack: ts.Node[] = [sf];
    while (stack.length) {
      model.budget.check();
      const node = stack.pop();
      if (!node) break;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isArrayBindingPattern(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const name = model.reactCall(node.initializer);
        if (name === 'useState' || name === 'useReducer') {
          const names = node.name.elements
            .filter(ts.isBindingElement)
            .map((binding) => textOf(binding.name));
          const setter = node.name.elements[1];
          if (setter && ts.isBindingElement(setter)) {
            const symbol = model.symbol(setter.name);
            if (symbol) model.setters.set(symbol, names);
          }
          model.fact(
            node,
            {
              kind: 'state',
              operation: 'declaration',
              names,
              expression: textOf(node.initializer),
            },
            'VERIFIED',
            `Source destructures ${name}; current state values are not evaluated.`,
          );
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = textOf(node.tagName),
          parent = model.owner(node),
          child = /^[A-Z]/.test(tag) ? model.componentFor(node.tagName) : null;
        const subject = model.graphNode('element', node, tag);
        if (parent)
          model.edge(
            parent.id,
            child?.id ?? subject,
            'renders',
            node,
            child || /^[a-z]/.test(tag) ? 'VERIFIED' : 'UNKNOWN',
          );
        model.fact(
          node,
          { kind: 'relationship', parent: parent?.id ?? null, child: child?.id ?? null, tag },
          child || /^[a-z]/.test(tag) ? 'VERIFIED' : 'UNKNOWN',
          'This JSX source references an intrinsic element or component; rendered instances are not evaluated.',
          subject,
        );
        for (const condition of conditionsOf(node))
          model.fact(
            node,
            { kind: 'condition', expression: condition.expression, branch: condition.branch },
            'VERIFIED',
            `JSX occurs in the ${condition.branch} branch of (${condition.expression}); the condition value is not evaluated.`,
            subject,
          );
        for (
          let parent: ts.Node | undefined = node.parent;
          parent && !isFunction(parent);
          parent = parent.parent
        ) {
          if (ts.isSwitchStatement(parent) || ts.isDoStatement(parent))
            model.fact(
              parent.expression,
              { kind: 'condition', expression: textOf(parent.expression), branch: 'unknown' },
              'UNKNOWN',
              'Switch fallthrough or do-loop control needs additional flow evidence; no effective rendering predicate is claimed.',
              subject,
            );
        }
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(attribute)) {
            model.fact(
              attribute,
              { kind: 'prop', name: '...', expression: textOf(attribute.expression), spread: true },
              'UNKNOWN',
              'Spread prop names and effective values are not resolved.',
              subject,
            );
            continue;
          }
          const name = textOf(attribute.name),
            expression =
              attribute.initializer && ts.isJsxExpression(attribute.initializer)
                ? attribute.initializer.expression
                : attribute.initializer;
          const value = expression ? textOf(expression) : 'true';
          model.fact(
            attribute,
            { kind: 'prop', name, expression: value, spread: false },
            'VERIFIED',
            'Source supplies this prop expression; its runtime value is not evaluated.',
            subject,
          );
          if (child && expression && ts.isExpression(expression))
            model.propBindings.push({ component: child, name, expression, source: attribute });
          if (['hidden', 'aria-hidden', 'className', 'disabled', 'aria-disabled'].includes(name)) {
            const kind = name.includes('disabled') ? 'disabled' : 'visibility';
            model.fact(
              attribute,
              { kind, attribute: name, expression: value },
              name === 'className' ? 'UNKNOWN' : 'VERIFIED',
              name === 'className'
                ? 'CSS/class visibility requires stylesheet and runtime evidence.'
                : `${name} receives this expression. ${name.startsWith('aria-') ? 'ARIA state does not itself enforce visual visibility or native interaction blocking.' : 'The effective runtime condition is not evaluated.'}`,
              subject,
            );
          }
          if (name === 'style' && expression) {
            for (const key of ['display', 'visibility', 'opacity']) {
              const style = property(expression, key);
              if (style)
                model.fact(
                  style,
                  { kind: 'visibility', attribute: 'style.' + key, expression: textOf(style) },
                  'VERIFIED',
                  'Source assigns this visibility-related style expression; computed CSS and runtime visibility remain unknown.',
                  subject,
                );
            }
          }
          if (/^on[A-Z]/.test(name) && expression) {
            const target = model.target(expression);
            const targetId = target ? model.functionId(target.fn) : null;
            const nativeEvent = /^[a-z]/.test(tag) && !tag.includes('-');
            const certainty = target ? (nativeEvent ? target.confidence : 'INFERRED') : 'UNKNOWN';
            model.fact(
              attribute,
              { kind: 'handler', event: name, expression: value, targetId },
              certainty,
              target
                ? nativeEvent
                  ? 'Source associates this handler reference with the JSX event; no event execution is proven.'
                  : 'Source supplies an onX callback prop; component event semantics and invocation are unproven.'
                : 'Handler target needs runtime or additional dataflow evidence.',
              subject,
            );
            if (targetId)
              model.edge(
                subject,
                targetId,
                nativeEvent ? 'handler' : 'callback',
                attribute,
                certainty,
              );
            roots.push({
              expression,
              subjectId: subject,
              source: attribute,
              confidence: certainty,
              edgeKind: nativeEvent ? 'handler' : 'callback',
            });
          }
        }
        const origin = model.external(node.tagName);
        if (
          origin &&
          ['react-router', 'react-router-dom', '@tanstack/react-router'].includes(origin.module) &&
          ['Link', 'NavLink', 'Navigate'].includes(origin.member ?? origin.name)
        ) {
          const to = node.attributes.properties.find(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'to',
          );
          if (to && ts.isJsxAttribute(to)) {
            const expression =
              to.initializer && ts.isJsxExpression(to.initializer)
                ? to.initializer.expression
                : to.initializer;
            model.fact(
              to,
              {
                kind: 'navigation',
                mechanism: origin.module + ':' + (origin.member ?? origin.name),
                destination: literal(expression),
                expression: expression ? textOf(expression) : 'true',
              },
              literal(expression) !== null ? 'VERIFIED' : 'INFERRED',
              'Source declares a router destination; matching, guards and actual navigation are not evaluated.',
              subject,
            );
          }
        }
      }
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
  }
  return roots;
}
function axiosClient(
  model: SemanticModel,
  node: ts.Node,
  seen = new Set<ts.Symbol>(),
): { baseURL: string | null } | null {
  node = unwrap(node);
  const origin = model.external(node);
  if (origin?.module === 'axios') return { baseURL: null };
  const symbol = model.symbol(node);
  if (!symbol || seen.has(symbol) || seen.size > 8 || model.mutated.has(symbol)) return null;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      model.constant(declaration) &&
      declaration.initializer
    ) {
      const init = unwrap(declaration.initializer);
      if (ts.isCallExpression(init)) {
        const factory = model.external(init.expression);
        if (factory?.module === 'axios' && factory.member === 'create')
          return { baseURL: literal(property(init.arguments[0], 'baseURL')) };
      }
      return axiosClient(model, init, seen);
    }
  }
  return null;
}
function navigator(model: SemanticModel, node: ts.Node): string | null {
  node = unwrap(node);
  if (
    ts.isPropertyAccessExpression(node) &&
    ['push', 'replace', 'navigate'].includes(node.name.text)
  ) {
    const found = navigator(model, node.expression);
    return found ? found + '.' + node.name.text : null;
  }
  const symbol = model.symbol(node);
  if (!symbol || model.mutated.has(symbol)) return null;
  for (const decl of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(decl) &&
      model.constant(decl) &&
      decl.initializer &&
      ts.isCallExpression(decl.initializer)
    ) {
      const origin = model.external(decl.initializer.expression);
      if (
        origin &&
        ['react-router', 'react-router-dom', '@tanstack/react-router'].includes(origin.module) &&
        ['useNavigate', 'useHistory'].includes(origin.member ?? origin.name)
      )
        return origin.module + ':' + (origin.member ?? origin.name);
    }
  }
  return null;
}
export function classifyCall(
  model: SemanticModel,
  call: ts.CallExpression,
  trace?: { confidence: AnalysisConfidence; path: readonly SourceReference[] },
): boolean {
  const expression = unwrap(call.expression),
    name = textOf(expression),
    args = call.arguments;
  let recognized = false;
  const report = (...params: Parameters<SemanticModel['fact']>) => {
    recognized = true;
    return model.fact(params[0], params[1], params[2], params[3], params[4], trace);
  };
  const react = model.reactCall(call);
  const imported = model.external(expression);
  const localHook = model.target(expression);
  const hookName =
    react ??
    imported?.member ??
    imported?.name ??
    (localHook ? model.functionName(localHook.fn) : name);
  if (/^use[A-Z]/.test(hookName) && (react || imported || localHook)) {
    const known =
      !!react ||
      (!!imported &&
        ['react-router', 'react-router-dom', '@tanstack/react-router'].includes(imported.module));
    const dependencyHook =
      !!react &&
      ['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useCallback', 'useMemo'].includes(
        react,
      );
    const deps =
      dependencyHook && args[1] && ts.isArrayLiteralExpression(args[1])
        ? args[1].elements.map(textOf)
        : null;
    report(
      call,
      { kind: 'hook', name: hookName, dependencies: deps },
      known ? 'VERIFIED' : 'INFERRED',
      known
        ? 'Source references an imported hook API; callback execution and values are not evaluated.'
        : 'This function follows the useX hook naming convention; hook semantics are not proven.',
    );
    if (react && ['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(react))
      report(
        call,
        { kind: 'side-effect', operation: react, expression: textOf(call) },
        'VERIFIED',
        'Source registers an effect callback; execution, cleanup timing and dependency values are not evaluated.',
      );
  }
  const symbol = model.symbol(expression),
    state = symbol && !model.mutated.has(symbol) ? model.setters.get(symbol) : undefined;
  if (state)
    report(
      call,
      { kind: 'state', operation: 'update', names: state, expression: textOf(call) },
      'VERIFIED',
      'Source calls a setter/dispatch captured from a React state hook; the resulting state is not evaluated.',
    );
  const owner = model.owner(call);
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    expression.name.text === 'setState' &&
    owner &&
    ts.isClassDeclaration(owner.node)
  ) {
    const base = owner.node.heritageClauses
      ?.flatMap((clause) => [...clause.types])
      .find((type) => {
        const origin = model.external(type.expression);
        return (
          origin?.module === 'react' &&
          ['Component', 'PureComponent'].includes(origin.member ?? origin.name)
        );
      });
    if (base && !owner.node.members.some((member) => member.name?.getText() === 'setState'))
      report(
        call,
        { kind: 'state', operation: 'update', names: ['this.state'], expression: textOf(call) },
        'VERIFIED',
        'Source references the inherited React class state API; resulting state is not evaluated.',
      );
  }
  const globalFetch =
    (name === 'fetch' || name === 'window.fetch' || name === 'globalThis.fetch') &&
    model.global(expression);
  if (globalFetch) {
    const endpoint = literal(args[0]),
      options = args[1];
    const methodNode = property(options, 'method');
    const simpleOptions =
      !options ||
      (ts.isObjectLiteralExpression(options) &&
        !options.properties.some(
          (item) =>
            ts.isSpreadAssignment(item) ||
            (!!item.name &&
              (ts.isComputedPropertyName(item.name) ||
                item.name.getText().replace(/^['"]|['"]$/g, '') === 'method')),
        ));
    const method = methodNode
      ? (literal(methodNode)?.toUpperCase() ?? null)
      : endpoint !== null && simpleOptions
        ? 'GET'
        : null;
    report(
      call,
      {
        kind: 'api',
        client: 'fetch',
        method,
        endpoint,
        expression: args[0] ? textOf(args[0]) : '<missing>',
        baseURL: null,
      },
      endpoint !== null && method !== null ? 'VERIFIED' : 'INFERRED',
      'Source references fetch with this request expression; endpoint evaluation, interception and network execution are not proven.',
    );
  }
  const axios = ts.isPropertyAccessExpression(expression)
    ? axiosClient(model, expression.expression)
    : axiosClient(model, expression);
  if (axios) {
    const operation = ts.isPropertyAccessExpression(expression) ? expression.name.text : 'request';
    if (
      ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'].includes(operation)
    ) {
      const config = operation === 'request' ? args[0] : undefined;
      const endpoint = literal(config ? property(config, 'url') : args[0]);
      const method =
        operation === 'request'
          ? (literal(property(config, 'method'))?.toUpperCase() ?? null)
          : operation.toUpperCase();
      report(
        call,
        {
          kind: 'api',
          client: 'axios',
          method,
          endpoint,
          expression: config ? textOf(config) : args[0] ? textOf(args[0]) : '<missing>',
          baseURL: axios.baseURL,
        },
        endpoint !== null && method !== null ? 'VERIFIED' : 'INFERRED',
        'Source references Axios or an Axios-created client; baseURL and path are separate source literals, not a guaranteed runtime URL.',
      );
    }
  }
  const origin = model.external(expression),
    router =
      navigator(model, expression) ??
      (origin &&
      ['react-router', 'react-router-dom', '@tanstack/react-router'].includes(origin.module) &&
      ['redirect', 'navigate'].includes(origin.member ?? origin.name)
        ? origin.module + ':' + (origin.member ?? origin.name)
        : null);
  const native =
    /^(?:window\.)?(?:location\.(?:assign|replace)|history\.(?:pushState|replaceState))$/.test(
      name,
    ) && model.global(expression);
  if (router || native) {
    const argument = native && name.includes('State') ? args[2] : args[0];
    const destination = literal(argument) ?? literal(property(argument, 'to'));
    report(
      call,
      {
        kind: 'navigation',
        mechanism: router ?? name,
        destination,
        expression: argument ? textOf(argument) : '<missing>',
      },
      destination !== null ? 'VERIFIED' : 'INFERRED',
      'Source declares this navigation request; dynamic destinations, router guards and runtime navigation are not evaluated.',
    );
  }
  if (
    /^(?:(?:window\.|globalThis\.)?(?:setTimeout|setInterval|queueMicrotask)|(?:window|document)\.addEventListener|(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear))$/.test(
      name,
    ) &&
    model.global(expression)
  )
    report(
      call,
      { kind: 'side-effect', operation: name, expression: textOf(call) },
      'VERIFIED',
      'Source references this side-effect/scheduling API; actual execution is not guaranteed.',
    );
  return recognized;
}
export function extractCalls(model: SemanticModel): TraceRoot[] {
  const effects: TraceRoot[] = [];
  for (const call of model.calls) {
    model.budget.check();
    const recognized = classifyCall(model, call);
    if (!recognized) {
      const target = model.target(call.expression);
      const callId = model.graphNode('call', call, textOf(call.expression).slice(0, 96));
      const targetId = target ? model.functionId(target.fn) : null;
      model.fact(
        call,
        {
          kind: 'call',
          expression: textOf(call.expression),
          targetId,
          resolution: target
            ? target.confidence === 'VERIFIED'
              ? 'symbol'
              : 'candidate'
            : 'unresolved',
        },
        target?.confidence ?? 'UNKNOWN',
        target
          ? 'Source contains this statically resolved call reference; execution is not evaluated.'
          : 'Call target and side effects require external or runtime evidence.',
        callId,
      );
      if (targetId) model.edge(callId, targetId, 'calls', call, target?.confidence);
    }
    const localHook = model.target(call.expression);
    if (localHook && /^use[A-Z]/.test(model.functionName(localHook.fn)))
      effects.push({
        expression: call.expression,
        subjectId: model.graphNode('call', call, textOf(call.expression).slice(0, 96)),
        source: call,
        confidence: localHook.confidence,
        edgeKind: 'calls',
      });
    const hook = model.reactCall(call);
    if (
      hook &&
      ['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(hook) &&
      call.arguments[0]
    )
      effects.push({
        expression: call.arguments[0],
        subjectId: model.graphNode('call', call, textOf(call.expression)),
        source: call,
        confidence: 'VERIFIED',
        edgeKind: 'callback',
      });
  }
  for (const sf of model.project.files.values()) {
    const stack: ts.Node[] = [sf];
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      model.budget.check();
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        /^(?:window\.)?location\.(?:href|pathname)$/.test(textOf(node.left)) &&
        model.global(node.left)
      )
        model.fact(
          node,
          {
            kind: 'navigation',
            mechanism: textOf(node.left),
            destination: literal(node.right),
            expression: textOf(node.right),
          },
          literal(node.right) !== null ? 'VERIFIED' : 'INFERRED',
          'Source assigns this location expression; actual browser navigation is not evaluated.',
        );
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
  }
  return effects;
}
export function traceRoots(model: SemanticModel, roots: readonly TraceRoot[]): void {
  let visits = 0;
  function follow(
    expression: ts.Node,
    from: string,
    path: readonly SourceReference[],
    seen: Set<ts.FunctionLikeDeclaration>,
    confidence: AnalysisConfidence,
    depth: number,
    edgeSource: ts.Node,
    edgeKind: 'handler' | 'calls' | 'callback' = 'calls',
  ): void {
    model.budget.check();
    if (++visits > model.budget.limits.maxGraphEdges * 2) {
      model.diagnostic('TRACE_WORK_LIMIT', 'Bounded call tracing stopped.', edgeSource);
      return;
    }
    if (depth > model.budget.limits.maxDepth) {
      model.diagnostic('CALL_DEPTH_LIMIT', 'Call trace exceeded its configured depth.', edgeSource);
      return;
    }
    expression = unwrap(expression);
    if (ts.isConditionalExpression(expression)) {
      for (const branch of [expression.whenTrue, expression.whenFalse])
        follow(
          branch,
          from,
          [...path, sourceOf(expression.condition)],
          new Set(seen),
          'INFERRED',
          depth + 1,
          edgeSource,
          'callback',
        );
      return;
    }
    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expression.operatorToken.kind)
    ) {
      for (const branch of [expression.left, expression.right])
        follow(branch, from, path, new Set(seen), 'INFERRED', depth + 1, edgeSource, 'callback');
      return;
    }
    const target = model.target(expression);
    if (!target) {
      const candidates = model.propCandidates(expression);
      if (candidates.length) {
        for (const candidate of candidates) {
          const source = model.graphNode(
            'element',
            candidate.source,
            'callback prop ' + candidate.name,
          );
          model.edge(from, source, 'callback', candidate.source, 'INFERRED');
          follow(
            candidate.expression,
            source,
            [...path, sourceOf(candidate.source)],
            new Set(seen),
            'INFERRED',
            depth + 1,
            candidate.source,
          );
        }
        return;
      }
      model.fact(
        edgeSource,
        { kind: 'call', expression: textOf(expression), targetId: null, resolution: 'unresolved' },
        'UNKNOWN',
        'Callable target is external, dynamic, mutable, declaration-only or outside the permitted source graph.',
        from,
        { confidence: 'UNKNOWN', path },
      );
      return;
    }
    const id = model.functionId(target.fn);
    const certainty: AnalysisConfidence =
      confidence === 'VERIFIED' && target.confidence === 'VERIFIED' ? 'VERIFIED' : 'INFERRED';
    model.edge(from, id, edgeKind, edgeSource, certainty);
    model.fact(
      edgeSource,
      {
        kind: 'call',
        expression: textOf(expression),
        targetId: id,
        resolution: certainty === 'VERIFIED' ? 'symbol' : 'candidate',
      },
      certainty,
      'Source resolves this static function reference; invocation and path feasibility are not proven.',
      from,
      { confidence: certainty, path },
    );
    if (seen.has(target.fn)) {
      model.diagnostic(
        'CALL_CYCLE',
        'Recursive call edge retained; traversal stopped at the cycle.',
        edgeSource,
      );
      return;
    }
    seen.add(target.fn);
    const next = [...path, sourceOf(target.fn)];
    const stack: ts.Node[] = target.fn.body ? [target.fn.body] : [];
    while (stack.length) {
      model.budget.check();
      const node = stack.pop();
      if (!node) break;
      if (isFunction(node)) continue;
      if (ts.isCallExpression(node)) {
        const trace = { confidence: certainty, path: [...next, sourceOf(node)] };
        const callId = model.graphNode('call', node, textOf(node.expression).slice(0, 96));
        model.edge(id, callId, 'calls', node, certainty);
        const recognized = classifyCall(model, node, trace);
        const local = model.target(node.expression);
        if (local)
          follow(node.expression, callId, trace.path, new Set(seen), certainty, depth + 1, node);
        else if (!recognized)
          follow(node.expression, callId, trace.path, new Set(seen), certainty, depth + 1, node);
      }
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });
    }
  }
  for (const root of roots)
    follow(
      root.expression,
      root.subjectId,
      [sourceOf(root.source)],
      new Set(),
      root.confidence === 'UNKNOWN' ? 'INFERRED' : root.confidence,
      0,
      root.source,
      root.edgeKind,
    );
}
