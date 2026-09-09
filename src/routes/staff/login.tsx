import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Loader2, LogIn, ShieldPlus } from "lucide-react";
import aakLogo from "@/assets/aak-org-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { bootstrapFirstAdmin } from "@/lib/staff-admin-fn";
import { clearStaffSessionCache } from "@/lib/staff-session";

const searchSchema = z.object({
  redirect: z.string().optional(),
  reason: z.enum(["signin", "forbidden", "expired"]).optional(),
});

export const Route = createFileRoute("/staff/login")({
  head: () => ({ meta: [{ title: "Staff sign in, AAK Convention 2026" }] }),
  validateSearch: searchSchema,
  component: StaffLoginPage,
});

const REASON_MESSAGE: Record<string, string> = {
  forbidden: "Your account does not have staff access. Contact an administrator.",
  expired: "Your session has expired. Sign in again.",
};

function StaffLoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();

  const { data: adminExists, isLoading: checkingAdmin } = useQuery({
    queryKey: ["admin-exists"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_exists");
      if (error) throw error;
      return data as boolean;
    },
  });

  function goToDestination() {
    // A prior failed guard check on this tab may have cached "unauthenticated"
    // or "forbidden" for this session's queryClient; drop it so the page we
    // navigate to re-checks against the account that just signed in.
    clearStaffSessionCache(queryClient);
    const target =
      search.redirect && search.redirect.startsWith("/") ? search.redirect : "/staff/check-in";
    navigate({ to: target });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={aakLogo} alt="AAK" className="h-12 w-auto" />
          <p className="eyebrow mt-4">AAK Annual Convention 2026</p>
          <h1 className="font-display text-2xl text-foreground">Staff sign in</h1>
        </div>

        {search.reason && REASON_MESSAGE[search.reason] && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{REASON_MESSAGE[search.reason]}</AlertDescription>
          </Alert>
        )}

        {checkingAdmin ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          </div>
        ) : adminExists ? (
          <SignInForm onSignedIn={goToDestination} />
        ) : (
          <FirstAdminForm onCreated={goToDestination} />
        )}
      </div>
    </div>
  );
}

function SignInForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError("Incorrect email or password.");
      return;
    }
    onSignedIn();
  }

  return (
    <form onSubmit={handleSubmit} className="panel space-y-4 p-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="size-4" aria-hidden="true" />
        )}
        Sign in
      </Button>
    </form>
  );
}

function FirstAdminForm({ onCreated }: { onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await bootstrapFirstAdmin({ data: { fullName, email, password } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError("Administrator created. Sign in with your new password.");
        return;
      }
      onCreated();
    } catch {
      setError("Connection problem. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel space-y-4 p-6">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <ShieldPlus className="size-4" aria-hidden="true" />
        Set up the first administrator account
      </div>
      <p className="text-sm text-muted-foreground">
        No administrator exists yet. Create the first one to start managing staff, imports, and the
        audit trail.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="admin_name">Full name</Label>
        <Input
          id="admin_name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin_email">Email</Label>
        <Input
          id="admin_email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="admin_password">Password</Label>
        <Input
          id="admin_password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <ShieldPlus className="size-4" aria-hidden="true" />
        )}
        Create administrator account
      </Button>
    </form>
  );
}
