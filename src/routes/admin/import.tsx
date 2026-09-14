import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import Papa from "papaparse";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Trash2 } from "lucide-react";
import { StaffShell } from "@/components/staff-shell";
import { EventPanel } from "@/components/event-panel";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { requireAdmin } from "@/lib/staff-session";
import { DELEGATES_KEY } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";

export const Route = createFileRoute("/admin/import")({
  head: () => ({ meta: [{ title: "Import delegates, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireAdmin(location.pathname, context.queryClient),
  }),
  component: ImportPage,
});

type CsvRow = {
  full_name: string;
  email: string;
  organization: string;
  phone: string;
};

const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  fullname: "full_name",
  name: "full_name",
  bookingname: "full_name",
  ticketname: "full_name",
  attendeename: "full_name",
  delegatename: "full_name",
  email: "email",
  emailaddress: "email",
  bookingemail: "email",
  ticketemail: "email",
  organization: "organization",
  organisation: "organization",
  institution: "organization",
  company: "organization",
  companyname: "organization",
  employer: "organization",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  mobilenumber: "phone",
  cell: "phone",
  bookingphone: "phone",
  ticketphone: "phone",
  contactnumber: "phone",
};

// Broader, substring-based fallback for headers that don't exactly match a
// known alias above (e.g. a column phrased in a way not seen before). Order
// matters: more specific categories (email/phone/organization) are checked
// before the generic "name" fallback, since a header like "Company Name"
// should resolve to organization, not full_name.
const FALLBACK_RULES: Array<{ test: RegExp; field: keyof CsvRow }> = [
  { test: /email|mail/, field: "email" },
  { test: /phone|mobile|contact|tel|cell/, field: "phone" },
  { test: /organi[sz]|institution|compan|employer/, field: "organization" },
  { test: /name/, field: "full_name" },
];

function normalizeHeader(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchHeader(rawKey: string): keyof CsvRow | null {
  const normalized = normalizeHeader(rawKey);
  if (HEADER_ALIASES[normalized]) return HEADER_ALIASES[normalized];
  for (const rule of FALLBACK_RULES) {
    if (rule.test.test(normalized)) return rule.field;
  }
  return null;
}

/**
 * Maps whatever columns a CSV actually has onto our fixed fields, tolerating
 * header wording we haven't seen before (a ticketing export, a sign-in
 * sheet, a plain contact list all phrase things differently). Also reports
 * which source headers went unrecognized, so a column silently failing to
 * map is visible instead of just quietly importing as blank.
 */
function normalizeRows(raw: Record<string, string>[]): {
  rows: CsvRow[];
  unmappedHeaders: string[];
} {
  const firstRow = raw[0];
  const sourceHeaders = firstRow ? Object.keys(firstRow) : [];
  const unmappedHeaders = sourceHeaders.filter((h) => !matchHeader(h));

  const rows = raw.map((row) => {
    const out: CsvRow = { full_name: "", email: "", organization: "", phone: "" };
    for (const [key, value] of Object.entries(row)) {
      const field = matchHeader(key);
      // Don't let a later, less-specific column overwrite one already
      // filled by an earlier, better-matching column (e.g. both "Ticket
      // Email" and a stray "Contact" column resolving to the same field).
      if (field && !out[field]) out[field] = (value ?? "").trim();
    }
    return out;
  });

  return { rows, unmappedHeaders };
}

// Only full name is truly required — email, organization, and phone are
// frequently blank ahead of time on paper sign-in sheets and get filled in
// at the door, so a missing value there isn't an error, only an invalid one
// (a malformed email typed into the sheet) is.
function rowIssue(row: CsvRow): string | null {
  if (row.full_name.length < 2) return "Missing or invalid full name";
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return "Invalid email";
  return null;
}

type ImportSummary = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; email: string; reason: string }>;
};

