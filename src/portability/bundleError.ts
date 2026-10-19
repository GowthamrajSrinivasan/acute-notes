/**
 * A rejected workspace file (user-facing message). Kept apart from the bundle
 * schema so UI code can recognise it without loading the validator (zod).
 */
export class BundleError extends Error {
  override name = "BundleError";
}
