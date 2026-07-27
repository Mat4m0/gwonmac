// Stays JavaScript: this is the loader every TypeScript test resolves through,
// so it cannot itself be resolved through it. Node's own hook type is what
// keeps the three parameters checked without an annotation of our own.
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
