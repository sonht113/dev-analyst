import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createWorkspaceAccess, type WorkspaceAccess } from '@devanalyst/analyzer';
import { evidenceSchema, findingSchema, type Finding } from '@devanalyst/core';
import type { ExplanationRequest } from './contracts.js';
import { aiError, type Options } from './options.js';
import type { Deadline } from './process.js';
import { responseJsonSchema, systemPrompt } from './protocol.js';

const uiTextSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      text: z.string().trim().min(1).max(500),
    }),
  )
  .max(16);
const nodeIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const staticRelationSchema = z.object({
  kind: z.enum([
    'component',
    'prop',
    'relationship',
    'condition',
    'visibility',
    'disabled',
    'handler',
    'call',
    'hook',
    'state',
    'navigation',
    'api',
    'side-effect',
  ]),
  targetId: nodeIdSchema.nullable().optional(),
  parent: nodeIdSchema.nullable().optional(),
  child: nodeIdSchema.nullable().optional(),
});
const conditionsSchema = z
  .array(
    z.strictObject({
      expression: z.string().min(1).max(2048),
      branch: z.enum(['truthy', 'falsy', 'nullish', 'non-nullish', 'iteration', 'unknown']),
      evidence: evidenceSchema,
    }),
  )
  .max(16);
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk-(?:ant-|proj-)?[\w-]{16,}|gh[pousr]_[\w]{20,}|github_pat_[\w_]{20,}|AKIA[A-Z0-9]{16})\b/,
  /\bBearer\s+[a-zA-Z0-9._~+/-]{8,}/i,
  /\b(?:password|passwd|secret|credentials?|token|client[_-]?secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization)\b['"`]?\s*[:=]\s*(?:['"`][^'"`\r\n]{3,}['"`]|[0-9]{3,}\b)/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
];
export function sensitiveText(value: string): boolean {
  return secretPatterns.some((pattern) => pattern.test(value));
}
function sensitivePath(file: string): boolean {
  return (
    /(?:^|\/)(?:\.claude|\.codex|\.agents|\.aws|\.azure|\.gcloud)(?:\/|$)/i.test(file) ||
    /(?:^|[/._-])(?:secrets?|credentials?|passwords?|tokens?)(?:[/._-]|$)/i.test(file) ||
    !/\.[cm]?[jt]sx?$/i.test(file)
  );
}
export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
function offset(text: string, position: { line: number; column: number }): number | null {
  const lines = text.split('\n');
  const line = lines[position.line - 1];
  if (line === undefined || position.column > line.length + 1) return null;
  let result = position.column - 1;
  for (let index = 0; index < position.line - 1; index++) result += (lines[index]?.length ?? 0) + 1;
  return result;
}
export interface PreparedContext {
  readonly prompt: string;
  readonly tokenUpperBound: number;
  readonly evidence: ReadonlyMap<string, Finding>;
  readonly uiText: ReadonlyMap<string, string>;
  readonly snapshots: ReadonlyMap<string, string>;
  readonly access: WorkspaceAccess;
}
export async function prepareContext(
  options: Options,
  request: ExplanationRequest,
  deadline: Deadline,
): Promise<PreparedContext> {
  if (
    !Array.isArray(request.evidence) ||
    request.evidence.length > options.maxFindings ||
    !['shallow', 'standard', 'deep'].includes(request.depth) ||
    typeof request.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)
  )
    throw aiError('AI_CONTEXT_REJECTED');
  const ui = uiTextSchema.safeParse(request.uiText ?? []);
  if (!ui.success || new Set(ui.data.map((item) => item.id)).size !== ui.data.length)
    throw aiError('AI_CONTEXT_REJECTED');
  const question =
    request.question ??
    'Giải thích mục đích, điều kiện hiển thị và hành vi theo bằng chứng nguồn; dịch UI tiếng Nhật sang tiếng Việt nếu có.';
  if (
    typeof question !== 'string' ||
    question.length > 2000 ||
    sensitiveText(question) ||
    ui.data.some((item) => sensitiveText(item.text))
  )
    throw aiError('AI_CONTEXT_REJECTED');
  if (!request.evidence.length && !ui.data.length) throw aiError('AI_CONTEXT_REJECTED');
  deadline.check();
  const access = await createWorkspaceAccess(options.workspaceRoot, options.source);
  const aiAccess = await createWorkspaceAccess(options.workspaceRoot, {
    include: options.ai.permittedPaths,
    exclude: options.source.exclude,
  });
  const snapshots = new Map<string, string>(),
    evidence = new Map<string, Finding>();
  const facts: Record<string, unknown>[] = [];
  let sourceBytes = 0;
  for (const raw of request.evidence) {
    deadline.check();
    // Project only the public base contract; never serialize arbitrary extra fields/runtime values.
    if (typeof raw !== 'object' || raw === null) throw aiError('AI_CONTEXT_REJECTED');
    const parsed = findingSchema.safeParse({
      id: raw.id,
      type: raw.type,
      confidence: raw.confidence,
      explanation: raw.explanation,
      evidence: raw.evidence,
      analyzedAt: raw.analyzedAt,
      cacheStatus: raw.cacheStatus,
    });
    if (
      !parsed.success ||
      parsed.data.cacheStatus === 'stale' ||
      !parsed.data.evidence ||
      evidence.has(parsed.data.id)
    )
      throw aiError('AI_CONTEXT_REJECTED');
    const finding = parsed.data,
      reference = parsed.data.evidence.source;
    if (sensitivePath(reference.file) || !reference.start || !reference.end)
      throw aiError('AI_CONTEXT_REJECTED');
    let text = snapshots.get(reference.file);
    if (text === undefined) {
      const canonical = await aiAccess.canonicalSourcePath(
        resolve(options.workspaceRoot, reference.file),
      );
      if (snapshots.size >= options.maxFiles || !canonical || sensitivePath(canonical))
        throw aiError('AI_CONTEXT_REJECTED');
      text = await access.readSource(reference.file);
      sourceBytes += Buffer.byteLength(text);
      if (sourceBytes > options.maxSourceBytes || sensitiveText(text))
        throw aiError('AI_CONTEXT_REJECTED');
      const expected = request.sourceHashes?.[reference.file];
      if (
        typeof expected !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expected) ||
        hash(text) !== expected
      )
        throw aiError('AI_CONTEXT_REJECTED');
      snapshots.set(reference.file, text);
    }
    const start = offset(text, reference.start),
      end = offset(text, reference.end);
    if (
      start === null ||
      end === null ||
      end <= start ||
      parsed.data.evidence.code.length > 2048 ||
      text.slice(start, end).slice(0, 2048).trim() !== parsed.data.evidence.code
    )
      throw aiError('AI_CONTEXT_REJECTED');
    evidence.set(finding.id, finding);
    const conditions = conditionsSchema.safeParse('conditions' in raw ? raw.conditions : []);
    if (!conditions.success) throw aiError('AI_CONTEXT_REJECTED');
    for (const condition of conditions.data) {
      const location = condition.evidence.source;
      if (location.file !== reference.file || !location.start || !location.end)
        throw aiError('AI_CONTEXT_REJECTED');
      const from = offset(text, location.start),
        to = offset(text, location.end);
      if (
        from === null ||
        to === null ||
        to <= from ||
        text.slice(from, to).slice(0, 2048).trim() !== condition.evidence.code ||
        condition.expression.trim() !== condition.evidence.code
      )
        throw aiError('AI_CONTEXT_REJECTED');
    }
    const relation = 'detail' in raw ? staticRelationSchema.safeParse(raw.detail) : null;
    const subject = 'subjectId' in raw ? nodeIdSchema.safeParse(raw.subjectId) : null;
    if ((relation && !relation.success) || (subject && !subject.success))
      throw aiError('AI_CONTEXT_REJECTED');
    facts.push({
      id: finding.id,
      type: finding.type,
      confidence: finding.confidence,
      execution: 'not-evaluated',
      source: reference,
      code: finding.evidence?.code,
      subjectId: subject?.success ? subject.data : null,
      relation: relation?.success ? relation.data : null,
      conditions: conditions.data,
    });
  }
  const payload = {
    language: 'vi',
    depth: request.depth,
    question,
    deterministicFindings: facts,
    uiText: ui.data,
  };
  const prompt = JSON.stringify(payload);
  const contextBytes = Buffer.byteLength(prompt);
  // Conservative byte-based ceiling for caller-supplied content, NOT a tokenizer or the CLI's hidden overhead.
  const tokenUpperBound = Buffer.byteLength(prompt + systemPrompt + responseJsonSchema);
  if (
    contextBytes > options.maxContextBytes ||
    tokenUpperBound > options.maxInputTokens ||
    tokenUpperBound + options.maxOutputTokens > options.maxTotalTokens
  )
    throw aiError('AI_BUDGET_EXCEEDED');
  deadline.check();
  return {
    prompt,
    tokenUpperBound,
    evidence,
    snapshots,
    access,
    uiText: new Map(ui.data.map((item) => [item.id, item.text])),
  };
}
export async function verifySnapshots(context: PreparedContext, deadline: Deadline): Promise<void> {
  for (const [file, text] of context.snapshots) {
    deadline.check();
    if (hash(await context.access.readSource(file)) !== hash(text)) throw aiError('SOURCE_CHANGED');
  }
}
