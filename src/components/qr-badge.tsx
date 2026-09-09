import { useEffect, useRef, useState } from "react";

type QrBadgeProps = {
  value: string;
  size?: number;
  className?: string;
};

/**
 * Renders a QR code on a canvas, client-side only. The `qrcode` package's
 * default export resolves to a Node implementation that needs the optional
 * `canvas` binding, so it is imported lazily inside an effect and never
 * touched during SSR.
 */
export function QrBadge({ value, size = 240, className }: QrBadgeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    import("qrcode").then((QRCode) => {
      if (cancelled || !canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        errorCorrectionLevel: "medium",
        color: { dark: "#241d15", light: "#fefcf5" },
      }).then(() => {
        if (!cancelled) setReady(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-2xl border border-border bg-card p-4 shadow-badge ${className ?? ""}`}
    >
      <canvas ref={canvasRef} width={size} height={size} role="img" aria-label="Badge QR code" />
      {!ready && (
        <div className="absolute inset-4 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
      )}
    </div>
  );
}
