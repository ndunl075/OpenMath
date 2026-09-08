/**
 * The workspace packages are published as TypeScript sources whose relative
 * imports carry the compiled ".js" extension, which is what a bundler expects
 * and what Node's own type stripping does not resolve. Retrying a failed
 * resolution as ".ts" is the whole difference, and it keeps the bench free of a
 * TypeScript runner dependency.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
