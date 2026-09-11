import { useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ShieldPlus, UserMinus, UserPlus } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/staff-session";
import { supabase } from "@/integrations/supabase/client";
import { provisionStaff } from "@/lib/staff-admin-fn";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({ meta: [{ title: "Staff accounts, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireAdmin(location.pathname, context.queryClient),
  }),
  component: StaffPage,
});

type StaffRow = {
  user_id: string;
  full_name: string;
  username: string;
  active: boolean;
  roles: ("admin" | "staff")[];
};

function generatePassword() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .slice(0, 14);
}

function StaffPage() {
  const { staff: currentStaff } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const { data: staffList } = useQuery({
    queryKey: ["staff-list"],
    queryFn: async (): Promise<StaffRow[]> => {
      const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] =
        await Promise.all([
          supabase.from("staff_profiles").select("*").order("full_name"),
          supabase.from("user_roles").select("*"),
        ]);
      if (profilesError) throw profilesError;
      if (rolesError) throw rolesError;
      return (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        username: p.username,
        active: p.active,
        roles: (roles ?? []).filter((r) => r.user_id === p.user_id).map((r) => r.role),
      }));
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["staff-list"] });
  }

  return (
    <StaffShell staff={currentStaff}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-foreground">Staff accounts</h1>
          <AddStaffDialog onCreated={invalidate} />
        </div>

        <div className="panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staffList ?? []).map((s) => (
                <StaffTableRow
                  key={s.user_id}
                  row={s}
                  isSelf={s.user_id === currentStaff.userId}
                  onChanged={invalidate}
                />
              ))}
              {staffList?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No staff accounts yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </StaffShell>
  );
}

function StaffTableRow({
  row,
  isSelf,
  onChanged,
}: {
  row: StaffRow;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const isAdmin = row.roles.includes("admin");

  const toggleActive = useMutation({
    mutationFn: async (active: boolean) => {
      const { error } = await supabase.rpc("admin_update_staff", {
        p_user_id: row.user_id,
        p_active: active,
      });
      if (error) throw error;
    },
    onSuccess: onChanged,
  });

  const toggleAdmin = useMutation({
    mutationFn: async (grant: boolean) => {
      const { error } = await supabase.rpc("admin_set_staff_role", {
        p_user_id: row.user_id,
        p_role: "admin",
        p_grant: grant,
      });
      if (error) throw error;
    },
    onSuccess: onChanged,
  });

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-foreground">{row.full_name}</div>
        <div className="text-xs text-muted-foreground">{row.username}</div>
      </TableCell>
      <TableCell>
        <Badge variant={isAdmin ? "default" : "outline"}>
          {isAdmin ? "Administrator" : "Staff"}
        </Badge>
      </TableCell>
      <TableCell>
        <Switch
          checked={row.active}
          disabled={isSelf || toggleActive.isPending}
          onCheckedChange={(checked) => {
            if (checked) toggleActive.mutate(true);
          }}
          aria-label={row.active ? "Active" : "Inactive"}
        />
        {!row.active && <span className="ml-2 text-xs text-muted-foreground">Deactivated</span>}
      </TableCell>
      <TableCell className="text-right">
        {isSelf ? (
          <span className="text-xs text-muted-foreground">This is you</span>
        ) : (
          <div className="flex justify-end gap-2">
            {isAdmin ? (
              <ConfirmAction
                trigger={
                  <Button variant="outline" size="sm">
                    Remove admin
                  </Button>
                }
                title="Remove administrator access?"
                description={`${row.full_name} will keep staff check-in access but lose access to staff management, import, and the audit trail.`}
                confirmLabel="Remove admin"
                onConfirm={() => toggleAdmin.mutate(false)}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAdmin.mutate(true)}
                disabled={toggleAdmin.isPending}
              >
                <ShieldPlus className="size-4" aria-hidden="true" />
                Make admin
              </Button>
            )}
            {row.active && (
              <ConfirmAction
                trigger={
                  <Button variant="outline" size="sm">
                    <UserMinus className="size-4" aria-hidden="true" />
                    Deactivate
                  </Button>
                }
                title="Deactivate this account?"
                description={`${row.full_name} will immediately lose access to check-in and dashboard tools. You can reactivate later.`}
                confirmLabel="Deactivate"
                onConfirm={() => toggleActive.mutate(false)}
              />
            )}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AddStaffDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(generatePassword());
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function reset() {
    setFullName("");
    setUsername("");
    setPassword(generatePassword());
    setRole("staff");
    setError(null);
    setCreated(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await provisionStaff({ data: { fullName, username, password, role } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ username, password });
      onCreated();
    } catch {
      setError("Connection problem. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" aria-hidden="true" />
          Add staff
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a staff account</DialogTitle>
          <DialogDescription>
            Creates a sign-in for check-in staff or an administrator.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                Account created. Share these sign-in details securely, they will not be shown again.
              </AlertDescription>
            </Alert>
            <div className="space-y-2 rounded-md border border-border bg-muted p-3 font-mono text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{created.username}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{created.password}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => navigator.clipboard?.writeText(created.password)}
                  aria-label="Copy password"
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s_name">Full name</Label>
              <Input
                id="s_name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_username">Username</Label>
              <Input
                id="s_username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger id="s_role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff (check-in and dashboard)</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_password">Temporary password</Label>
              <div className="flex gap-2">
                <Input
                  id="s_password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPassword(generatePassword())}
                >
                  Generate
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                Create account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
