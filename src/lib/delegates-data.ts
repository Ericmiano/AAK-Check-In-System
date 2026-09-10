import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

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

async function fetchDelegatesRaw() {
  const [{ data: delegates, error: delegatesError }, { data: checkIns, error: checkInsError }] =
    await Promise.all([
      supabase.from("delegates").select("*").order("full_name", { ascending: true }),
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

/** Live delegate roster with check-in status, kept fresh via Postgres realtime. */
export function useDelegates() {
  const queryClient = useQueryClient();
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

  const rawQuery = useQuery({ queryKey: DELEGATES_KEY, queryFn: fetchDelegatesRaw });

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

export function delegatesToCsv(delegates: DelegateRow[]): string {
  const header = [
    "full_name",
    "email",
    "organization",
    "phone",
    "status",
    "badge_code",
    "source",
    "checked_in_at",
  ];
  const rows = delegates.map((d) =>
    [
      d.full_name,
      d.email,
      d.organization,
      d.phone ?? "",
      d.status,
      d.badge_code,
      d.source,
      d.checked_in_at ?? "",
    ]
      .map((v) => csvEscape(String(v)))
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
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
