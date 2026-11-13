import { Worker } from 'node:worker_threads';
import { DevAnalystError, type StaticAnalysisResult } from '@devanalyst/core';
import type { AnalysisRequest } from './index.js';
import {
  analyzerOptionsSchema,
  analysisSourcesSchema,
  type StaticAnalyzerOptions,
} from './analysis-options.js';

/** One bounded, disposable worker per admitted job. Cancellation terminates CPU-bound AST work. */
export function createWorkerAnalyzer(input: StaticAnalyzerOptions) {
  const options = analyzerOptionsSchema.parse(input);
  return {
    analyzeDetailed(request: AnalysisRequest): Promise<StaticAnalysisResult> {
      const sources = analysisSourcesSchema.parse(request.sources);
      return new Promise((resolve, reject) => {
        if (request.signal?.aborted) {
          reject(new DevAnalystError('CANCELLED', 'Page analysis cancelled.'));
          return;
        }
        const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), {
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
        });
        let settled = false;
        const finish = (
          result?: StaticAnalysisResult,
          code: 'CANCELLED' | 'INTERNAL_ERROR' = 'INTERNAL_ERROR',
        ) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request.signal?.removeEventListener('abort', cancel);
          // Keep the scheduler slot until termination has released worker resources.
          void worker.terminate().then(
            () => {
              if (result) resolve({ ...result, requestId: request.requestId });
              else
                reject(
                  new DevAnalystError(
                    code,
                    'Page analysis stopped; retry after checking source and resource limits.',
                  ),
                );
            },
            () => reject(new DevAnalystError('INTERNAL_ERROR', 'Analysis worker cleanup failed.')),
          );
        };
        const cancel = () => finish(undefined, 'CANCELLED');
        const timer = setTimeout(() => finish(), options.limits.timeoutMs + 5000);
        request.signal?.addEventListener('abort', cancel, { once: true });
        worker.once('error', () => finish());
        worker.once('exit', () => finish());
        worker.once('message', (value: { result?: StaticAnalysisResult }) => {
          // Trusted child executes only this package's entry point, never application modules.
          finish(value.result);
        });
        worker.postMessage({ options, sources });
      });
    },
  };
}
