import { AlertTriangle, CheckCircle2, WifiOff, XCircle } from "lucide-react";

export type CheckInResultKind =
  "checked_in" | "already_checked_in" | "not_found" | "duplicate" | "error";

export type CheckInResult = {
  kind: CheckInResultKind;
  title: string;
  detail?: string;
};

const KIND_STYLES: Record<CheckInResultKind, { className: string; Icon: typeof CheckCircle2 }> = {
  checked_in: { className: "bg-success text-success-foreground", Icon: CheckCircle2 },
  already_checked_in: { className: "bg-warning text-warning-foreground", Icon: AlertTriangle },
  duplicate: { className: "bg-warning text-warning-foreground", Icon: AlertTriangle },
  not_found: { className: "bg-destructive text-destructive-foreground", Icon: XCircle },
  error: { className: "bg-destructive text-destructive-foreground", Icon: WifiOff },
};

/**
 * High-contrast, screen-reader-announced result state for the check-in desk.
 * aria-live is assertive because staff need the outcome the instant a scan
 * or search resolves, without hunting for it visually.
 */
export function ResultBanner({ result }: { result: CheckInResult | null }) {
  if (!result) return null;
  const { className, Icon } = KIND_STYLES[result.kind];

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`animate-banner-in flex items-start gap-3 rounded-xl px-5 py-4 shadow-tactile ${className}`}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-display text-lg leading-tight">{result.title}</p>
        {result.detail && <p className="mt-0.5 text-sm opacity-90">{result.detail}</p>}
      </div>
    </div>
  );
}
