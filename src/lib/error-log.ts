import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Logs an unexpected error to a table admins can check during the live
 * event, so a bug at the desk doesn't go unnoticed until someone happens to
 * mention it. Never throws: reporting an error must not cause another one.
 */
export function reportClientError(error: unknown, context: Record<string, unknown> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const path = typeof window !== "undefined" ? window.location.pathname : undefined;

  supabase
    .rpc("log_client_error", {
      p_message: message,
      ...(stack ? { p_stack: stack } : {}),
      ...(path ? { p_path: path } : {}),
      p_context: context as Json,
    })
    .then(
      () => {},
      () => {},
    );
}

/** Installs window-level handlers so uncaught errors are reported automatically. */
export function installGlobalErrorLogging() {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message, { source: "window.onerror" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason, { source: "unhandledrejection" });
  });
}
