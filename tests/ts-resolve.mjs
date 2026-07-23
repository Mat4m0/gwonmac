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
