import { Fragment, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StaffShell } from "@/components/staff-shell";
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

export const Route = createFileRoute("/admin/errors")({
  head: () => ({ meta: [{ title: "Errors, AAK Convention 2026" }] }),
  // Auth lives in localStorage, which the server can't see; SSR-ing this
  // route would make the guard always look unauthenticated and bounce a
  // validly signed-in staff member on every hard reload.
  ssr: false,
  beforeLoad: async ({ location, context }) => ({
    staff: await requireAdmin(location.pathname, context.queryClient),
  }),
  component: ErrorsPage,
});

function ErrorsPage() {
  const { staff } = Route.useRouteContext();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("client-errors")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_errors" }, () =>
        queryClient.invalidateQueries({ queryKey: ["client-errors"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: errors } = useQuery({
    queryKey: ["client-errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <StaffShell staff={staff}>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl text-foreground">Errors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Problems the app hit on someone's device, reported automatically. Click a row for the
            full stack trace.
          </p>
        </div>

        <div className="panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(errors ?? []).map((e) => (
                <Fragment key={e.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    <TableCell className="whitespace-nowrap tabular text-muted-foreground">
                      {new Date(e.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "medium",
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {e.actor_email ?? "Not signed in"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.path ?? "—"}</TableCell>
                    <TableCell className="max-w-md truncate font-medium text-foreground">
                      {e.message}
                    </TableCell>
                  </TableRow>
                  {expandedId === e.id && (
                    <TableRow key={`${e.id}-detail`}>
                      <TableCell colSpan={4} className="bg-muted/50">
                        <div className="space-y-2 py-2">
                          {Object.keys(e.context ?? {}).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">Context</p>
                              <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                                {JSON.stringify(e.context, null, 2)}
                              </pre>
                            </div>
                          )}
                          {e.stack && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground">
                                Stack trace
                              </p>
                              <pre className="mt-1 overflow-x-auto text-xs text-muted-foreground">
                                {e.stack}
                              </pre>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {errors?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No errors reported. Good sign.
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
