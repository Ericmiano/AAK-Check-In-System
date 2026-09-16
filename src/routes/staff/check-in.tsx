import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Loader2, RotateCcw, Search, UserPlus } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { EventPanel } from "@/components/event-panel";
import { EditDelegateDialog } from "@/components/edit-delegate-dialog";
import { ResultBanner, type CheckInResult } from "@/components/result-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FulfillmentToggle } from "@/components/fulfillment-toggle";
import { OrganizationCombobox } from "@/components/organization-combobox";
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
import { requireStaff } from "@/lib/staff-session";
import { DELEGATES_KEY, useDelegates, type DelegateRow } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";
import { successFeedback, noticeFeedback } from "@/lib/feedback";
import { reportClientError } from "@/lib/error-log";
import { errorMessage } from "@/lib/errors";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  enqueueCheckIn,
  getQueue,
  isLikelyNetworkError,
  removeFromQueue,
} from "@/lib/check-in-queue";

export const Route = createFileRoute("/staff/check-in")({
  head: () => ({ meta: [{ title: "Check-in, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireStaff(location.pathname, context.queryClient),
  }),
  component: CheckInPage,
});

type CheckInResponse = {
  result: "checked_in" | "already_checked_in" | "not_found";
  delegate?: { full_name: string; organization: string | null; badge_code: string };
};

type AddAndCheckInResponse = {
  result: "checked_in" | "already_checked_in";
  delegate: { full_name: string; organization: string | null; badge_code: string };
};

async function performCheckIn(
  lookup: string,
  deviceLabel = "Web check-in",
): Promise<CheckInResponse> {
  const { data, error } = await supabase.rpc("check_in_delegate", {
    p_lookup: lookup,
    p_method: "search",
    p_device_label: deviceLabel,
  });
  if (error) throw error;
  return data as unknown as CheckInResponse;
}

function CheckInPage() {
  const { staff } = Route.useRouteContext();
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [query, setQuery] = useState("");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(() => getQueue().length);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: delegates } = useDelegates();
  const isOnline = useOnlineStatus();

  function showResult(next: CheckInResult) {
    setResult(next);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), 5000);
  }

  function applySuccess(data: CheckInResponse) {
    queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
    const detail = data.delegate
      ? [data.delegate.full_name, data.delegate.organization].filter(Boolean).join(", ")
      : undefined;
    if (data.result === "checked_in") {
      successFeedback();
      setSessionCount((n) => n + 1);
      showResult({ kind: "checked_in", title: "Checked in", ...(detail ? { detail } : {}) });
    } else if (data.result === "already_checked_in") {
      noticeFeedback();
      showResult({
        kind: "already_checked_in",
        title: "Already checked in today",
        ...(detail ? { detail } : {}),
      });
    } else {
      showResult({ kind: "not_found", title: "No delegate found" });
    }
  }

  // Retries queued check-ins (saved when a request failed while offline).
  // Each is attempted independently so one still-failing entry doesn't block
  // the rest; runs on regaining connectivity and as a periodic safety net,
  // since "online" can fire optimistically on a flaky connection.
  async function flushQueue() {
    const queue = getQueue();
    if (queue.length === 0) return;
    for (const item of queue) {
      try {
        const data = await performCheckIn(item.lookup, "Web check-in (queued)");
        removeFromQueue(item.id);
        applySuccess(data);
      } catch (err) {
        if (!isLikelyNetworkError(err)) {
          // The server actually rejected it (already handled elsewhere,
          // deleted delegate, etc.) — drop it, retrying won't help.
          removeFromQueue(item.id);
          reportClientError(err, { context: "flushQueue", lookup: item.lookup });
        }
        break;
      }
    }
    setPendingCount(getQueue().length);
  }

  useEffect(() => {
    if (isOnline) flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) flushQueue();
    }, 20_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkInMutation = useMutation({
    mutationFn: (vars: { lookup: string }) => performCheckIn(vars.lookup),
    onSuccess: (data) => {
      applySuccess(data);
      // Reset the search box so staff can go straight to the next person
      // without touching the mouse.
      setQuery("");
      searchInputRef.current?.focus();
    },
    onError: (err, vars) => {
      if (isLikelyNetworkError(err)) {
        enqueueCheckIn(vars.lookup);
        setPendingCount(getQueue().length);
        showResult({
          kind: "queued",
          title: "Saved — will check in once back online",
          detail: "No connection right now. This will complete automatically.",
        });
        setQuery("");
        searchInputRef.current?.focus();
        return;
      }
      reportClientError(err, { context: "check_in_delegate", lookup: vars.lookup });
      showResult({ kind: "error", title: errorMessage(err) });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (delegateId: string) => {
      const { data, error } = await supabase.rpc("undo_check_in", { p_delegate_id: delegateId });
      if (error) throw error;
      return data as unknown as { full_name: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      showResult({ kind: "undone", title: "Check-in undone", detail: data.full_name });
    },
    onError: (err) => {
      reportClientError(err, { context: "undo_check_in" });
      showResult({ kind: "error", title: errorMessage(err) });
    },
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !delegates) return [];
    return delegates
      .filter(
        (d) =>
          d.full_name.toLowerCase().includes(q) ||
          (d.email ?? "").toLowerCase().includes(q) ||
          d.badge_code.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, delegates]);

  return (
    <StaffShell staff={staff}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-2xl text-foreground">Staff check-in</h1>
          <span className="tabular text-sm text-muted-foreground">
            {sessionCount} checked in this session
          </span>
        </div>

        <EventPanel compact />

        {!isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-2.5 text-sm text-foreground">
            <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
            No connection. Check-ins will be saved and sent automatically once you're back online.
          </div>
        )}
        {isOnline && pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-info-soft px-4 py-2.5 text-sm text-foreground">
            <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
            Syncing {pendingCount} pending {pendingCount === 1 ? "check-in" : "check-ins"}...
          </div>
        )}

        <ResultBanner result={result} />

        <div className="panel p-5">
          <Label htmlFor="search" className="eyebrow">
            Search delegates
          </Label>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="search"
              ref={searchInputRef}
              autoFocus
              className="h-11 pl-9 text-base"
              placeholder="Name, email, or badge code, then press Enter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || checkInMutation.isPending) return;
                const top = matches[0];
                if (top && !top.checked_in_today) {
                  checkInMutation.mutate({ lookup: top.id });
                }
              }}
            />
          </div>

          {query.trim() && (
            <ul className="mt-4 divide-y divide-border">
              {matches.length === 0 && (
                <li className="py-4 text-sm text-muted-foreground">No delegate found.</li>
              )}
              {matches.map((d) => (
                <DelegateResultRow
                  key={d.id}
                  delegate={d}
                  disabled={checkInMutation.isPending}
                  onCheckIn={() => checkInMutation.mutate({ lookup: d.id })}
                  onUndo={() => undoMutation.mutate(d.id)}
                  undoing={undoMutation.isPending && undoMutation.variables === d.id}
                />
              ))}
            </ul>
          )}
        </div>

        <Dialog open={walkInOpen} onOpenChange={setWalkInOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="lg" className="w-full sm:w-auto">
              <UserPlus className="size-4" aria-hidden="true" />
              Add and check in
            </Button>
          </DialogTrigger>
          <WalkInDialogContent
            onDone={(banner) => {
              setWalkInOpen(false);
              showResult(banner);
              queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
            }}
          />
        </Dialog>
      </div>
    </StaffShell>
  );
}

