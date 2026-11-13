import { randomUUID } from 'node:crypto';
import type {
  InspectorItem,
  MappingSite,
  StaticAnalysisResult,
  StaticAnalysisFinding,
  SourceReference,
} from '@devanalyst/core';
import { isSafeCacheContent } from '@devanalyst/cache';
function contains(source: SourceReference, point: SourceReference): boolean {
  const start = source.start,
    end = source.end,
    p = point.start;
  return (
    source.file === point.file &&
    !!start &&
    !!end &&
    !!p &&
    (start.line < p.line || (start.line === p.line && start.column <= p.column)) &&
    (end.line > p.line || (end.line === p.line && end.column > p.column))
  );
}
export function selectInspection(
  result: StaticAnalysisResult,
  site: MappingSite,
): { items: InspectorItem[]; findings: StaticAnalysisFinding[]; limited: boolean } {
  const candidates = result.graph.nodes.filter(
    (node) => node.kind === 'element' && node.source && contains(node.source, site.source),
  );
  candidates.sort((a, b) => {
    const size = (s: SourceReference | null) =>
      s?.start && s.end
        ? (s.end.line - s.start.line) * 1000000 + s.end.column - s.start.column
        : Number.MAX_SAFE_INTEGER;
    return size(a.source) - size(b.source);
  });
  const root = candidates[0];
  if (!root)
    return {
      items: [
        {
          id: randomUUID(),
          group: 'limitation',
          title: 'Source scope',
          description:
            'No supported AST subject matched this JSX origin. Behavior remains unknown.',
          confidence: 'UNKNOWN',
          evidence: null,
          trace: [],
          analyzedAt: new Date().toISOString(),
          cacheStatus: 'miss',
        },
      ],
      findings: [],
      limited: true,
    };
  const reached = new Map<string, { ids: string[]; confidence: InspectorItem['confidence'] }>([
    [root.id, { ids: [root.id], confidence: 'VERIFIED' }],
  ]);
  const adjacency = new Map<string, (typeof result.graph.edges)[number][]>();
  for (const edge of result.graph.edges) {
    if (!['handler', 'calls', 'callback'].includes(edge.kind)) continue;
    const edges = adjacency.get(edge.from) ?? [];
    edges.push(edge);
    adjacency.set(edge.from, edges);
  }
  const nodes = new Map(result.graph.nodes.map((node) => [node.id, node]));
  const pending = [root.id];
  const lower = (
    a: InspectorItem['confidence'],
    b: InspectorItem['confidence'],
  ): InspectorItem['confidence'] =>
    a === 'UNKNOWN' || b === 'UNKNOWN'
      ? 'UNKNOWN'
      : a === 'INFERRED' || b === 'INFERRED'
        ? 'INFERRED'
        : 'VERIFIED';
  let limited = false;
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (!id) continue;
    const path = reached.get(id);
    if (!path) continue;
    for (const edge of adjacency.get(id) ?? []) {
      if (reached.has(edge.to)) continue;
      if (reached.size >= 160 || path.ids.length >= 12) {
        limited = true;
        continue;
      }
      reached.set(edge.to, {
        ids: [...path.ids, edge.to],
        confidence: lower(path.confidence, edge.confidence),
      });
      pending.push(edge.to);
    }
  }
  const findings = result.findings
    .filter((finding) => reached.has(finding.subjectId))
    .map((finding) => {
      const path = reached.get(finding.subjectId);
      return {
        ...finding,
        traces: path
          ? [
              {
                confidence: path.confidence,
                path: path.ids
                  .flatMap((id) => {
                    const source = nodes.get(id)?.source;
                    return source ? [source] : [];
                  })
                  .slice(0, 8),
              },
            ]
          : [],
      };
    });
  const items: InspectorItem[] = [];
  const groups: Record<StaticAnalysisFinding['detail']['kind'], InspectorItem['group']> = {
    component: 'purpose',
    prop: 'purpose',
    relationship: 'purpose',
    condition: 'visibility',
    visibility: 'visibility',
    disabled: 'disabled',
    handler: 'handler',
    call: 'call',
    hook: 'state',
    state: 'state',
    navigation: 'navigation',
    api: 'api',
    'side-effect': 'effect',
  };
  for (const finding of findings.slice(0, 80)) {
    const detail = finding.detail;
    const title =
      detail.kind === 'handler'
        ? `${detail.event}: ${detail.expression}`
        : detail.kind === 'call'
          ? detail.expression
          : detail.kind === 'api'
            ? `${detail.method ?? 'UNKNOWN method'} ${detail.endpoint ?? 'UNKNOWN endpoint'}`
            : detail.kind === 'navigation'
              ? `${detail.mechanism}: ${detail.destination ?? 'UNKNOWN destination'}`
              : detail.kind === 'condition'
                ? `${detail.branch}: ${detail.expression}`
                : 'expression' in detail
                  ? detail.expression
                  : 'name' in detail
                    ? detail.name
                    : detail.kind;
    const path = reached.get(finding.subjectId);
    const chain = path?.ids
      .map((id) => nodes.get(id)?.name ?? 'UNKNOWN')
      .join(' → ')
      .slice(0, 500);
    const description = `${chain && ['call', 'handler', 'api', 'navigation', 'state'].includes(detail.kind) ? 'Source path: ' + chain + '\n' : ''}${finding.explanation}`;
    const safe =
      isSafeCacheContent(description) &&
      isSafeCacheContent(title) &&
      isSafeCacheContent(finding.explanation) &&
      (!finding.evidence || isSafeCacheContent(finding.evidence.code));
    items.push({
      id: finding.id,
      group: safe ? groups[detail.kind] : 'limitation',
      title: safe ? title.slice(0, 160) : 'Private evidence omitted',
      description: safe
        ? description.slice(0, 2000)
        : 'This source context is excluded from inspector disclosure. Behavior remains unknown.',
      confidence: safe ? lower(finding.confidence, path?.confidence ?? 'UNKNOWN') : 'UNKNOWN',
      evidence:
        safe && finding.evidence
          ? { source: finding.evidence.source, code: finding.evidence.code.slice(0, 768) }
          : null,
      trace: safe ? (finding.traces[0]?.path ?? []).slice(0, 8) : [],
      analyzedAt: finding.analyzedAt,
      cacheStatus: finding.cacheStatus,
    });
    for (const condition of finding.conditions.slice(0, 4)) {
      if (
        items.some(
          (item) => item.group === 'visibility' && item.description === condition.expression,
        )
      )
        continue;
      if (isSafeCacheContent(condition.expression) && isSafeCacheContent(condition.evidence.code))
        items.push({
          id: randomUUID(),
          group: 'visibility',
          title: `${condition.branch} guard`,
          description: condition.expression,
          confidence: 'VERIFIED',
          evidence: {
            source: condition.evidence.source,
            code: condition.evidence.code.slice(0, 768),
          },
          trace: [],
          analyzedAt: finding.analyzedAt,
          cacheStatus: finding.cacheStatus,
        });
    }
    if (items.length >= 80) {
      limited = true;
      break;
    }
  }
  const safeFindings = findings.filter(
    (finding) =>
      finding.evidence &&
      isSafeCacheContent(finding.evidence.code) &&
      isSafeCacheContent(finding.explanation),
  );
  return {
    items: items.slice(0, 80),
    findings: safeFindings,
    limited: limited || findings.length > 80,
  };
}
