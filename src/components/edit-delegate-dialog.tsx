import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DELEGATES_KEY, type DelegateRow } from "@/lib/delegates-data";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";

/**
 * Fills in the details a name-only import row is missing — email,
 * organization, phone — once they're known (typically collected on paper at
 * the check-in desk and typed in afterward). Any active staff member can
 * use this, not just admins, since it's meant to be used at the desk during
 * check-in.
 */
export function EditDelegateDialog({ delegate }: { delegate: DelegateRow }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(delegate.email ?? "");
  const [organization, setOrganization] = useState(delegate.organization ?? "");
  const [phone, setPhone] = useState(delegate.phone ?? "");
  const [error, setError] = useState<string | null>(null);

  function resetFromDelegate() {
    setEmail(delegate.email ?? "");
    setOrganization(delegate.organization ?? "");
    setPhone(delegate.phone ?? "");
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("update_delegate_details", {
        p_delegate_id: delegate.id,
        p_email: email.trim(),
        p_organization: organization.trim(),
        p_phone: phone.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELEGATES_KEY });
      setOpen(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetFromDelegate();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Edit details">
          <SquarePen className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{delegate.full_name}</DialogTitle>
          <DialogDescription>
            Fill in whatever the sign-in sheet has for this person. Leave a field blank to keep
            it as-is.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit_email">Email</Label>
            <Input
              id="edit_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_org">Organization / institution</Label>
            <Input
              id="edit_org"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_phone">Phone</Label>
            <Input id="edit_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