function DelegateResultRow({
  delegate,
  disabled,
  onCheckIn,
  onUndo,
  undoing,
}: {
  delegate: DelegateRow;
  disabled: boolean;
  onCheckIn: () => void;
  onUndo: () => void;
  undoing: boolean;
}) {
  const checkedInToday = delegate.checked_in_today;
  const pending = delegate.status === "pending";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="truncate font-medium text-foreground">{delegate.full_name}</p>
          <span className="shrink-0 text-xs text-muted-foreground">{delegate.badge_code}</span>
          {pending && (
            <span className="shrink-0 rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">
              Self-registered at kiosk — confirm &amp; issue badge
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          <FieldStatus label="Email" value={delegate.email} />
          <FieldStatus label="Institution" value={delegate.organization} />
          <FieldStatus label="Phone" value={delegate.phone} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <FulfillmentToggle
            label="Tag given"
            delegateId={delegate.id}
            checked={!!delegate.tag_issued_at}
            field="tag_issued_at"
            rpc="set_tag_issued"
          />
          <FulfillmentToggle
            label="Gift bag given"
            delegateId={delegate.id}
            checked={!!delegate.gift_bag_issued_at}
            field="gift_bag_issued_at"
            rpc="set_gift_bag_issued"
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <EditDelegateDialog delegate={delegate} />
        {checkedInToday ? (
          <>
            <Badge variant="secondary">Checked in today</Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={undoing}
                  aria-label="Undo check-in"
                >
                  {undoing ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Undo today's check-in?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes {delegate.full_name}'s check-in for today. Use this only for an
                    accidental tap just now — it won't affect any other day's attendance.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onUndo}>Undo check-in</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Button size="sm" disabled={disabled} onClick={onCheckIn}>
            Check in
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * At-a-glance status for one delegate field in the check-in search results:
 * shows the value when it's known, or a warning-colored "missing" chip when
 * it isn't, so staff can tell what still needs filling in (via the edit
 * dialog) without opening it just to find out.
 */
function FieldStatus({ label, value }: { label: string; value: string | null }) {
  if (value) {
    return (
      <span className="text-xs text-muted-foreground">
        <span className="text-foreground/70">{label}:</span> {value}
      </span>
    );
  }
  return (
    <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning">
      {label} missing
    </span>
  );
}

function WalkInDialogContent({ onDone }: { onDone: (result: CheckInResult) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("add_and_check_in", {
        p_full_name: fullName,
        p_email: email,
        p_organization: organization,
        p_device_label: "Web check-in",
        ...(phone ? { p_phone: phone } : {}),
      });
      if (error) throw error;
      return data as unknown as AddAndCheckInResponse;
    },
    onSuccess: (data) => {
      const detail = [data.delegate.full_name, data.delegate.organization]
        .filter(Boolean)
        .join(", ");
      if (data.result === "already_checked_in") {
        // They were already on the list and already checked in today —
        // the record was still updated with whatever new details were
        // just typed, so this isn't an error, just a heads-up.
        noticeFeedback();
        onDone({ kind: "already_checked_in", title: "Already checked in today", detail });
        return;
      }
      successFeedback();
      onDone({
        kind: "checked_in",
        title: "Checked in",
        detail: `${detail} (walk-in)`,
      });
    },
    onError: (err) => {
      reportClientError(err, { context: "add_and_check_in" });
      setError(errorMessage(err));
    },
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add and check in</DialogTitle>
        <DialogDescription>For a delegate who is not in the expected list.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mutation.mutate();
        }}
      >
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="space-y-1.5">
          <Label htmlFor="wi_name">Full name</Label>
          <Input
            id="wi_name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wi_email">Email (optional)</Label>
          <Input
            id="wi_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wi_org">Organization (optional)</Label>
          <OrganizationCombobox id="wi_org" value={organization} onChange={setOrganization} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wi_phone">Phone (optional)</Label>
          <Input id="wi_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={mutation.isPending}>
            Add and check in
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
