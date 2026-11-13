import { parentPort } from 'node:worker_threads';
import { createStaticAnalyzer } from './engine.js';
import { analyzerOptionsSchema, analysisSourcesSchema } from './analysis-options.js';

// Only the parent supplies configuration. Validate it again at the worker boundary.
parentPort?.once('message', async (input: unknown) => {
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      !('options' in input) ||
      !('sources' in input)
    )
      throw new Error('Invalid worker request');
    const engine = createStaticAnalyzer(analyzerOptionsSchema.parse(input.options));
    const result = await engine.analyzeDetailed({
      requestId: 'page-worker',
      sources: analysisSourcesSchema.parse(input.sources),
    });
    if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
      throw new Error('Result limit');
    parentPort?.postMessage({ result });
  } catch {
    parentPort?.postMessage({ error: 'ANALYSIS_FAILED' });
  }
});
