import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import aakLogo from "@/assets/aak-org-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/kiosk/$token")({
  head: () => ({ meta: [{ title: "Check in, AAK Convention 2026" }] }),
  component: KioskPage,
});

type KioskResult =
  | { kind: "checked_in"; fullName: string; organization: string }
  | { kind: "already_checked_in"; fullName: string; organization: string }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function KioskPage() {
  const { token } = Route.useParams();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KioskResult | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.rpc("kiosk_check_in", {
        p_token: token,
        p_email: email,
      });
      if (error) throw error;
      const payload = data as unknown as {
        result: "checked_in" | "already_checked_in" | "not_found";
        full_name?: string;
        organization?: string;
      };
      if (payload.result === "not_found") {
        setResult({ kind: "not_found" });
      } else {
        setResult({
          kind: payload.result,
          fullName: payload.full_name ?? "",
          organization: payload.organization ?? "",
        });
      }
      setEmail("");
    } catch (err) {
      setResult({
        kind: "error",
        message: err instanceof Error ? err.message : "Connection problem. Try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-5 py-10">
      <img src={aakLogo} alt="AAK" className="h-12 w-auto" />
      <p className="eyebrow mt-4">AAK Annual Convention 2026</p>
      <h1 className="mt-2 text-center font-display text-3xl text-foreground">Check in</h1>
      <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
        Enter the email you registered with to check yourself in.
      </p>

      <div className="mt-8 w-full max-w-sm">
        {result?.kind === "checked_in" && (
          <div className="animate-banner-in flex flex-col items-center gap-2 rounded-xl bg-success p-6 text-center text-success-foreground">
            <CheckCircle2 className="size-10" aria-hidden="true" />
            <p className="font-display text-xl">Checked in</p>
            <p className="text-sm opacity-90">
              Welcome, {result.fullName}. {result.organization}
            </p>
          </div>
        )}
        {result?.kind === "already_checked_in" && (
          <div className="animate-banner-in flex flex-col items-center gap-2 rounded-xl bg-warning p-6 text-center text-warning-foreground">
            <Clock className="size-10" aria-hidden="true" />
            <p className="font-display text-xl">Already checked in</p>
            <p className="text-sm opacity-90">{result.fullName}</p>
          </div>
        )}
        {result?.kind === "not_found" && (
          <div className="animate-banner-in flex flex-col items-center gap-2 rounded-xl bg-destructive p-6 text-center text-destructive-foreground">
            <XCircle className="size-10" aria-hidden="true" />
            <p className="font-display text-xl">No matching registration</p>
            <p className="text-sm opacity-90">Please see a staff member at the desk for help.</p>
          </div>
        )}
        {result?.kind === "error" && (
          <div className="animate-banner-in flex flex-col items-center gap-2 rounded-xl bg-destructive p-6 text-center text-destructive-foreground">
            <XCircle className="size-10" aria-hidden="true" />
            <p className="font-display text-xl">Connection problem</p>
            <p className="text-sm opacity-90">{result.message}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kiosk_email">Email</Label>
            <Input
              id="kiosk_email"
              type="email"
              required
              autoFocus
              className="h-12 text-base"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Check in
          </Button>
        </form>
      </div>
    </div>
  );
}
