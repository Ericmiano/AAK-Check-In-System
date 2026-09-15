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

type EmbeddedCheckIn = Pick<Tables<"check_ins">, "checked_in_at" | "checked_in_by" | "method">;

type DelegateWithCheckIn = Tables<"delegates"> & {
  // check_ins.delegate_id is unique, so this is a to-one relationship, but
  // PostgREST's embed shape (bare object vs single-item array) has varied
  // across versions, so both are handled where this is read.
  check_ins: EmbeddedCheckIn[] | EmbeddedCheckIn | null;
};

/**
 * One query instead of two: check_ins has no event_id of its own, so
 * fetching it separately meant pulling every check-in from every event
 * this system has ever run, every time the roster loads — a fetch that
 * only grows as more events pile up, even though only this event's rows
 * are ever used. Embedding check_ins through its FK to delegates lets
 * PostgREST scope it to the same event_id filter in a single round trip.
 */
async function fetchDelegatesRaw(eventId: string) {
  const { data, error } = await supabase
    .from("delegates")
    .select("*, check_ins(checked_in_at, checked_in_by, method)")
    .eq("event_id", eventId)
    .order("full_name", { ascending: true })
    .returns<DelegateWithCheckIn[]>();
  if (error) throw error;
  return data ?? [];
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
    return rawQuery.data.map(({ check_ins, ...d }) => {
      const checkIn = Array.isArray(check_ins) ? check_ins[0] : check_ins;
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

type ExportColumn = { key: string; get: (d: DelegateRow) => string };

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "full_name", get: (d) => d.full_name },
  { key: "email", get: (d) => d.email ?? "" },
  { key: "organization", get: (d) => d.organization ?? "" },
  { key: "phone", get: (d) => d.phone ?? "" },
  { key: "status", get: (d) => d.status },
  { key: "badge_code", get: (d) => d.badge_code },
  { key: "source", get: (d) => d.source },
  { key: "checked_in_at", get: (d) => d.checked_in_at ?? "" },
];

/**
 * Not every event collects every field ahead of time (e.g. a sign-in sheet
 * with just names, filled in on paper at the door), so a fixed column set
 * would export a wall of blanks. Shared by every export format: only
 * columns with at least one non-empty value across the exported rows are
 * included, and rows with no name at all are dropped entirely.
 */
function activeExportData(delegates: DelegateRow[]) {
  const rows = delegates.filter((d) => d.full_name.trim() !== "");
  const columns = EXPORT_COLUMNS.filter((c) => rows.some((d) => c.get(d).trim() !== ""));
  return { rows, columns };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Excel (and Sheets) auto-detects an unquoted, all-digit CSV cell as a
 * number — a phone number then loses any leading zero and, past ~15
 * digits, gets rounded and shown in scientific notation. Quoting the cell
 * doesn't stop this: CSV quotes are a syntax escape, not a type signal, so
 * Excel's numeric sniffing ignores them. Wrapping the value as a formula
 * that evaluates to a text literal is the standard workaround — Excel
 * renders it as plain text with nothing lost, at the cost of a `="…"`
 * wrapper if the raw file is ever opened outside a spreadsheet (use the
 * JSON export for that instead).
 */
function csvPhoneCell(phone: string): string {
  if (!phone) return "";
  return csvEscape(`="${phone.replace(/"/g, '""')}"`);
}

export function delegatesToCsv(delegates: DelegateRow[]): string {
  const { rows, columns } = activeExportData(delegates);
  const header = columns.map((c) => c.key);
  const lines = rows.map((d) =>
    columns
      .map((c) => (c.key === "phone" ? csvPhoneCell(c.get(d)) : csvEscape(c.get(d))))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/** Plain structured data — no spreadsheet-app quirks, safe for scripts, backups, or re-import elsewhere. */
export function delegatesToJson(delegates: DelegateRow[]): string {
  const { rows, columns } = activeExportData(delegates);
  const records = rows.map((d) =>
    Object.fromEntries(columns.map((c) => [c.key, c.get(d) || null])),
  );
  return JSON.stringify(records, null, 2);
}

/**
 * A real .xlsx workbook, so Excel is told the phone column is text at the
 * cell-format level instead of needing the CSV formula workaround — opens
 * clean with no extra step, and is the more familiar format for staff who
 * just want to browse or filter the list by hand.
 */
export async function delegatesToXlsx(delegates: DelegateRow[]): Promise<Blob> {
  const { rows, columns } = activeExportData(delegates);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Delegates");

  // Cells are written one at a time by explicit row/column position, with
  // the phone column's text format applied to every cell in that column
  // (header included) up front — safer than setting a value through
  // sheet.columns' keyed row-object insert and mutating numFmt afterward,
  // which left some viewers showing the phone column as blank.
  const phoneColIndex = columns.findIndex((c) => c.key === "phone") + 1;
  if (phoneColIndex > 0) {
    sheet.getColumn(phoneColIndex).numFmt = "@";
  }

  const headerRow = sheet.getRow(1);
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.key;
  });
  headerRow.font = { bold: true };

  rows.forEach((d, rowOffset) => {
    const row = sheet.getRow(rowOffset + 2);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (i + 1 === phoneColIndex) {
        cell.numFmt = "@";
        cell.value = c.get(d) || null;
      } else {
        cell.value = c.get(d) || null;
      }
    });
  });

  columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = Math.max(12, c.key.length + 2);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadCsv(filename: string, csv: string) {
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

export function downloadJson(filename: string, json: string) {
  downloadBlob(filename, new Blob([json], { type: "application/json;charset=utf-8;" }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
