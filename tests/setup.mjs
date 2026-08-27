import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Preloaded before the test files.
 *
 * Several modules start with `import 'server-only'`, which is a marker Next's
 * bundler understands and npm has never installed -- so importing them outside
 * Next fails to resolve. This maps that one specifier to an empty module so the
 * real source can be tested as written, rather than tests running against a
 * stripped copy that could drift from it.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' || specifier === 'client-only') {
      return { url: 'data:text/javascript,export{}', shortCircuit: true };
    }
    // The app uses the @/ alias that tsconfig maps to src/. Node does not read
    // tsconfig, so the same mapping is applied here rather than tests having to
    // import server modules by relative path.
    // The app writes imports the way a bundler resolves them: the @/ alias that
    // tsconfig maps to src/, and relative paths with no file extension. Node
    // requires an extension and knows nothing about tsconfig, so both are
    // resolved here, trying extensions in the order TypeScript would.
    const EXTS = ['.ts', '.tsx', '.mts', '.js'];
    const tryExts = (baseUrl) => {
      for (const ext of EXTS) {
        const target = new URL(baseUrl.href + ext);
        if (existsSync(fileURLToPath(target))) return target;
      }
      return null;
    };

    if (specifier.startsWith('@/')) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
      const found = tryExts(base) ?? base;
      return nextResolve(found.href, context);
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parent = context.parentURL;
      if (parent && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        const base = new URL(specifier, parent);
        const found = tryExts(base);
        if (found) return nextResolve(found.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