function ImportPage() {
  const { staff } = Route.useRouteContext();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidCount = useMemo(() => rows.filter((r) => rowIssue(r) !== null).length, [rows]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("import_delegates", {
        p_rows: rows,
        p_filename: fileName ?? "import.csv",
      });
      if (error) throw error;
      return data as unknown as ImportSummary;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  const removeTestDataMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("remove_test_delegates");
      if (error) throw error;
      return data as unknown as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  function handleFile(file: File) {
    setParseError(null);
    importMutation.reset();
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data.length === 0) {
          setParseError("The file has no rows.");
          return;
        }
        setFileName(file.name);
        const { rows: normalized, unmappedHeaders } = normalizeRows(results.data);
        setRows(normalized);
        setUnmappedHeaders(unmappedHeaders);
      },
      error: (err) => setParseError(err.message),
    });
  }

  return (
    <StaffShell staff={staff}>
      <div className="max-w-4xl space-y-6">
        <EventPanel />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-foreground">Import expected delegates</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Upload a CSV with a full name column — email, organization/institution, and phone
              are picked up automatically from most common column headings, and can be filled in
              later if missing. Existing delegates are matched and updated by email (or by name
              when a row has no email); new ones are added as expected. Up to 5000 rows per file.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={removeTestDataMutation.isPending}>
                <Trash2 className="size-4" aria-hidden="true" />
                Remove seed test data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the fictional seed delegates?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes every delegate whose email ends in @example.com, the
                  placeholder rows used to test the system before real data was imported. Delegates
                  from your real import are not affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => removeTestDataMutation.mutate()}>
                  Remove test data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {removeTestDataMutation.isSuccess && (
          <Alert>
            <AlertDescription>
              Removed {removeTestDataMutation.data} fictional seed{" "}
              {removeTestDataMutation.data === 1 ? "delegate" : "delegates"}.
            </AlertDescription>
          </Alert>
        )}

        <label className="panel flex cursor-pointer flex-col items-center gap-2 border-dashed p-10 text-center transition-colors hover:bg-accent/40">
          <FileUp className="size-6 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">
            {fileName ?? "Choose a CSV file"}
          </span>
          <span className="text-xs text-muted-foreground">Click to browse</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </label>

        {parseError && (
          <Alert variant="destructive">
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}

        {unmappedHeaders.length > 0 && rows.length > 0 && !importMutation.data && (
          <Alert>
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertDescription>
              These columns weren't recognized and won't be imported:{" "}
              <strong>{unmappedHeaders.join(", ")}</strong>. Everything else (name, email,
              organization, phone) was picked up below — double-check the preview before
              importing.
            </AlertDescription>
          </Alert>
        )}

        {rows.length > 0 && !importMutation.data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {rows.length} rows read.{" "}
                {invalidCount > 0 ? (
                  <span className="text-warning">
                    {invalidCount} have a problem and will be skipped.
                  </span>
                ) : (
                  "All rows look valid."
                )}
              </p>
              <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
                {importMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileUp className="size-4" aria-hidden="true" />
                )}
                Import {rows.length} rows
              </Button>
            </div>
            <div className="panel max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Full name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Issue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((row, i) => {
                    const issue = rowIssue(row);
                    return (
                      <TableRow key={i} className={issue ? "bg-danger-soft/40" : undefined}>
                        <TableCell>{row.full_name || "—"}</TableCell>
                        <TableCell>{row.email || "—"}</TableCell>
                        <TableCell>{row.organization || "—"}</TableCell>
                        <TableCell>{row.phone || "—"}</TableCell>
                        <TableCell className="text-warning">{issue ?? ""}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {importMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(importMutation.error)}
            </AlertDescription>
          </Alert>
        )}

        {importMutation.data && (
          <div className="panel space-y-4 p-5">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-5" aria-hidden="true" />
              <p className="font-display text-lg text-foreground">Import complete</p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryStat label="Total rows" value={importMutation.data.total} />
              <SummaryStat label="Inserted" value={importMutation.data.inserted} />
              <SummaryStat label="Updated" value={importMutation.data.updated} />
              <SummaryStat label="Skipped" value={importMutation.data.skipped} />
            </div>
            {importMutation.data.errors.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  {importMutation.data.errors.length} rows were skipped
                </p>
                <ul className="max-h-48 space-y-1 overflow-auto text-sm text-muted-foreground">
                  {importMutation.data.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row} ({e.email || "no email"}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setRows([]);
                setFileName(null);
                importMutation.reset();
              }}
            >
              Import another file
            </Button>
          </div>
        )}
      </div>
    </StaffShell>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-2xl tabular text-foreground">{value}</p>
    </div>
  );
}
