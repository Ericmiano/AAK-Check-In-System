import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2, Save } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireStaff } from "@/lib/staff-session";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/staff/profile")({
  head: () => ({ meta: [{ title: "Your profile, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireStaff(location.pathname, context.queryClient),
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { staff } = Route.useRouteContext();

  return (
    <StaffShell staff={staff}>
      <div className="max-w-lg space-y-6">
        <h1 className="font-display text-2xl text-foreground">Your profile</h1>

        <div className="panel space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Signed in as</p>
              <p className="font-medium text-foreground">{staff.username}</p>
            </div>
            <Badge variant={staff.isAdmin ? "default" : "outline"}>
              {staff.isAdmin ? "Administrator" : "Staff"}
            </Badge>
          </div>
          <NameForm initialName={staff.fullName} />
        </div>

        <PasswordForm authEmail={staff.authEmail} />
      </div>
    </StaffShell>
  );
}

function NameForm({ initialName }: { initialName: string }) {
  const [fullName, setFullName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_own_full_name", { p_full_name: fullName });
      if (error) throw error;
    },
    onSuccess: () => setSaved(true),
    onError: (err) => setError(errorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
      <Label htmlFor="full_name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setSaved(false);
          }}
          required
        />
        <Button
          type="submit"
          variant="outline"
          disabled={mutation.isPending || fullName === initialName}
        >
          {mutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          Save
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-success">Name updated.</p>}
    </form>
  );
}

function PasswordForm({ authEmail }: { authEmail: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: currentPassword,
      });
      if (verifyError) {
        setError("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Connection problem. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyRound className="size-4" aria-hidden="true" />
        Change password
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>Password updated.</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="current_password">Current password</Label>
        <Input
          id="current_password"
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new_password">New password</Label>
        <Input
          id="new_password"
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <Input
          id="confirm_password"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="size-4" aria-hidden="true" />
        )}
        Update password
      </Button>
    </form>
  );
}
