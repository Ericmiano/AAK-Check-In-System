import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { ResultBanner, type CheckInResult } from "@/components/result-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { requireStaff } from "@/lib/staff-session";
import { useDelegates, type DelegateRow } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";
import { successFeedback, noticeFeedback } from "@/lib/feedback";

export const Route = createFileRoute("/staff/check-in")({
  head: () => ({ meta: [{ title: "Check-in, AAK Convention 2026" }] }),
  beforeLoad: async ({ location, context }) => ({
    staff: await requireStaff(location.pathname, context.queryClient),
  }),
  component: CheckInPage,
});

type CheckInResponse = {
  result: "checked_in" | "already_checked_in" | "not_found";
  delegate?: { full_name: string; organization: string; badge_code: string };
};

type AddAndCheckInResponse = {
  result: "checked_in" | "already_checked_in" | "duplicate";
  delegate: { full_name: string; organization: string; badge_code: string };
};

function CheckInPage() {
  const { staff } = Route.useRouteContext();
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [query, setQuery] = useState("");
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { data: delegates } = useDelegates();

  function showResult(next: CheckInResult) {
    setResult(next);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), 5000);
  }

  const checkInMutation = useMutation({
    mutationFn: async (vars: { lookup: string }) => {
      const { data, error } = await supabase.rpc("check_in_delegate", {
        p_lookup: vars.lookup,
        p_method: "search",
        p_device_label: "Web check-in",
      });
      if (error) throw error;
      return data as unknown as CheckInResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["delegates"] });
      const detail = data.delegate
        ? `${data.delegate.full_name}, ${data.delegate.organization}`
        : undefined;
      if (data.result === "checked_in") {
        successFeedback();
        setSessionCount((n) => n + 1);
        showResult({ kind: "checked_in", title: "Checked in", ...(detail ? { detail } : {}) });
      } else if (data.result === "already_checked_in") {
        noticeFeedback();
        showResult({
          kind: "already_checked_in",
          title: "Already checked in",
          ...(detail ? { detail } : {}),
        });
      } else {
        showResult({ kind: "not_found", title: "No delegate found" });
      }
      // Reset the search box so staff can go straight to the next person
      // without touching the mouse.
      setQuery("");
      searchInputRef.current?.focus();
    },
    onError: () => {
      showResult({ kind: "error", title: "Connection problem. Try again." });
    },
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !delegates) return [];
    return delegates
      .filter(
        (d) =>
          d.full_name.toLowerCase().includes(q) ||
          d.email.toLowerCase().includes(q) ||
          d.badge_code.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, delegates]);

  return (
    <StaffShell staff={staff}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl text-foreground">Staff check-in</h1>
          <span className="tabular text-sm text-muted-foreground">
            {sessionCount} checked in this session
          </span>
        </div>

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
                if (top && top.status !== "checked_in") {
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
              queryClient.invalidateQueries({ queryKey: ["delegates"] });
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
}: {
  delegate: DelegateRow;
  disabled: boolean;
  onCheckIn: () => void;
}) {
  const checkedIn = delegate.status === "checked_in";
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{delegate.full_name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {delegate.organization} &middot; {delegate.badge_code}
        </p>
      </div>
      {checkedIn ? (
        <Badge variant="secondary" className="shrink-0">
          Checked in
        </Badge>
      ) : (
        <Button size="sm" disabled={disabled} onClick={onCheckIn}>
          Check in
        </Button>
      )}
    </li>
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
      if (data.result === "duplicate") {
        setError(`${data.delegate.full_name} is already in the system. Search for them instead.`);
        return;
      }
      successFeedback();
      onDone({
        kind: "checked_in",
        title: "Checked in",
        detail: `${data.delegate.full_name}, ${data.delegate.organization} (walk-in)`,
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Connection problem. Try again.");
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
          <Label htmlFor="wi_email">Email</Label>
          <Input
            id="wi_email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wi_org">Organization</Label>
          <Input
            id="wi_org"
            required
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
          />
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
