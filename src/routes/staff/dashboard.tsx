import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Printer, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { QrBadge } from "@/components/qr-badge";
import { EditDelegateDialog } from "@/components/edit-delegate-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { requireStaff } from "@/lib/staff-session";
import {
  DELEGATES_KEY,
  useDashboardStats,
  useDelegates,
  delegatesToCsv,
  downloadCsv,
  type DelegateRow,
} from "@/lib/delegates-data";
import { useCountUp } from "@/hooks/use-count-up";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/staff/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireStaff(location.pathname, context.queryClient),
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { staff } = Route.useRouteContext();
  const { data: stats } = useDashboardStats();
  const { data: delegates } = useDelegates();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "expected" | "checked_in">("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");

  const organizations = useMemo(
    () =>
      Array.from(
        new Set(
          (delegates ?? [])
            .map((d) => d.organization)
            .filter((org): org is string => !!org),
        ),
      ).sort(),
    [delegates],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (delegates ?? []).filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (orgFilter !== "all" && d.organization !== orgFilter) return false;
      if (
        q &&
        !(d.full_name.toLowerCase().includes(q) || (d.email ?? "").toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [delegates, query, statusFilter, orgFilter]);

  const recentCheckIns = useMemo(
    () =>
      (delegates ?? [])
        .filter((d) => d.checked_in_at)
        .sort((a, b) => new Date(b.checked_in_at!).getTime() - new Date(a.checked_in_at!).getTime())
        .slice(0, 8),
    [delegates],
  );

  const expected = stats?.expected ?? 0;
  const checkedIn = stats?.checked_in ?? 0;
  const remaining = Math.max(0, expected - checkedIn);
  const turnout = expected > 0 ? Math.round((checkedIn / expected) * 100) : 0;

  return (
    <StaffShell staff={staff}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-foreground">Dashboard</h1>
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv("aak-convention-2026-delegates.csv", delegatesToCsv(delegates ?? []))
            }
          >
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>

        {staff.isAdmin && <KioskQrCard />}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Expected delegates" value={expected} />
          <MetricCard label="Checked in" value={checkedIn} />
          <MetricCard label="Remaining" value={remaining} />
          <MetricCard label="Turnout" value={turnout} suffix="%" />
        </div>

        <div className="panel flex flex-wrap gap-3 p-4">
          <Input
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="expected">Expected</SelectItem>
              <SelectItem value="checked_in">Checked in</SelectItem>
            </SelectContent>
          </Select>
          <Select value={orgFilter} onValueChange={setOrgFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organizations</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org} value={org}>
                  {org}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto self-center text-sm text-muted-foreground tabular">
            {filtered.length} of {delegates?.length ?? 0}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="panel overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Photo consent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{d.full_name}</div>
                      <div className="text-xs text-muted-foreground">{d.email ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.organization ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {d.photo_consent === true ? "Yes" : d.photo_consent === false ? "No" : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.status === "checked_in" ? "default" : "outline"}>
                        {d.status === "checked_in" ? "Checked in" : "Expected"}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {d.checked_in_at
                        ? new Date(d.checked_in_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <EditDelegateDialog delegate={d} />
                        {staff.isAdmin && <DeleteDelegateButton delegate={d} />}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No delegates match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="panel p-4">
            <h2 className="eyebrow mb-3">Recent check-ins</h2>
            <ul className="space-y-3">
              {recentCheckIns.map((d) => (
                <li key={d.id} className="text-sm">
                  <p className="font-medium text-foreground">{d.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(d.checked_in_at!).toLocaleTimeString(undefined, {
                      timeStyle: "short",
                    })}{" "}
                    &middot; checked in by {d.checked_in_by_name}
                  </p>
                </li>
              ))}
              {recentCheckIns.length === 0 && (
                <li className="text-sm text-muted-foreground">No check-ins yet.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </StaffShell>
  );
}

/**
 * The single printed QR posted at the check-in desk. Delegates scan it with
 * their own phone on arrival to self-check-in by email, without staff typing
 * their name. Regenerating retires the previously printed copy, so it asks
 * for confirmation first.
 */
function KioskQrCard() {
  const queryClient = useQueryClient();
  const { data: token, isLoading } = useQuery({
    queryKey: ["kiosk-token"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_active_kiosk_token");
      if (error) throw error;
      return data as string | null;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_create_kiosk_token");
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kiosk-token"] }),
  });

  const kioskUrl =
    token && typeof window !== "undefined" ? `${window.location.origin}/kiosk/${token}` : null;

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p className="eyebrow">Self check-in kiosk</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Print this QR code and post it at the check-in desk. Delegates scan it with their own
          phone, enter their name, and fill in email, institution, and photo consent themselves
          to check in — no staff needed.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {isLoading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : kioskUrl ? (
          <PosterDialog url={kioskUrl} />
        ) : (
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <QrCode className="size-4" aria-hidden="true" />
            Generate code
          </Button>
        )}
        {kioskUrl && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={generate.isPending}>
                <RefreshCw className="size-4" aria-hidden="true" />
                New code
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace the printed kiosk code?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any posters already printed with the current QR code will stop working. Only do
                  this if the old poster is lost or compromised.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => generate.mutate()}>Replace it</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}

function PosterDialog({ url }: { url: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <QrCode className="size-4" aria-hidden="true" />
          View / print
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Check-in desk poster</DialogTitle>
          <DialogDescription>Print this and display it at the check-in desk.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <QrBadge value={url} size={240} />
          <p className="font-display text-lg text-foreground">Scan to check in</p>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  const displayed = useCountUp(value);
  return (
    <div className="panel p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-3xl tabular text-foreground">
        {displayed}
        {suffix}
      </p>
    </div>
  );
}

/**
 * Permanently removes a delegate — for cleaning up duplicate records (the
 * same person imported twice under slightly different name spellings that
 * didn't match during a merge). Admin-only and irreversible, unlike the
 * staff-level edit/undo actions, so it's gated behind a confirmation dialog.
 */
function DeleteDelegateButton({ delegate }: { delegate: DelegateRow }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_delete_delegate", {
        p_delegate_id: delegate.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          disabled={mutation.isPending}
          aria-label="Delete delegate"
        >
          {mutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {delegate.full_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes their record and check-in history from this event. Use this
            only for a duplicate or mistaken entry — this cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
