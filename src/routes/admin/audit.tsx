import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StaffShell } from "@/components/staff-shell";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Audit trail, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireAdmin(location.pathname, context.queryClient),
  }),
  component: AuditPage,
});

function AuditPage() {
  const { staff } = Route.useRouteContext();
  const [query, setQuery] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("audit-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_events" }, () =>
        queryClient.invalidateQueries({ queryKey: ["audit-events"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: events } = useQuery({
    queryKey: ["audit-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events ?? [];
    return (events ?? []).filter(
      (e) =>
        e.action.toLowerCase().includes(q) ||
        (e.actor_email ?? "").toLowerCase().includes(q) ||
        (e.entity_type ?? "").toLowerCase().includes(q),
    );
  }, [events, query]);

  return (
    <StaffShell staff={staff}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-foreground">Audit trail</h1>
          <Input
            placeholder="Filter by action, staff email, or entity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
          />
        </div>

        <div className="panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Staff member</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular text-muted-foreground">
                    {new Date(e.created_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "medium",
                    })}
                  </TableCell>
                  <TableCell>{e.actor_email ?? "System"}</TableCell>
                  <TableCell className="font-medium text-foreground">{e.action}</TableCell>
                  <TableCell className="text-muted-foreground">{e.entity_type ?? "—"}</TableCell>
                  <TableCell
                    className="max-w-xs truncate text-xs text-muted-foreground"
                    title={JSON.stringify(e.metadata)}
                  >
                    {JSON.stringify(e.metadata)}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No audit events yet.
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
