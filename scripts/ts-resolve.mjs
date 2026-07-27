// Stays JavaScript: this is the loader every TypeScript entry point in the
// repository resolves through, so it cannot itself be resolved through it.
// Node's own hook type is what keeps the three parameters checked without an
// annotation of our own.
//
// It sits beside the build scripts rather than under `tests/` because
// `scripts/build.mjs` and the release workflow's version gate load it too: it
// is the repository's single answer to "run a TypeScript file from Node", and
// the production build must not depend on the test directory being present.
/** @type {import("node:module").ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith(".") || specifier.startsWith("/")) &&
    specifier.endsWith(".js")
  ) {
    try {
      return await nextResolve(specifier.replace(/\.js$/u, ".ts"), context);
    } catch {
      // fall through to the real .js (compiled) path
    }
  }
  return nextResolve(specifier, context);
}
