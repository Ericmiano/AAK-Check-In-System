import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Download,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { QrBadge } from "@/components/qr-badge";
import { EventPanel } from "@/components/event-panel";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { requireStaff } from "@/lib/staff-session";
import {
  DELEGATES_KEY,
  useDashboardStats,
  useDelegates,
  delegatesToCsv,
  delegatesToJson,
  delegatesToXlsx,
  downloadCsv,
  downloadJson,
  downloadBlob,
  type DelegateRow,
} from "@/lib/delegates-data";
import { useActiveEvent } from "@/lib/events-data";
import { useCountUp } from "@/hooks/use-count-up";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { reportClientError } from "@/lib/error-log";

function exportFileBase(eventName: string | undefined) {
  const slug = (eventName ?? "delegates")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "delegates";
}

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
  const { data: activeEvent } = useActiveEvent();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "expected" | "pending" | "checked_in_today" | "absent_today"
  >("all");
  const [orgFilter, setOrgFilter] = useState<string>("all");
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileBase = exportFileBase(activeEvent?.name);

  async function handleExportXlsx() {
    setExportError(null);
    setExportingXlsx(true);
    try {
      const blob = await delegatesToXlsx(delegates ?? []);
      downloadBlob(`${fileBase}.xlsx`, blob);
    } catch (err) {
      reportClientError(err, { context: "export_xlsx" });
      setExportError(errorMessage(err));
    } finally {
      setExportingXlsx(false);
    }
  }

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
      if (statusFilter === "expected" && d.status !== "expected") return false;
      if (statusFilter === "pending" && d.status !== "pending") return false;
      if (statusFilter === "checked_in_today" && !d.checked_in_today) return false;
      if (statusFilter === "absent_today" && (d.status !== "checked_in" || d.checked_in_today))
        return false;
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
  const checkedInToday = stats?.checked_in ?? 0;
  const checkedInEver = stats?.checked_in_ever ?? 0;
  const remainingToday = Math.max(0, expected - checkedInToday);
  const turnoutToday = expected > 0 ? Math.round((checkedInToday / expected) * 100) : 0;
  const tagsGiven = useMemo(
    () => (delegates ?? []).filter((d) => d.tag_issued_at).length,
    [delegates],
  );
  const giftBagsGiven = useMemo(
    () => (delegates ?? []).filter((d) => d.gift_bag_issued_at).length,
    [delegates],
  );

  return (
    <StaffShell staff={staff}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-foreground">Dashboard</h1>
          <div className="flex flex-col items-end gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={exportingXlsx}>
                  {exportingXlsx ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="size-4" aria-hidden="true" />
                  )}
                  Export
                  <ChevronDown className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(`${fileBase}.csv`, delegatesToCsv(delegates ?? []))
                  }
                >
                  CSV — opens in Excel/Sheets
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportXlsx}>
                  Excel (.xlsx) — for browsing or editing by hand
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadJson(`${fileBase}.json`, delegatesToJson(delegates ?? []))
                  }
                >
                  JSON — for scripts, backups, or re-import elsewhere
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {exportError && <p className="text-xs text-destructive">{exportError}</p>}
          </div>
        </div>

        <EventPanel compact />

        {staff.isAdmin && <KioskQrCard />}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Expected delegates" value={expected} />
          <MetricCard label="Checked in today" value={checkedInToday} />
          <MetricCard label="Checked in overall" value={checkedInEver} />
          <MetricCard label="Remaining today" value={remainingToday} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Turnout today" value={turnoutToday} suffix="%" />
          <MetricCard label="Tags given" value={tagsGiven} />
          <MetricCard label="Gift bags given" value={giftBagsGiven} />
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
              <SelectItem value="pending">Self-registered</SelectItem>
              <SelectItem value="checked_in_today">Checked in today</SelectItem>
              <SelectItem value="absent_today">Attended before, not today</SelectItem>
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
                  <TableHead>Status</TableHead>
                  <TableHead>Checked in</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Gift bag</TableHead>
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
                    <TableCell>
                      {d.status === "pending" ? (
                        <Badge variant="secondary">Self-registered</Badge>
                      ) : d.status === "expected" ? (
                        <Badge variant="outline">Expected</Badge>
                      ) : d.checked_in_today ? (
                        <Badge variant="default">Checked in today</Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-warning/40 bg-warning-soft text-warning"
                        >
                          Not checked in today
                        </Badge>
                      )}
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
                      <FulfillmentIcon given={!!d.tag_issued_at} />
                    </TableCell>
                    <TableCell>
                      <FulfillmentIcon given={!!d.gift_bag_issued_at} />
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
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
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
          phone, enter their name, and fill in email and institution themselves to check in — no
          staff needed.
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

function FulfillmentIcon({ given }: { given: boolean }) {
  return given ? (
    <Check className="size-4 text-primary" aria-label="Given" />
  ) : (
    <X className="size-4 text-muted-foreground/40" aria-label="Not given" />
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
