import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type EventRow = Tables<"events">;

const ACTIVE_EVENT_KEY = ["active-event"] as const;

/**
 * The event every operational screen (check-in, dashboard, kiosk, import)
 * currently works against. Realtime-subscribed so switching events on the
 * admin side takes effect immediately on every open desk, not just on the
 * device that switched it.
 *
 * This hook is called from more than one place at once on the same page
 * (StaffShell's header, and again inside useDelegates), so the channel name
 * must be unique per call site — supabase-js errors if a second `.on()` is
 * registered on a channel that's already subscribed, which a shared static
 * name would do the moment both mount together.
 */
export function useActiveEvent() {
  const queryClient = useQueryClient();
  const instanceId = useId();

  useEffect(() => {
    const channel = supabase
      .channel(`active-event-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () =>
        queryClient.invalidateQueries({ queryKey: ACTIVE_EVENT_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, instanceId]);

  return useQuery({
    queryKey: ACTIVE_EVENT_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      return data as EventRow | null;
    },
  });
}

export function useAllEvents() {
  return useQuery({
    queryKey: ["all-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
