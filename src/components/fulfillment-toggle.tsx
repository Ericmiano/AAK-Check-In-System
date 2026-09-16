import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { DELEGATES_KEY } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";
import { reportClientError } from "@/lib/error-log";

/**
 * A simple yes/no hand-out tracker (tag, gift bag), used on both the
 * check-in search results and the dashboard roster. Kept independent of
 * check-in status — the desk can run out of tags or bags, or hand them out
 * out of order — so staff mark each one explicitly rather than it being
 * assumed from "checked in".
 *
 * Applies the new value to the cached roster immediately (rather than
 * waiting on a refetch of all 400+ delegates to come back over the network)
 * so the checkbox flips the instant it's clicked — on a slow connection the
 * full-roster refetch alone could take several seconds, which looked to
 * staff like the click hadn't done anything. A background invalidate still
 * follows to reconcile with the server.
 */
export function FulfillmentToggle({
  label,
  delegateId,
  checked,
  field,
  rpc,
  showLabel = true,
}: {
  label: string;
  delegateId: string;
  checked: boolean;
  field: "tag_issued_at" | "gift_bag_issued_at";
  rpc: "set_tag_issued" | "set_gift_bag_issued";
  showLabel?: boolean;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc(rpc, { p_delegate_id: delegateId, p_issued: next });
      if (error) throw error;
    },
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: DELEGATES_KEY });
      const previous = queryClient.getQueriesData({ queryKey: DELEGATES_KEY });
      queryClient.setQueriesData(
        { queryKey: DELEGATES_KEY },
        (old: { id: string }[] | undefined) =>
          old?.map((d) =>
            d.id === delegateId ? { ...d, [field]: next ? new Date().toISOString() : null } : d,
          ),
      );
      return { previous };
    },
    onError: (err, _next, context) => {
      context?.previous?.forEach(([key, data]) => queryClient.setQueryData(key, data));
      reportClientError(err, { context: rpc });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: DELEGATES_KEY }),
  });

  const id = `${rpc}-${delegateId}`;
  return (
    <label
      htmlFor={id}
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title={label}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={mutation.isPending}
        onCheckedChange={(next) => mutation.mutate(next === true)}
        aria-label={label}
      />
      {showLabel && label}
    </label>
  );
}
