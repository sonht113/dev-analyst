import { workspacePathSchema } from '@devanalyst/core';
/** Heuristic for source/provider secrets; runtime data fields are excluded by the closed payload schema. */
export function safePersistence(value: string): boolean {
  return !/(?:[?&](?:token|access_token|api[_-]?key|password|secret)=[^&\s"'<>]{3,}|data-(?:devanalyst-)?private|<input[^>]*type\s*=\s*["']password["']|(?:defaultValue|defaultChecked)\s*=\s*["'][^"']+["']|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk)-(?:ant-)?[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*["'][^"']{4,}|https?:\/\/[^\s/]+:[^\s/]+@)/i.test(
    value,
  );
}
export function safeRelativeFile(file: string): boolean {
  return (
    workspacePathSchema.safeParse(file).success &&
    !file.includes('\\') &&
    !file
      .split('/')
      .some((part) =>
        /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|node_modules|\.npmrc|\.netrc)$/i.test(part),
      ) &&
    !/\.(?:pem|key|p12|pfx)$/i.test(file)
  );
}
