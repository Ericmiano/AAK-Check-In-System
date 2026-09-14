/**
 * Supabase's query/RPC builders resolve `{ data, error }` rather than
 * throwing — `error` is a plain `{ message, details, hint, code }` object,
 * not an `Error` instance, unless the builder's `.throwOnError()` is used
 * (nothing in this app calls it). Every mutation here does
 * `if (error) throw error`, so `err instanceof Error` is false for every
 * real backend rejection, and error handlers built around that check fall
 * through to a generic fallback message, silently hiding the actual reason
 * (e.g. "No active event", a validation message) behind unhelpful
 * boilerplate like "Connection problem. Try again." — even when the
 * problem has nothing to do with connectivity. This reads `.message` off
 * whatever shape the error actually is.
 */
export function errorMessage(err: unknown, fallback = "Connection problem. Try again."): string {
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
