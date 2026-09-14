import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useActiveEvent } from "@/lib/events-data";

export type DelegateRow = Tables<"delegates"> & {
  checked_in_at: string | null;
  /**
   * Name of the staff member who performed the check-in, when resolvable.
   * staff_profiles is only fully readable by admins under RLS, so a plain
   * staff viewer only ever resolves their own name here; others fall back
   * to a generic label. The full record (by email) is always in the audit
   * trail regardless of what a given viewer can resolve client-side.
   */
  checked_in_by_name: string | null;
};

export const DELEGATES_KEY = ["delegates-raw"] as const;
const STAFF_NAMES_KEY = ["staff-names"] as const;

type RawCheckIn = Pick<
  Tables<"check_ins">,
  "delegate_id" | "checked_in_at" | "checked_in_by" | "method"
>;

async function fetchDelegatesRaw(eventId: string) {
  const [{ data: delegates, error: delegatesError }, { data: checkIns, error: checkInsError }] =
    await Promise.all([
      supabase
        .from("delegates")
        .select("*")
        .eq("event_id", eventId)
        .order("full_name", { ascending: true }),
      // Not filtered by event: check_ins has no event_id of its own, and a
      // row here only ever gets matched against a delegate_id already in
      // this event's roster below, so rows from other events are just
      // unused, not a correctness issue.
      supabase
        .from("check_ins")
        .select("delegate_id, checked_in_at, checked_in_by, method")
        .returns<RawCheckIn[]>(),
    ]);
  if (delegatesError) throw delegatesError;
  if (checkInsError) throw checkInsError;
  return { delegates: delegates ?? [], checkIns: checkIns ?? [] };
}

/**
 * The staff roster barely changes during an event, so it gets its own query
 * with a long staleTime and no realtime subscription, instead of being
 * re-fetched on every single check-in event alongside the delegate roster.
 */
function useStaffNames() {
  return useQuery({
    queryKey: STAFF_NAMES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_profiles").select("user_id, full_name");
      if (error) throw error;
      return new Map((data ?? []).map((s) => [s.user_id, s.full_name]));
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Live delegate roster with check-in status, scoped to whichever event is
 * currently active and kept fresh via Postgres realtime.
 */
export function useDelegates() {
  const queryClient = useQueryClient();
  const { data: activeEvent } = useActiveEvent();
  const eventId = activeEvent?.id;
  const { data: staffNames } = useStaffNames();

  useEffect(() => {
    const channel = supabase
      .channel("delegates-and-check-ins")
      .on("postgres_changes", { event: "*", schema: "public", table: "delegates" }, () =>
        queryClient.invalidateQueries({ queryKey: DELEGATES_KEY }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "check_ins" }, () =>
        queryClient.invalidateQueries({ queryKey: DELEGATES_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const rawQuery = useQuery({
    queryKey: [...DELEGATES_KEY, eventId],
    queryFn: () => fetchDelegatesRaw(eventId!),
    enabled: !!eventId,
  });

  const data = useMemo<DelegateRow[] | undefined>(() => {
    if (!rawQuery.data) return undefined;
    const byDelegate = new Map(rawQuery.data.checkIns.map((c) => [c.delegate_id, c]));
    return rawQuery.data.delegates.map((d) => {
      const checkIn = byDelegate.get(d.id);
      const staffName = checkIn?.checked_in_by ? staffNames?.get(checkIn.checked_in_by) : undefined;
      const attribution = !checkIn
        ? null
        : checkIn.method === "kiosk"
          ? "self check-in kiosk"
          : (staffName ?? "a staff member");
      return {
        ...d,
        checked_in_at: checkIn?.checked_in_at ?? null,
        checked_in_by_name: attribution,
      };
    });
  }, [rawQuery.data, staffNames]);

  return { ...rawQuery, data };
}

export type DashboardStats = {
  expected: number;
  checked_in: number;
  walk_ins: number;
  last_check_in_at: string | null;
};

/** Server-computed counts (expected, checked in, walk-ins), kept fresh via realtime. */
export function useDashboardStats() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "delegates" }, () =>
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "check_ins" }, () =>
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_stats");
      if (error) throw error;
      return data as unknown as DashboardStats;
    },
  });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Not every event collects every field ahead of time (e.g. a sign-in sheet
 * with just names, filled in on paper at the door), so a fixed column set
 * would export a wall of blanks. Instead, only columns with at least one
 * non-empty value across the exported rows are included, and rows with
 * nothing but the always-present identifiers (name/status/badge/source) are
 * left out of the optional columns entirely — the sheet only shows what was
 * actually filled in.
 */
export function delegatesToCsv(delegates: DelegateRow[]): string {
  const columns: Array<{ key: string; get: (d: DelegateRow) => string }> = [
    { key: "full_name", get: (d) => d.full_name },
    { key: "email", get: (d) => d.email ?? "" },
    { key: "organization", get: (d) => d.organization ?? "" },
    { key: "phone", get: (d) => d.phone ?? "" },
    { key: "status", get: (d) => d.status },
    { key: "badge_code", get: (d) => d.badge_code },
    { key: "source", get: (d) => d.source },
    { key: "checked_in_at", get: (d) => d.checked_in_at ?? "" },
  ];

  const rows = delegates.filter((d) => d.full_name.trim() !== "");
  const activeColumns = columns.filter((c) => rows.some((d) => c.get(d).trim() !== ""));

  const header = activeColumns.map((c) => c.key);
  const lines = rows.map((d) =>
    activeColumns.map((c) => csvEscape(c.get(d))).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
