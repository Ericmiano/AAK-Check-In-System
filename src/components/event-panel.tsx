import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveEvent, useAllEvents } from "@/lib/events-data";
import { DELEGATES_KEY } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";

/**
 * Create or switch the active event. Any active staff member can do this
 * (not just admins) — event switching used to be admin-gated, but that left
 * staff stuck with nobody around to fix a missing event, so the RPCs and
 * this UI are open to whoever's signed in.
 *
 * `compact`: when true and an event is already active, collapses to a small
 * summary with a "Change" toggle instead of showing the full form inline —
 * meant for the check-in screen, where the primary job is checking people
 * in, not managing events. When there's no active event, always shows the
 * full form regardless, since that's the one thing blocking everything else.
 */
export function EventPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const { data: activeEvent } = useActiveEvent();
  const { data: events } = useAllEvents();
  const [newEventName, setNewEventName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function invalidateEvents() {
    queryClient.invalidateQueries({ queryKey: ["active-event"] });
    queryClient.invalidateQueries({ queryKey: ["all-events"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
  }

  const createEvent = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_create_event", { p_name: newEventName });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setNewEventName("");
      setExpanded(false);
      invalidateEvents();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Connection problem. Try again."),
  });

  const switchEvent = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("admin_set_active_event", { p_event_id: eventId });
      if (error) throw error;
    },
    onSuccess: () => {
      setExpanded(false);
      invalidateEvents();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Connection problem. Try again."),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newEventName.trim().length < 2) return;
    createEvent.mutate();
  }

  const showFullForm = expanded || !activeEvent || !compact;

  if (compact && activeEvent && !showFullForm) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-2 self-start rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>
          Event: <span className="font-medium text-foreground">{activeEvent.name}</span>
        </span>
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="panel space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Current event</p>
          <p className="mt-1 font-display text-xl text-foreground">
            {activeEvent ? activeEvent.name : "No active event"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every check-in, import, and dashboard number is scoped to this event.
          </p>
        </div>
        {compact && activeEvent && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="new_event_name">New event</Label>
            <Input
              id="new_event_name"
              placeholder="e.g. AAK Convention 2027"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              className="w-64"
            />
          </div>
          <Button type="submit" disabled={createEvent.isPending}>
            {createEvent.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlus className="size-4" aria-hidden="true" />
            )}
            Create and activate
          </Button>
        </form>

        {events && events.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="switch_event">Switch to an existing event</Label>
            <Select
              {...(activeEvent ? { value: activeEvent.id } : {})}
              onValueChange={(id) => switchEvent.mutate(id)}
              disabled={switchEvent.isPending}
            >
              <SelectTrigger id="switch_event" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {events.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
