import { registerHooks } from 'node:module';

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
    return nextResolve(specifier, context);
  },
});
