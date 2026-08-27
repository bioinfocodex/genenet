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
    if (specifier.startsWith('@/')) {
      // tsconfig maps @/* to src/*, and the app writes those imports without a
      // file extension. Node needs one, so the real extensions are tried in the
      // order TypeScript would resolve them.
      const base = `../src/${specifier.slice(2)}`;
      for (const ext of ['.ts', '.tsx', '.mts', '.js', '']) {
        const target = new URL(base + ext, import.meta.url);
        if (existsSync(fileURLToPath(target))) return nextResolve(target.href, context);
      }
      return nextResolve(new URL(base, import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
