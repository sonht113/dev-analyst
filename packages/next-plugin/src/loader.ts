import { createHash } from 'node:crypto';
import { relative, isAbsolute } from 'node:path';
import { requestCompiler } from '@sonht113/server/compiler';
interface LoaderContext {
  readonly resourcePath: string;
  getOptions(): unknown;
  async(): (error: Error | null, code?: string, map?: object) => void;
}
/** Public Webpack/Turbopack loader subset only; application source never executes in this process. */
export default function loader(this: LoaderContext, code: string, inputMap?: object): void {
  const done = this.async();
  const options = this.getOptions();
  if (
    typeof options !== 'object' ||
    options === null ||
    !('socket' in options) ||
    typeof options.socket !== 'string' ||
    !('workspaceRoot' in options) ||
    typeof options.workspaceRoot !== 'string'
  ) {
    done(null, code, inputMap);
    return;
  }
  const file = relative(options.workspaceRoot, this.resourcePath).replaceAll('\\', '/');
  if (isAbsolute(file) || file.startsWith('../') || !file || !code.includes('use client')) {
    done(null, code, inputMap);
    return;
  }
  void requestCompiler(options.socket, file, createHash('sha256').update(code).digest('hex')).then(
    (result) => {
      if (!result) {
        done(null, code, inputMap);
        return;
      }
      // Bundle the browser-safe public runtime; an absolute HTTP module specifier is not a Next module.
      const output = result.code.replaceAll(
        '"/__devanalyst/mapping-runtime.js"',
        '"@sonht113/next-plugin/mapping-runtime"',
      );
      done(null, output, result.map ?? inputMap);
    },
    () => done(null, code, inputMap),
  );
}
